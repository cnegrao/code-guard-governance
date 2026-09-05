import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createRepositorySnapshot } from "../harness/repository-snapshot.ts";

async function createFile(root: string, path: string, content: string): Promise<void> {
  const segments = path.split("/");
  const fileName = segments.pop()!;
  const directory = join(root, ...segments);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, fileName), content, "utf8");
}

describe("RepositorySnapshot", () => {
  it("enumerates visible files deterministically and excludes the oracle first", async () => {
    const root = await mkdtemp(join(tmpdir(), "govia-snapshot-"));
    try {
      await createFile(root, "z-last.ts", "z");
      await createFile(root, "src/a-first.ts", "a");
      await createFile(root, ".govia-lab/expected.json", "oracle");
      await createFile(root, "nested/.GOVIA-LAB/leak.ts", "leak");
      await createFile(root, ".govia-lab-other/visible.ts", "visible-one");
      await createFile(root, "src/my.govia-lab/visible.ts", "visible-two");

      const first = await createRepositorySnapshot(root);
      const second = await createRepositorySnapshot(root);
      const expectedPaths = [
        ".govia-lab-other/visible.ts",
        "src/a-first.ts",
        "src/my.govia-lab/visible.ts",
        "z-last.ts",
      ];

      assert.deepEqual(first.files.map((file) => file.path), expectedPaths);
      assert.deepEqual(first.files, second.files);
      assert.equal(await first.readText("src\\a-first.ts"), "a");
      await assert.rejects(
        first.readText(".govia-lab/expected.json"),
        /reserved .govia-lab namespace/,
      );
      await assert.rejects(first.readText("../outside.ts"), /traversal/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
