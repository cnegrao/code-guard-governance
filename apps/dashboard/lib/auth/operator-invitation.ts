import "server-only";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { z } from "zod";
import { privilegedDb } from "@/lib/governance/persistence";
import { AuthPublicError, GENERIC_AUTH_ERROR_MESSAGE } from "./errors";

export const operatorInvitationSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export const operatorEnrollmentSchema = operatorInvitationSchema.extend({
  password: z.string().min(12, "Use at least 12 characters.")
    .refine(value => Buffer.byteLength(value, "utf8") <= 72, "Password must fit within 72 UTF-8 bytes."),
}).strict();

const UNAVAILABLE = "Invitation is invalid, expired, or already used. Request a new invitation from the administrator.";
function digest(token: string): string { return createHash("sha256").update(token).digest("hex"); }
function failure(error: { code?: string }): never {
  if (error.code === "22023" || error.code === "23505") throw new AuthPublicError(UNAVAILABLE, 400);
  throw new AuthPublicError(GENERIC_AUTH_ERROR_MESSAGE, 500);
}
export async function previewOperatorInvitation(token: string) {
  const { data, error } = await privilegedDb.rpc("preview_governance_operator_invitation_v1", { p_token_hash: digest(token) });
  if (error) failure(error);
  if (!data) throw new AuthPublicError(UNAVAILABLE, 400);
  return data;
}
export async function redeemOperatorInvitation(token: string, password: string): Promise<void> {
  // Check the capability before expensive hashing; the DB rechecks expiry and
  // locks the invitation at consumption. Plaintext never leaves this process.
  await previewOperatorInvitation(token);
  const passwordHash = await hash(password, 12);
  const { error } = await privilegedDb.rpc("redeem_governance_operator_invitation_v1", {
    p_token_hash: digest(token), p_password_hash: `bcrypt:${passwordHash}`,
  });
  if (error) failure(error);
}
