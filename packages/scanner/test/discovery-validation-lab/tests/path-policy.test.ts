import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDiscoveryPathExcluded } from "../../../src/discovery/path-policy.ts";

describe("Discovery path safety policy", () => {
  it("excludes the reserved namespace at the repository root", () => {
    for (const path of [
      ".govia-lab",
      ".govia-lab/expected.json",
      ".govia-lab/leak-agent.py",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), true, path);
    }
  });

  it("excludes the reserved namespace at any nested depth", () => {
    for (const path of [
      "foo/.govia-lab/expected.json",
      "foo/bar/.govia-lab/test.ts",
      "/repository/foo/.govia-lab/nested/file.ts",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), true, path);
    }
  });

  it("supports Windows separators", () => {
    for (const path of [
      ".govia-lab\\expected.json",
      "foo\\.govia-lab\\expected.json",
      "C:\\repository\\foo\\.govia-lab\\test.ts",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), true, path);
    }
  });

  it("matches the reserved segment case-insensitively", () => {
    for (const path of [
      "foo/.GOVIA-LAB/expected.json",
      "foo/.GovIA-LaB/expected.json",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), true, path);
    }
  });

  it("normalizes harmless current-directory segments", () => {
    for (const path of [
      "./.govia-lab/expected.json",
      "foo/./.govia-lab/./expected.json",
      ".\\foo\\.\\.govia-lab\\expected.json",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), true, path);
    }
  });

  it("handles parent segments conservatively", () => {
    for (const path of [
      ".govia-lab/../safe-looking.ts",
      "foo/.govia-lab/../../safe-looking.ts",
      "foo/../.govia-lab/expected.json",
      "foo\\.govia-lab\\..\\safe-looking.ts",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), true, path);
    }

    assert.equal(isDiscoveryPathExcluded("foo/../bar/file.ts"), false);
  });

  it("allows paths whose segments only resemble the reserved name", () => {
    for (const path of [
      ".govia-lab-other/file.ts",
      "govia-lab/file.ts",
      "foo/my.govia-lab/file.ts",
      "foo/.govia_lab/file.ts",
      "foo.govia-lab\\expected.json",
    ]) {
      assert.equal(isDiscoveryPathExcluded(path), false, path);
    }
  });

  it("allows empty, root, and harmless relative paths", () => {
    for (const path of ["", "/", ".", "./", "src/agent.ts"]) {
      assert.equal(isDiscoveryPathExcluded(path), false, path);
    }
  });
});
