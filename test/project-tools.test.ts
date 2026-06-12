import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRipgrepBackend,
  normalizeProjectPath,
  relativeProjectPath,
  resolveProjectPath
} from "../src/tools/project/index.js";

async function makeTempProject(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function removeTempProject(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

describe("project tool path helpers", () => {
  it("resolves cwd-relative paths inside the project", async () => {
    const cwd = await makeTempProject("openharness-paths-");
    try {
      writeFileSync(join(cwd, "package.json"), "{}\n", "utf8");

      expect(resolveProjectPath(cwd, "package.json")).toBe(
        resolve(cwd, "package.json")
      );
      expect(relativeProjectPath(cwd, join(cwd, "package.json"))).toBe(
        "package.json"
      );
      expect(normalizeProjectPath("nested\\file.txt")).toBe(
        "nested/file.txt"
      );
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects paths outside cwd", async () => {
    const cwd = await makeTempProject("openharness-paths-outside-");
    try {
      expect(() => resolveProjectPath(cwd, "..")).toThrow(
        "Path escapes project cwd"
      );
      expect(() => relativeProjectPath(cwd, resolve(cwd, ".."))).toThrow(
        "Path escapes project cwd"
      );
    } finally {
      await removeTempProject(cwd);
    }
  });
});

describe("ripgrep backend", () => {
  it("runs packaged ripgrep and lists a project file", async () => {
    const cwd = await makeTempProject("openharness-rg-backend-");
    try {
      writeFileSync(join(cwd, "alpha.txt"), "alpha\n", "utf8");

      const result = await createRipgrepBackend().run(
        ["--files", "--color", "never", "."],
        { cwd, timeoutMs: 5000 }
      );

      expect(result).toMatchObject({
        backend: "ripgrep",
        stderr: "",
        exitCode: 0,
        signal: null,
        timedOut: false
      });
      expect(
        result.stdout
          .split(/\r?\n/u)
          .map(normalizeProjectPath)
          .some((line) => line.endsWith("alpha.txt"))
      ).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("returns stable metadata fields when timeout is very short", async () => {
    const cwd = await makeTempProject("openharness-rg-timeout-");
    try {
      writeFileSync(join(cwd, "beta.txt"), "beta\n", "utf8");

      const result = await createRipgrepBackend().run(
        ["--files", "--color", "never", "."],
        { cwd, timeoutMs: 1 }
      );

      expect(result.backend).toBe("ripgrep");
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
      expect(
        typeof result.exitCode === "number" || result.exitCode === null
      ).toBe(true);
      expect(typeof result.timedOut).toBe("boolean");
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await removeTempProject(cwd);
    }
  });
});
