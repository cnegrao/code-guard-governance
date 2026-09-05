import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, it } from 'node:test';

import { LocalRepositoryAdapter } from '../../src/discovery/adapters/local-repository-adapter';

async function withTempRepository(
  build: (root: string) => Promise<void>,
  run: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'discovery-engine-adapter-'));
  try {
    await build(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('LocalRepositoryAdapter', () => {
  it('enumerates files deterministically, sorted by locator', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'b.txt'), 'b');
        await writeFile(join(root, 'a.txt'), 'a');
        await mkdir(join(root, 'nested'));
        await writeFile(join(root, 'nested', 'c.txt'), 'c');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const first = await adapter.listArtifacts();
        const second = await adapter.listArtifacts();

        assert.deepEqual(
          first.map((artifact) => artifact.locator),
          ['a.txt', 'b.txt', 'nested/c.txt'],
        );
        assert.deepEqual(first, second, 're-listing the same directory must be byte-identical');
      },
    );
  });

  it('normalizes nested locators to forward slashes regardless of platform separator', async () => {
    await withTempRepository(
      async (root) => {
        await mkdir(join(root, 'src', 'lib'), { recursive: true });
        await writeFile(join(root, 'src', 'lib', 'agent.py'), 'kind = "agent"\n');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const artifacts = await adapter.listArtifacts();
        assert.equal(artifacts.length, 1);
        assert.equal(artifacts[0].locator, 'src/lib/agent.py');
        assert.equal(artifacts[0].locator.includes('\\'), false);

        const outcome = await adapter.readArtifact('src/lib/agent.py');
        assert.equal(outcome.ok, true);
        if (outcome.ok) {
          assert.equal(outcome.content.locator, 'src/lib/agent.py');
        }
      },
    );
  });

  it('excludes the reserved .govia-lab namespace at any depth', async () => {
    await withTempRepository(
      async (root) => {
        await mkdir(join(root, '.govia-lab'), { recursive: true });
        await writeFile(join(root, '.govia-lab', 'expected.json'), '{}');
        await mkdir(join(root, 'nested', '.govia-lab'), { recursive: true });
        await writeFile(join(root, 'nested', '.govia-lab', 'leak.json'), '{}');
        await writeFile(join(root, 'visible.txt'), 'ok');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const artifacts = await adapter.listArtifacts();
        assert.deepEqual(artifacts.map((artifact) => artifact.locator), ['visible.txt']);

        const outcome = await adapter.readArtifact('.govia-lab/expected.json');
        assert.equal(outcome.ok, false);
      },
    );
  });

  it('excludes .git and node_modules directories (nested repos / generated state)', async () => {
    await withTempRepository(
      async (root) => {
        await mkdir(join(root, '.git'), { recursive: true });
        await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
        await mkdir(join(root, 'packages', 'nested-repo', 'node_modules', 'dep'), {
          recursive: true,
        });
        await writeFile(
          join(root, 'packages', 'nested-repo', 'node_modules', 'dep', 'index.js'),
          'module.exports = {};',
        );
        await mkdir(join(root, 'packages', 'nested-repo', '.git'), { recursive: true });
        await writeFile(join(root, 'packages', 'nested-repo', '.git', 'HEAD'), 'ref: refs/heads/main');
        await writeFile(join(root, 'packages', 'nested-repo', 'src.py'), 'kind = "agent"');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const artifacts = await adapter.listArtifacts();
        assert.deepEqual(
          artifacts.map((artifact) => artifact.locator),
          ['packages/nested-repo/src.py'],
        );
      },
    );
  });

  it('rejects path traversal locators when reading an artifact', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'inside.txt'), 'inside');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const outcome = await adapter.readArtifact('../inside.txt');
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assert.match(outcome.reason, /traversal/i);
        }
      },
    );
  });

  it('rejects Windows drive-letter and UNC-shaped locators', async () => {
    await withTempRepository(
      async () => {},
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const drive = await adapter.readArtifact('C:\\Windows\\System32\\config');
        assert.equal(drive.ok, false);

        const unc = await adapter.readArtifact('\\\\server\\share\\file.txt');
        assert.equal(unc.ok, false);
      },
    );
  });

  it('fails closed on an artifact that is not valid UTF-8 text', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'binary.bin'), Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]));
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const outcome = await adapter.readArtifact('binary.bin');
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assert.match(outcome.reason, /UTF-8/);
        }
      },
    );
  });

  it('fails closed when the locator identifies a directory, not a file (unsupported artifact kind)', async () => {
    await withTempRepository(
      async (root) => {
        await mkdir(join(root, 'a-directory'), { recursive: true });
        await writeFile(join(root, 'a-directory', 'inner.txt'), 'inner');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const outcome = await adapter.readArtifact('a-directory');
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assert.match(outcome.reason, /does not identify a file/);
        }
      },
    );
  });

  it('fails closed when the artifact does not exist', async () => {
    await withTempRepository(
      async () => {},
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const outcome = await adapter.readArtifact('missing.txt');
        assert.equal(outcome.ok, false);
      },
    );
  });

  it('returns an empty artifact list for an empty repository', async () => {
    await withTempRepository(
      async () => {},
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const artifacts = await adapter.listArtifacts();
        assert.deepEqual(artifacts, []);
      },
    );
  });

  it('rejects a repository root that does not exist', async () => {
    const adapter = new LocalRepositoryAdapter(join(tmpdir(), 'discovery-engine-does-not-exist' + sep));
    await assert.rejects(adapter.listArtifacts());
  });

  it('preserves provenance: describeSource identifies the resolved root as a REPOSITORY source', async () => {
    await withTempRepository(
      async () => {},
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const descriptor = adapter.describeSource();
        assert.equal(descriptor.family, 'REPOSITORY');
        assert.equal(descriptor.providerCode, 'local-filesystem');
        assert.ok(descriptor.displayName.length > 0);
      },
    );
  });

  it('never exposes fs-specific vocabulary through the adapter surface (core/adapter separation)', async () => {
    await withTempRepository(
      async (root) => {
        await writeFile(join(root, 'a.txt'), 'a');
      },
      async (root) => {
        const adapter = new LocalRepositoryAdapter(root);
        const artifacts = await adapter.listArtifacts();
        for (const artifact of artifacts) {
          assert.deepEqual(Object.keys(artifact).sort(), ['kind', 'locator', 'sizeBytes']);
        }
      },
    );
  });
});
