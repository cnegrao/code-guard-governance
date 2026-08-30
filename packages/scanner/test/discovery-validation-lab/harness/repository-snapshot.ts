import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { isDiscoveryPathExcluded } from "../../../src/discovery/path-policy.ts";
import {
  compareStableText,
  normalizeDiscoverablePath,
  normalizeSourcePath,
} from "./normalize.ts";

export interface RepositorySnapshotFile {
  readonly path: string;
  readonly size: number;
}

export interface RepositorySnapshot {
  readonly rootPath: string;
  readonly files: readonly RepositorySnapshotFile[];
  readonly readText: (path: string) => Promise<string>;
}

function assertSafeSnapshotPath(path: string): string {
  const normalized = normalizeDiscoverablePath(path, "Snapshot path");
  if (normalized === "/") {
    throw new TypeError("Snapshot path must identify a repository file");
  }
  return normalized;
}

export async function createRepositorySnapshot(
  scenarioDirectory: string,
): Promise<RepositorySnapshot> {
  const rootPath = resolve(scenarioDirectory);
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new TypeError("Repository snapshot root must be a directory");
  }

  const files: RepositorySnapshotFile[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareStableText(left.name, right.name));

    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const repositoryPath = normalizeSourcePath(relative(rootPath, absolutePath));

      // This check happens before recursion and before any future file budget.
      if (isDiscoveryPathExcluded(repositoryPath)) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const fileStat = await stat(absolutePath);
      files.push({ path: repositoryPath, size: fileStat.size });
    }
  }

  await walk(rootPath);
  files.sort((left, right) => compareStableText(left.path, right.path));
  const visiblePaths = new Set(files.map((file) => file.path));

  return Object.freeze({
    rootPath,
    files: Object.freeze(files.map((file) => Object.freeze(file))),
    readText: async (requestedPath: string): Promise<string> => {
      const repositoryPath = assertSafeSnapshotPath(requestedPath);
      if (!visiblePaths.has(repositoryPath)) {
        throw new TypeError(`Path is not present in the snapshot: ${repositoryPath}`);
      }

      const absolutePath = resolve(rootPath, ...repositoryPath.split("/"));
      const relativePath = relative(rootPath, absolutePath);
      if (
        relativePath === ".." ||
        relativePath.startsWith(`..${sep}`) ||
        isAbsolute(relativePath)
      ) {
        throw new TypeError("Snapshot path escapes the repository root");
      }
      return readFile(absolutePath, "utf8");
    },
  });
}
