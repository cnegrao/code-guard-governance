import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const TEST_PROJECT = 'zkqfvqwqdypgpzauzinw';
export function validateInvitationInput(input) {
  if (input['project-ref'] !== TEST_PROJECT) throw new Error('Only the explicitly authorised ov-ia-g2-test project is supported.');
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input['org-id'] ?? '')) throw new Error('An explicit organisation UUID is required.');
  if (!/^[A-Z0-9_]{1,20}$/.test(input['org-code'] ?? '')) throw new Error('An explicit expected organisation code is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email ?? '') || input.email.length > 255) throw new Error('A real operator email is required.');
  if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 255) throw new Error('The real operator name is required.');
  if (typeof input.reason !== 'string' || input.reason.trim().length < 10 || input.reason.length > 500) throw new Error('An administrative reason is required.');
  const hours = Number(input.hours ?? '2');
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Invitation lifetime must be greater than zero and at most 24 hours.');
  return { ...input, email: input.email.trim().toLowerCase(), name: input.name.trim(), hours };
}
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
function runNode(cli, args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('Administrative CLI query failed; no invitation code was printed.');
  return JSON.parse(result.stdout);
}
function protectDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') { chmodSync(directory, 0o700); return; }
  const identity = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8', windowsHide: true });
  const sid = identity.stdout?.trim();
  if (identity.status !== 0 || !/^S-1-5-(?:\d+-)*\d+$/.test(sid ?? '')) throw new Error('Cannot establish private local delivery permissions.');
  const acl = spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`, '/grant:r', '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
  if (acl.status !== 0) throw new Error('Cannot protect the private invitation delivery directory.');
}
export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: Object.fromEntries(['project-ref','org-id','org-code','email','name','reason','hours','linked-workdir'].map(key => [key, { type: 'string' }])) });
  const input = validateInvitationInput(values);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const linked = path.resolve(input['linked-workdir'] ?? repo);
  if (JSON.parse(readFileSync(path.join(linked, 'supabase/.temp/linked-project.json'), 'utf8')).ref !== TEST_PROJECT) throw new Error('Linked project mismatch; refused before connection.');
  let parent = repo, cli;
  for (;;) {
    const candidate = path.join(parent, 'node_modules/supabase/dist/supabase.js');
    if (existsSync(candidate)) { cli = candidate; break; }
    if (path.dirname(parent) === parent) throw new Error('Existing Supabase CLI is required.');
    parent = path.dirname(parent);
  }
  const directory = path.join(repo, '.artifacts/agent/operator-invitations', randomUUID());
  protectDirectory(directory);
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const codeFile = path.join(directory, 'activation-code.txt');
  // Private local delivery only: never print the code, include it in a URL,
  // send email, choose a password, or issue a session for the operator.
  writeFileSync(codeFile, token + '\n', { flag: 'wx', mode: 0o600 });
  const sqlFile = path.join(directory, 'issue.sql');
  writeFileSync(sqlFile, `select gov_repo.issue_governance_operator_invitation_v1(${literal(input['org-id'])}::uuid,${literal(input['org-code'])},${literal(input.email)},${literal(input.name)},${literal(tokenHash)},clock_timestamp()+interval '${input.hours} hours',${literal(input.reason)}) as invitation;`, { flag: 'wx', mode: 0o600 });
  const result = runNode(cli, ['db','query','--linked','--output','json','--file',sqlFile], linked);
  const invitation = result.rows?.[0]?.invitation;
  if (!invitation?.invitationId || invitation.email !== input.email || invitation.organisationId !== input['org-id']) throw new Error('Unexpected invitation receipt.');
  const receipt = { ...invitation, projectRef: TEST_PROJECT, activationUrl: 'http://localhost:3101/accept-invitation', codeFile };
  writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
