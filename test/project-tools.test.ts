import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createRipgrepBackend,
  normalizeProjectPath,
  relativeProjectPath,
  resolveExistingProjectPath,
  resolveProjectPath
} from "../src/tools/project/index.js";

async function makeTempProject(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function removeTempProject(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

function expectKilledByBackend(result: {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}): void {
  expect(result.exitCode).toBeNull();
  expect(typeof result.signal).toBe("string");
}

function expectNonSuccessTermination(result: {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}): void {
  expect(
    result.exitCode === null
      ? typeof result.signal === "string"
      : result.exitCode !== 0
  ).toBe(true);
}

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
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

  it("realpath-resolves existing paths inside the project", async () => {
    const cwd = await makeTempProject("openharness-realpath-");
    try {
      writeFileSync(join(cwd, "inside.txt"), "inside\n", "utf8");

      await expect(resolveExistingProjectPath(cwd, "inside.txt")).resolves.toBe(
        resolve(cwd, "inside.txt")
      );
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects symlink escapes when symlinks are supported", async () => {
    const cwd = await makeTempProject("openharness-symlink-cwd-");
    const outside = await makeTempProject("openharness-symlink-outside-");
    try {
      const outsideFile = join(outside, "outside.txt");
      const linkPath = join(cwd, "outside-link.txt");
      writeFileSync(outsideFile, "outside\n", "utf8");

      try {
        await symlink(outsideFile, linkPath, "file");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "EPERM" || error.code === "EACCES")
        ) {
          return;
        }

        throw error;
      }

      await expect(
        resolveExistingProjectPath(cwd, "outside-link.txt")
      ).rejects.toThrow("Path escapes project cwd");
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
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
        timedOut: false,
        aborted: false,
        stdoutTruncated: false,
        stderrTruncated: false
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
      expect(typeof result.aborted).toBe("boolean");
      expect(typeof result.stdoutTruncated).toBe("boolean");
      expect(typeof result.stderrTruncated).toBe("boolean");
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("kills ripgrep immediately when timeout is not positive", async () => {
    const cwd = await makeTempProject("openharness-rg-timeout-kill-");
    try {
      writeFileSync(
        join(cwd, "many-timeout-matches.txt"),
        "timeout\n".repeat(250_000),
        "utf8"
      );

      const result = await createRipgrepBackend().run(
        ["--color", "never", "timeout", "."],
        { cwd, timeoutMs: 0 }
      );

      expect(result.timedOut).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.stdoutTruncated).toBe(false);
      expect(result.stderrTruncated).toBe(false);
      expectKilledByBackend(result);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("keeps the first terminal reason when abort and timeout both happen", async () => {
    const cwd = await makeTempProject("openharness-rg-first-terminal-");
    try {
      writeFileSync(join(cwd, "delta.txt"), "delta\n", "utf8");
      const controller = new AbortController();
      controller.abort();

      const result = await createRipgrepBackend().run(
        ["--files", "--color", "never", "."],
        { cwd, timeoutMs: 0, signal: controller.signal }
      );

      expect(result.aborted).toBe(true);
      expect(result.timedOut).toBe(false);
      expectKilledByBackend(result);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("returns command failure metadata without truncation", async () => {
    const cwd = await makeTempProject("openharness-rg-failure-");
    try {
      const result = await createRipgrepBackend().run(["[", "."], {
        cwd,
        timeoutMs: 5000
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.exitCode).not.toBeNull();
      expect(result.signal).toBeNull();
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(result.timedOut).toBe(false);
      expect(result.aborted).toBe(false);
      expect(result.stdoutTruncated).toBe(false);
      expect(result.stderrTruncated).toBe(false);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("truncates stdout and stops the child when stdout exceeds its limit", async () => {
    const cwd = await makeTempProject("openharness-rg-stdout-limit-");
    try {
      writeFileSync(
        join(cwd, "many-matches.txt"),
        "match\n".repeat(250_000),
        "utf8"
      );

      const result = await createRipgrepBackend().run(
        ["--color", "never", "match", "."],
        { cwd, timeoutMs: 5000, maxStdoutBytes: 1 }
      );

      expect(result.stdoutTruncated).toBe(true);
      expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(1);
      expect(result.timedOut).toBe(false);
      expect(result.aborted).toBe(false);
      expectKilledByBackend(result);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("truncates non-ASCII stdout on utf8 boundaries", async () => {
    const cwd = await makeTempProject("openharness-rg-stdout-utf8-limit-");
    try {
      writeFileSync(join(cwd, "unicode.txt"), "中文\n", "utf8");

      const result = await createRipgrepBackend().run(
        ["--color", "never", "--no-filename", "--only-matching", "中文", "."],
        { cwd, timeoutMs: 5000, maxStdoutBytes: 1 }
      );

      expect(result.stdoutTruncated).toBe(true);
      expect(result.stdout).not.toContain("\uFFFD");
      expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(1);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("truncates stderr and stops the child when stderr exceeds its limit", async () => {
    const cwd = await makeTempProject("openharness-rg-stderr-limit-");
    try {
      const result = await createRipgrepBackend().run(["[", "."], {
        cwd,
        timeoutMs: 5000,
        maxStderrBytes: 8
      });

      expect(result.stderrTruncated).toBe(true);
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(8);
      expect(result.timedOut).toBe(false);
      expect(result.aborted).toBe(false);
      expectNonSuccessTermination(result);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("truncates non-ASCII stderr on utf8 boundaries", async () => {
    const cwd = await makeTempProject("openharness-rg-stderr-utf8-limit-");
    try {
      const result = await createRipgrepBackend().run(
        ["--files", "--color", "never", "不存在"],
        { cwd, timeoutMs: 5000, maxStderrBytes: 5 }
      );

      expect(result.stderrTruncated).toBe(true);
      expect(result.stderr).not.toContain("\uFFFD");
      expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(5);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("distinguishes aborted runs from timed-out runs", async () => {
    const cwd = await makeTempProject("openharness-rg-abort-");
    try {
      writeFileSync(join(cwd, "gamma.txt"), "gamma\n", "utf8");
      const controller = new AbortController();
      controller.abort();

      const result = await createRipgrepBackend().run(
        ["--files", "--color", "never", "."],
        { cwd, timeoutMs: 5000, signal: controller.signal }
      );

      expect(result.aborted).toBe(true);
      expect(result.timedOut).toBe(false);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("does not let late abort override a completed process before close", async () => {
    vi.resetModules();

    const controller = new AbortController();
    const fakeChild = new FakeChildProcess();

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => fakeChild)
    }));

    try {
      const { createRipgrepBackend: createMockedBackend } = await import(
        "../src/tools/project/backend.js"
      );
      const resultPromise = createMockedBackend().run(["--files"], {
        cwd: ".",
        timeoutMs: 5000,
        signal: controller.signal
      });

      fakeChild.emit("exit", 0, null);
      controller.abort();
      fakeChild.emit("close", 0, null);
      fakeChild.stdout.end();
      fakeChild.stderr.end();

      await expect(resultPromise).resolves.toMatchObject({
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      });
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });

  it("does not let late timeout override a completed process before close", async () => {
    vi.resetModules();

    const fakeChild = new FakeChildProcess();

    vi.doMock("node:child_process", () => ({
      spawn: vi.fn(() => fakeChild)
    }));

    try {
      const { createRipgrepBackend: createMockedBackend } = await import(
        "../src/tools/project/backend.js"
      );
      const resultPromise = createMockedBackend().run(["--files"], {
        cwd: ".",
        timeoutMs: 1
      });

      fakeChild.emit("exit", 0, null);
      await delay(10);
      fakeChild.emit("close", 0, null);
      fakeChild.stdout.end();
      fakeChild.stderr.end();

      await expect(resultPromise).resolves.toMatchObject({
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false
      });
    } finally {
      vi.doUnmock("node:child_process");
      vi.resetModules();
    }
  });
});
