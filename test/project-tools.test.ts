import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createGlobTool,
  createGrepTool,
  createReadFileTool,
  createRipgrepBackend,
  executeRegisteredTool,
  normalizeProjectPath,
  relativeProjectPath,
  resolveExistingProjectPath,
  resolveProjectPath,
  ToolRegistry
} from "../src/tools/index.js";
import {
  createDefaultProjectToolRegistry,
  createDefaultProjectToolRegistry as createDefaultProjectToolRegistryFromRoot,
  registerDefaultProjectTools
} from "../src/index.js";
import type { ReadFileToolInput } from "../src/tools/index.js";
import type {
  RipgrepBackend,
  RipgrepBackendResult
} from "../src/tools/index.js";

const readFileMaxBytes = 1024 * 1024;

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

function expectReadCall(
  read: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  callIndex: number,
  args: {
    readonly offset: number;
    readonly length: number;
    readonly position: number;
  }
): void {
  const call = read.mock.calls[callIndex];

  expect(call?.[1]).toBe(args.offset);
  expect(call?.[2]).toBe(args.length);
  expect(call?.[3]).toBe(args.position);
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

function createFakeRipgrepResult(
  overrides: Partial<RipgrepBackendResult> = {}
): RipgrepBackendResult {
  return {
    backend: "ripgrep",
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    ...overrides
  };
}

function createFakeRipgrepBackend(
  result: RipgrepBackendResult
): RipgrepBackend {
  return {
    run: vi.fn(async () => result)
  };
}

async function executeReadFileTool(
  cwd: string,
  input: unknown
): Promise<Awaited<ReturnType<typeof executeRegisteredTool>>> {
  const registry = new ToolRegistry();
  registry.register(createReadFileTool());

  return await executeRegisteredTool(
    registry,
    {
      toolUseId: "toolu_read_file",
      toolName: "read_file",
      input
    },
    { cwd, metadata: {} }
  );
}

async function executeGlobTool(
  cwd: string,
  input: unknown
): Promise<Awaited<ReturnType<typeof executeRegisteredTool>>> {
  const registry = new ToolRegistry();
  registry.register(createGlobTool());

  return await executeRegisteredTool(
    registry,
    {
      toolUseId: "toolu_glob",
      toolName: "glob",
      input
    },
    { cwd, metadata: {} }
  );
}

async function executeGrepTool(
  cwd: string,
  input: unknown
): Promise<Awaited<ReturnType<typeof executeRegisteredTool>>> {
  const registry = new ToolRegistry();
  registry.register(createGrepTool());

  return await executeRegisteredTool(
    registry,
    {
      toolUseId: "toolu_grep",
      toolName: "grep",
      input
    },
    { cwd, metadata: {} }
  );
}

async function executeReadFileWithMockedReadSizes(
  readSizes: readonly number[]
) {
  vi.resetModules();

  const maxBytes = readFileMaxBytes;
  const resolvedPath = "C:\\project\\growing.txt";
  let readIndex = 0;
  const read = vi.fn(async (buffer: Buffer) => {
    const bytesRead = readSizes[readIndex] ?? 0;
    readIndex += 1;
    buffer.fill(0x61, 0, bytesRead);

    return {
      bytesRead,
      buffer
    };
  });
  const close = vi.fn(async () => undefined);

  vi.doMock("node:fs/promises", () => ({
    realpath: vi.fn(async (path: string) => path),
    stat: vi.fn(async () => ({
      size: 1,
      isDirectory: () => false,
      isFile: () => true
    })),
    open: vi.fn(async () => ({ read, close }))
  }));

  try {
    const { createReadFileTool: createMockedReadFileTool } = await import(
      "../src/tools/project/read-file.js"
    );

    const result = await createMockedReadFileTool().execute(
      { path: "growing.txt" },
      { cwd: "C:\\project", metadata: {} }
    );

    return {
      result,
      read,
      close,
      maxBytes,
      resolvedPath
    };
  } finally {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
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

describe("read_file project tool", () => {
  it("publishes integer offset and limit schema through the registry", () => {
    const registry = new ToolRegistry();
    registry.register(createReadFileTool());

    expect(registry.toApiSchema()).toEqual([
      expect.objectContaining({
        name: "read_file",
        input_schema: expect.objectContaining({
          additionalProperties: false,
          properties: expect.objectContaining({
            offset: expect.objectContaining({ type: "integer" }),
            limit: expect.objectContaining({ type: "integer" })
          })
        })
      })
    ]);
  });

  it("reads a UTF-8 file with line numbers", async () => {
    const cwd = await makeTempProject("openharness-read-file-");
    try {
      writeFileSync(join(cwd, "alpha.txt"), "alpha\nbeta\ngamma\n", "utf8");

      const result = await executeReadFileTool(cwd, { path: "alpha.txt" });

      expect(result).toMatchObject({
        output: "     1\talpha\n     2\tbeta\n     3\tgamma",
        isError: false,
        metadata: {
          tool: "read_file",
          resolvedPath: join(cwd, "alpha.txt"),
          offset: 0,
          limit: 200,
          lineCount: 3,
          returnedLineCount: 3,
          truncated: false,
          binary: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("supports offset and limit", async () => {
    const cwd = await makeTempProject("openharness-read-file-range-");
    try {
      writeFileSync(
        join(cwd, "range.txt"),
        "one\ntwo\nthree\nfour\n",
        "utf8"
      );

      const result = await executeReadFileTool(cwd, {
        path: "range.txt",
        offset: 1,
        limit: 2
      });

      expect(result).toMatchObject({
        output: "     2\ttwo\n     3\tthree",
        isError: false,
        metadata: {
          offset: 1,
          limit: 2,
          lineCount: 4,
          returnedLineCount: 2,
          truncated: true,
          binary: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("directly executes a successful read", async () => {
    const cwd = await makeTempProject("openharness-read-file-direct-");
    try {
      writeFileSync(join(cwd, "direct.txt"), "direct\n", "utf8");

      const result = await createReadFileTool().execute(
        { path: "direct.txt" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "     1\tdirect",
        isError: false,
        metadata: {
          tool: "read_file",
          offset: 0,
          limit: 200,
          lineCount: 1,
          returnedLineCount: 1,
          truncated: false,
          binary: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("directly rejects invalid input", async () => {
    const cwd = await makeTempProject("openharness-read-file-direct-invalid-");
    try {
      const result = await createReadFileTool().execute(
        null as unknown as ReadFileToolInput,
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: expect.stringContaining("Invalid input for read_file"),
        isError: true,
        metadata: { tool: "read_file" }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("handles empty files, offsets beyond EOF, and files without trailing newline", async () => {
    const cwd = await makeTempProject("openharness-read-file-boundaries-");
    try {
      const emptyPath = join(cwd, "empty.txt");
      const noTrailingNewlinePath = join(cwd, "no-newline.txt");
      writeFileSync(emptyPath, "", "utf8");
      writeFileSync(noTrailingNewlinePath, "last line", "utf8");

      const empty = await executeReadFileTool(cwd, { path: "empty.txt" });
      expect(empty).toMatchObject({
        output: `(no content in selected range for ${emptyPath})`,
        isError: false,
        metadata: {
          lineCount: 0,
          returnedLineCount: 0,
          truncated: false
        }
      });

      const beyondEof = await executeReadFileTool(cwd, {
        path: "no-newline.txt",
        offset: 2
      });
      expect(beyondEof).toMatchObject({
        output: `(no content in selected range for ${noTrailingNewlinePath})`,
        isError: false,
        metadata: {
          lineCount: 1,
          returnedLineCount: 0,
          truncated: false
        }
      });

      const noTrailingNewline = await executeReadFileTool(cwd, {
        path: "no-newline.txt"
      });
      expect(noTrailingNewline).toMatchObject({
        output: "     1\tlast line",
        isError: false,
        metadata: {
          lineCount: 1,
          returnedLineCount: 1,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects missing files, directories, binary files, and path escapes", async () => {
    const cwd = await makeTempProject("openharness-read-file-errors-");
    try {
      writeFileSync(join(cwd, "binary.bin"), Buffer.from([0x61, 0x00, 0x62]));
      writeFileSync(join(cwd, "invalid-utf8.txt"), Buffer.from([0xc3, 0x28]));

      const missing = await executeReadFileTool(cwd, { path: "missing.txt" });
      expect(missing.isError).toBe(true);
      expect(missing.metadata).toMatchObject({ tool: "read_file" });

      const directory = await executeReadFileTool(cwd, { path: "." });
      expect(directory.isError).toBe(true);
      expect(directory.output).toContain("regular file");
      expect(directory.metadata).toMatchObject({ tool: "read_file" });

      const binary = await executeReadFileTool(cwd, { path: "binary.bin" });
      expect(binary).toMatchObject({
        isError: true,
        metadata: {
          tool: "read_file",
          resolvedPath: join(cwd, "binary.bin"),
          binary: true
        }
      });

      const invalidUtf8 = await executeReadFileTool(cwd, {
        path: "invalid-utf8.txt"
      });
      expect(invalidUtf8).toMatchObject({
        isError: true,
        metadata: {
          tool: "read_file",
          resolvedPath: join(cwd, "invalid-utf8.txt"),
          binary: true
        }
      });

      const escaped = await executeReadFileTool(cwd, { path: "../outside.txt" });
      expect(escaped.isError).toBe(true);
      expect(escaped.output).toContain("Path escapes project cwd");
      expect(escaped.metadata).toMatchObject({ tool: "read_file" });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects files above the read size limit before reading content", async () => {
    const cwd = await makeTempProject("openharness-read-file-large-");
    try {
      const largePath = join(cwd, "large.txt");
      writeFileSync(largePath, Buffer.alloc(1024 * 1024 + 1, 0x61));

      const result = await executeReadFileTool(cwd, { path: "large.txt" });

      expect(result).toMatchObject({
        output: expect.stringContaining("exceeds read_file size limit"),
        isError: true,
        metadata: {
          tool: "read_file",
          resolvedPath: largePath,
          fileSizeBytes: 1024 * 1024 + 1,
          maxBytes: 1024 * 1024
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects a short capped read followed by one byte over the limit", async () => {
    const { result, read, close, maxBytes, resolvedPath } =
      await executeReadFileWithMockedReadSizes([readFileMaxBytes, 1]);

    expect(result).toMatchObject({
      output: expect.stringContaining("exceeds read_file size limit"),
      isError: true,
      metadata: {
        tool: "read_file",
        resolvedPath,
        fileSizeBytes: maxBytes + 1,
        maxBytes
      }
    });
    expect(read).toHaveBeenCalledTimes(2);
    expectReadCall(read, 0, {
      offset: 0,
      length: maxBytes + 1,
      position: 0
    });
    expectReadCall(read, 1, {
      offset: 0,
      length: 1,
      position: maxBytes
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("allows exactly max bytes followed by EOF", async () => {
    const { result, read, close, maxBytes } =
      await executeReadFileWithMockedReadSizes([readFileMaxBytes, 0]);

    expect(result.isError).toBe(false);
    expect(result.output.startsWith("     1\t")).toBe(true);
    expect(result.metadata).toMatchObject({
      tool: "read_file",
      lineCount: 1,
      returnedLineCount: 1,
      truncated: false,
      binary: false
    });
    expect(read).toHaveBeenCalledTimes(2);
    expectReadCall(read, 0, {
      offset: 0,
      length: maxBytes + 1,
      position: 0
    });
    expectReadCall(read, 1, {
      offset: 0,
      length: 1,
      position: maxBytes
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("allows a short read followed by EOF", async () => {
    const { result, read, close } = await executeReadFileWithMockedReadSizes([
      5,
      0
    ]);

    expect(result).toMatchObject({
      output: "     1\taaaaa",
      isError: false,
      metadata: {
        tool: "read_file",
        lineCount: 1,
        returnedLineCount: 1,
        truncated: false,
        binary: false
      }
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("rejects symlink escapes when symlinks are supported", async () => {
    const cwd = await makeTempProject("openharness-read-file-symlink-cwd-");
    const outside = await makeTempProject("openharness-read-file-symlink-out-");
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

      const result = await executeReadFileTool(cwd, {
        path: "outside-link.txt"
      });

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Path escapes project cwd");
      expect(result.metadata).toMatchObject({ tool: "read_file" });
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("validates input through the registry execution path", async () => {
    const cwd = await makeTempProject("openharness-read-file-validation-");
    try {
      for (const input of [
        null,
        {},
        { path: "" },
        { path: "alpha.txt", offset: 1.5 },
        { path: "alpha.txt", offset: -1 },
        { path: "alpha.txt", limit: 0 },
        { path: "alpha.txt", limit: 2001 },
        { path: "alpha.txt", extra: true }
      ]) {
        const result = await executeReadFileTool(cwd, input);

        expect(result.isError).toBe(true);
        expect(result.output).toContain("Invalid input for read_file");
      }
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("is read-only", () => {
    expect(createReadFileTool().isReadOnly?.({ path: "alpha.txt" })).toBe(true);
  });
});

describe("glob project tool", () => {
  it("lists matching files with ripgrep metadata", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "alpha.ts"), "alpha\n", "utf8");
      writeFileSync(join(cwd, "beta.txt"), "beta\n", "utf8");

      const result = await createGlobTool().execute(
        { pattern: "**/*.ts", limit: 10 },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "alpha.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          root: cwd,
          pattern: "**/*.ts",
          matchedFileCount: 1,
          truncated: false
        }
      });
      expect(result.metadata.durationMs).toEqual(expect.any(Number));
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("matches bare patterns against basenames without hidden files outside git repositories", async () => {
    const cwd = await makeTempProject("openharness-glob-bare-rg-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "root.ts"), "root\n", "utf8");
      writeFileSync(join(cwd, "src", "nested.ts"), "nested\n", "utf8");

      const result = await createGlobTool().execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "root.ts\nsrc/nested.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 2,
          truncated: false
        }
      });
      expect(result.output).not.toContain(".hidden/dot.ts");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("includes hidden bare-pattern matches inside git repositories", async () => {
    const cwd = await makeTempProject("openharness-glob-bare-git-rg-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, ".hidden"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "root.ts"), "root\n", "utf8");
      writeFileSync(join(cwd, "src", "nested.ts"), "nested\n", "utf8");

      const result = await createGlobTool().execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: ".hidden/dot.ts\nroot.ts\nsrc/nested.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 3,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("includes hidden matches when ripgrep starts from a git repo subdirectory", async () => {
    const repoRoot = await makeTempProject("openharness-glob-subdir-git-rg-");
    try {
      const cwd = join(repoRoot, "packages", "app");
      mkdirSync(join(repoRoot, ".git"));
      mkdirSync(join(cwd, ".hidden"), { recursive: true });
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "visible.ts"), "visible\n", "utf8");

      const result = await createGlobTool().execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: ".hidden/dot.ts\nvisible.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 2,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(repoRoot);
    }
  });

  it("ripgrep broad matches skip git internals while keeping other hidden paths", async () => {
    const cwd = await makeTempProject("openharness-glob-git-internals-rg-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".git", "config"), "git\n", "utf8");
      writeFileSync(
        join(cwd, ".github", "workflows", "ci.yml"),
        "ci\n",
        "utf8"
      );
      writeFileSync(join(cwd, ".hidden", "file.ts"), "hidden\n", "utf8");
      writeFileSync(join(cwd, "visible.txt"), "visible\n", "utf8");

      const result = await createGlobTool().execute(
        { pattern: "**/*" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: ".github/workflows/ci.yml\n.hidden/file.ts\nvisible.txt",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          root: cwd,
          pattern: "**/*",
          matchedFileCount: 3,
          truncated: false
        }
      });
      expect(result.output).not.toContain(".git/config");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("accepts path as pattern alias and rejects ambiguous pattern and path through the registry", async () => {
    const cwd = await makeTempProject("openharness-glob-alias-");
    try {
      writeFileSync(join(cwd, "alias.ts"), "alias\n", "utf8");
      const registry = new ToolRegistry();
      registry.register(createGlobTool());

      const alias = await executeRegisteredTool(
        registry,
        {
          toolUseId: "toolu_glob_alias",
          toolName: "glob",
          input: { path: "*.ts" }
        },
        { cwd, metadata: {} }
      );
      const ambiguous = await executeRegisteredTool(
        registry,
        {
          toolUseId: "toolu_glob_ambiguous",
          toolName: "glob",
          input: { pattern: "*.ts", path: "*.js" }
        },
        { cwd, metadata: {} }
      );

      expect(alias).toMatchObject({
        output: "alias.ts",
        isError: false,
        metadata: {
          tool: "glob",
          pattern: "*.ts"
        }
      });
      expect(ambiguous).toMatchObject({
        output: expect.stringContaining("Invalid input for glob"),
        isError: true
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("applies root, limit, truncation metadata, and path safety", async () => {
    const cwd = await makeTempProject("openharness-glob-root-");
    try {
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "a.ts"), "a\n", "utf8");
      writeFileSync(join(cwd, "src", "b.ts"), "b\n", "utf8");
      writeFileSync(join(cwd, "src", "note.txt"), "note\n", "utf8");
      writeFileSync(join(cwd, "root-file.txt"), "root\n", "utf8");

      const limited = await createGlobTool().execute(
        { pattern: "*.ts", root: "src", limit: 1 },
        { cwd, metadata: {} }
      );
      const escaped = await createGlobTool().execute(
        { pattern: "*.ts", root: ".." },
        { cwd, metadata: {} }
      );
      const fileRoot = await createGlobTool().execute(
        { pattern: "*.txt", root: "root-file.txt" },
        { cwd, metadata: {} }
      );

      expect(limited).toMatchObject({
        output: "a.ts",
        isError: false,
        metadata: {
          tool: "glob",
          root: join(cwd, "src"),
          matchedFileCount: 1,
          truncated: true
        }
      });
      expect(escaped.isError).toBe(true);
      expect(escaped.output).toContain("Path escapes project cwd");
      expect(escaped.metadata).toMatchObject({ tool: "glob" });
      expect(fileRoot).toMatchObject({
        output: expect.stringContaining("search root must be a directory"),
        isError: true,
        metadata: {
          tool: "glob",
          root: join(cwd, "root-file.txt")
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects symlink root escapes when symlinks are supported", async () => {
    const cwd = await makeTempProject("openharness-glob-symlink-cwd-");
    const outside = await makeTempProject("openharness-glob-symlink-out-");
    try {
      const linkPath = join(cwd, "outside-link");

      try {
        await symlink(outside, linkPath, "junction");
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

      const result = await createGlobTool().execute(
        { pattern: "*.txt", root: "outside-link" },
        { cwd, metadata: {} }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("Path escapes project cwd");
      expect(result.metadata).toMatchObject({ tool: "glob" });
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("uses tinyglobby fallback when ripgrep is disabled", async () => {
    const cwd = await makeTempProject("openharness-glob-fallback-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "visible.ts"), "visible\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "**/*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "visible.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          root: cwd,
          pattern: "**/*.ts",
          matchedFileCount: 1,
          truncated: false
        }
      });
      expect(result.output).not.toContain(".hidden/dot.ts");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("allows matched file names containing dot-dot without traversal", async () => {
    const cwd = await makeTempProject("openharness-glob-dotdot-name-");
    try {
      writeFileSync(join(cwd, "foo..bar"), "ok\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "foo..bar" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "foo..bar",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          matchedFileCount: 1,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("fallback matches bare patterns against basenames without hidden files outside git repositories", async () => {
    const cwd = await makeTempProject("openharness-glob-bare-fallback-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "root.ts"), "root\n", "utf8");
      writeFileSync(join(cwd, "src", "nested.ts"), "nested\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "root.ts\nsrc/nested.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 2,
          truncated: false
        }
      });
      expect(result.output).not.toContain(".hidden/dot.ts");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("fallback includes hidden bare-pattern matches inside git repositories", async () => {
    const cwd = await makeTempProject("openharness-glob-bare-git-fallback-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, ".hidden"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "root.ts"), "root\n", "utf8");
      writeFileSync(join(cwd, "src", "nested.ts"), "nested\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: ".hidden/dot.ts\nroot.ts\nsrc/nested.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 3,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("fallback includes hidden matches from a git repo subdirectory", async () => {
    const repoRoot = await makeTempProject(
      "openharness-glob-subdir-git-fallback-"
    );
    try {
      const cwd = join(repoRoot, "packages", "app");
      mkdirSync(join(repoRoot, ".git"));
      mkdirSync(join(cwd, ".hidden"), { recursive: true });
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "visible.ts"), "visible\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: ".hidden/dot.ts\nvisible.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 2,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(repoRoot);
    }
  });

  it("fallback broad matches skip git internals while keeping other hidden paths", async () => {
    const cwd = await makeTempProject("openharness-glob-git-internals-fallback-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".git", "config"), "git\n", "utf8");
      writeFileSync(
        join(cwd, ".github", "workflows", "ci.yml"),
        "ci\n",
        "utf8"
      );
      writeFileSync(join(cwd, ".hidden", "file.ts"), "hidden\n", "utf8");
      writeFileSync(join(cwd, "visible.txt"), "visible\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "**/*" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: ".github/workflows/ci.yml\n.hidden/file.ts\nvisible.txt",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          root: cwd,
          pattern: "**/*",
          matchedFileCount: 3,
          truncated: false
        }
      });
      expect(result.output).not.toContain(".git/config");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("aborts fallback glob traversal", async () => {
    const cwd = await makeTempProject("openharness-glob-fallback-abort-");
    try {
      const controller = new AbortController();
      controller.abort();

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "**/*" },
        { cwd, metadata: {}, signal: controller.signal }
      );

      expect(result).toMatchObject({
        isError: true,
        output: "glob was aborted",
        metadata: {
          tool: "glob",
          backend: "fallback",
          timedOut: false,
          aborted: true
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("times out fallback glob traversal even when the fallback does not resolve", async () => {
    const cwd = await makeTempProject("openharness-glob-fallback-timeout-");
    const glob = vi.fn(
      async () => await new Promise<string[]>(() => undefined)
    );
    vi.resetModules();
    vi.doMock("tinyglobby", () => ({ glob }));

    try {
      const { createGlobTool: createMockedGlobTool } = await import(
        "../src/tools/project/glob.js"
      );
      const result = await createMockedGlobTool({
        disableRipgrep: true,
        timeoutMs: 1
      }).execute({ pattern: "**/*" }, { cwd, metadata: {} });

      expect(result).toMatchObject({
        isError: true,
        output: "glob timed out after 1ms",
        metadata: {
          tool: "glob",
          backend: "fallback",
          timedOut: true,
          aborted: false
        }
      });
      expect(glob).toHaveBeenCalledOnce();
      const calls = glob.mock.calls as unknown as ReadonlyArray<
        readonly [unknown, { readonly signal?: AbortSignal }]
      >;
      const options = calls[0]?.[1];
      expect(options?.signal?.aborted).toBe(true);
    } finally {
      vi.doUnmock("tinyglobby");
      vi.resetModules();
      await removeTempProject(cwd);
    }
  });

  it("fallback does not expose files through internal symlinks when symlinks are supported", async () => {
    const cwd = await makeTempProject("openharness-glob-fallback-link-cwd-");
    const outside = await makeTempProject("openharness-glob-fallback-link-out-");
    try {
      const linkPath = join(cwd, "outside-link");
      writeFileSync(join(outside, "outside.ts"), "outside\n", "utf8");

      try {
        await symlink(outside, linkPath, "junction");
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

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "**/*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "(no matches)",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          matchedFileCount: 0,
          truncated: false
        }
      });
      expect(result.output).not.toContain("outside.ts");
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("passes expected args, cwd, timeout, and signal to the ripgrep backend", async () => {
    const cwd = await makeTempProject("openharness-glob-backend-options-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "a.ts"), "a\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({ stdout: "a.ts\n" })
      );
      const controller = new AbortController();

      const result = await createGlobTool({
        backend,
        timeoutMs: 123
      }).execute(
        { pattern: "*.ts", root: "src" },
        { cwd, metadata: {}, signal: controller.signal }
      );

      expect(result.isError).toBe(false);
      expect(result.output).toBe("a.ts");
      expect(backend.run).toHaveBeenCalledWith(
        [
          "--files",
          "--hidden",
          "--color",
          "never",
          "--glob",
          "*.ts",
          "--glob",
          "!.git/**",
          "--glob",
          "!**/.git/**",
          "."
        ],
        {
          cwd: join(cwd, "src"),
          timeoutMs: 123,
          signal: controller.signal
        }
      );
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("skips backend matches that disappear before realpath", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-missing-match-");
    try {
      writeFileSync(join(cwd, "stay.ts"), "stay\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({ stdout: "gone.ts\nstay.ts\n" })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "stay.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          matchedFileCount: 1,
          truncated: false
        }
      });
      expect(result.output).not.toContain("gone.ts");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("treats ripgrep exit code 1 with empty stderr as no matches", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-no-match-");
    try {
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({ exitCode: 1 })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "(no matches)",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          matchedFileCount: 0,
          truncated: false,
          stdoutTruncated: false,
          stderrTruncated: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("falls back to tinyglobby when the ripgrep backend cannot run", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-spawn-fallback-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "dot\n", "utf8");
      writeFileSync(join(cwd, "src", "nested.ts"), "nested\n", "utf8");
      writeFileSync(join(cwd, "visible.ts"), "visible\n", "utf8");
      writeFileSync(join(cwd, "visible.txt"), "visible\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: null,
          stderr: "spawn ENOENT"
        })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "src/nested.ts\nvisible.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "fallback",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 2,
          truncated: false,
          fallbackReason: "spawn ENOENT"
        }
      });
      expect(result.output).not.toContain(".hidden/dot.ts");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("does not fall back when ripgrep times out or is aborted", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-terminal-errors-");
    try {
      const timedOutBackend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: "SIGTERM",
          timedOut: true
        })
      );
      const abortedBackend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: "SIGTERM",
          aborted: true
        })
      );

      const timedOut = await createGlobTool({
        backend: timedOutBackend,
        timeoutMs: 123
      }).execute({ pattern: "*.ts" }, { cwd, metadata: {} });
      const aborted = await createGlobTool({ backend: abortedBackend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(timedOut).toMatchObject({
        output: "glob timed out after 123ms",
        isError: true,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          exitCode: null,
          signal: "SIGTERM"
        }
      });
      expect(aborted).toMatchObject({
        output: "glob was aborted",
        isError: true,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          exitCode: null,
          signal: "SIGTERM"
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("treats concrete ripgrep failures as errors even when stdout is truncated", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-truncated-error-");
    try {
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: 2,
          stdoutTruncated: true
        })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "ripgrep glob failed",
        isError: true,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          stdoutTruncated: true,
          stderrTruncated: false,
          exitCode: 2
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("returns ripgrep backend errors with metadata", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-error-");
    try {
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          stderr: "bad glob",
          exitCode: 2,
          stdoutTruncated: true
        })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "bad glob",
        isError: true,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          stdoutTruncated: true,
          stderrTruncated: false,
          exitCode: 2
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("surfaces stderr truncation metadata on ripgrep backend errors", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-stderr-truncated-");
    try {
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          stderr: "bad",
          exitCode: 2,
          stderrTruncated: true
        })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "bad",
        isError: true,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          stdoutTruncated: false,
          stderrTruncated: true,
          exitCode: 2
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("keeps complete stdout lines after signal termination with truncated stdout", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-truncated-signal-");
    try {
      writeFileSync(join(cwd, "complete.ts"), "complete\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          stdout: "complete.ts\npartial",
          exitCode: null,
          signal: "SIGTERM",
          stdoutTruncated: true
        })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "complete.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          matchedFileCount: 1,
          truncated: true,
          stdoutTruncated: true
        }
      });
      expect(result.output).not.toContain("partial");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("drops a partial final stdout line when ripgrep output is truncated", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-partial-line-");
    try {
      writeFileSync(join(cwd, "complete.ts"), "complete\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          stdout: "complete.ts\npart",
          stdoutTruncated: true
        })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "*.ts" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "complete.ts",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          matchedFileCount: 1,
          truncated: true,
          stdoutTruncated: true
        }
      });
      expect(result.output).not.toContain("part");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("returns no matches output and metadata", async () => {
    const cwd = await makeTempProject("openharness-glob-empty-");
    try {
      writeFileSync(join(cwd, "alpha.txt"), "alpha\n", "utf8");

      const result = await executeGlobTool(cwd, { pattern: "*.ts" });

      expect(result).toMatchObject({
        output: "(no matches)",
        isError: false,
        metadata: {
          tool: "glob",
          backend: "ripgrep",
          root: cwd,
          pattern: "*.ts",
          matchedFileCount: 0,
          truncated: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects escaping glob patterns through the registry", async () => {
    const cwd = await makeTempProject("openharness-glob-pattern-escape-");
    try {
      for (const input of [
        { pattern: "../*.txt" },
        { path: "../*.txt" },
        { pattern: "**/../*" },
        { pattern: "/absolute/*.txt" }
      ]) {
        const result = await executeGlobTool(cwd, input);

        expect(result).toMatchObject({
          output: expect.stringContaining("Invalid input for glob"),
          isError: true
        });
        expect(result.output).toContain("glob pattern must stay within root");
      }
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("does not return outside-root paths through fallback execution", async () => {
    const cwd = await makeTempProject("openharness-glob-fallback-escape-cwd-");
    const outside = await makeTempProject("openharness-glob-fallback-escape-out-");
    try {
      writeFileSync(join(outside, "outside.txt"), "outside\n", "utf8");

      const result = await createGlobTool({ disableRipgrep: true }).execute(
        { pattern: "../*.txt" },
        { cwd, metadata: {} }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("glob pattern must stay within root");
      expect(result.output).not.toContain("outside.txt");
      expect(result.metadata).toMatchObject({ tool: "glob" });
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("does not run ripgrep for outside-root patterns", async () => {
    const cwd = await makeTempProject("openharness-glob-rg-escape-cwd-");
    const outside = await makeTempProject("openharness-glob-rg-escape-out-");
    try {
      writeFileSync(join(outside, "outside.txt"), "outside\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({ stdout: "../outside.txt\n" })
      );

      const result = await createGlobTool({ backend }).execute(
        { pattern: "../*.txt" },
        { cwd, metadata: {} }
      );

      expect(result.isError).toBe(true);
      expect(result.output).toContain("glob pattern must stay within root");
      expect(result.output).not.toContain("outside.txt");
      expect(result.metadata).toMatchObject({ tool: "glob" });
      expect(backend.run).not.toHaveBeenCalled();
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("validates empty pattern, bad limit, additional properties, and schema integer limit", async () => {
    const cwd = await makeTempProject("openharness-glob-validation-");
    try {
      for (const input of [
        null,
        [],
        {},
        { pattern: "" },
        { path: "   " },
        { pattern: "*.ts", limit: 0 },
        { pattern: "*.ts", limit: 1.5 },
        { pattern: "*.ts", limit: 5001 },
        { pattern: "*.ts", extra: true }
      ]) {
        const result = await executeGlobTool(cwd, input);

        expect(result.isError).toBe(true);
        expect(result.output).toContain("Invalid input for glob");
      }

      const registry = new ToolRegistry();
      registry.register(createGlobTool());

      expect(registry.toApiSchema()).toEqual([
        expect.objectContaining({
          name: "glob",
          input_schema: expect.objectContaining({
            additionalProperties: false,
            properties: expect.objectContaining({
              limit: expect.objectContaining({ type: "integer" })
            })
          })
        })
      ]);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("is read-only", () => {
    expect(createGlobTool().isReadOnly?.({ pattern: "*.ts" })).toBe(true);
  });
});

describe("grep project tool", () => {
  it("searches content with ripgrep metadata", async () => {
    const cwd = await makeTempProject("openharness-grep-content-");
    try {
      writeFileSync(join(cwd, "a.ts"), "alpha\nbeta\n", "utf8");

      const result = await executeGrepTool(cwd, {
        pattern: "beta",
        glob: "*.ts",
        headLimit: 10
      });

      expect(result.isError).toBe(false);
      expect(result.output).toContain("a.ts:2:beta");
      expect(result.metadata).toMatchObject({
        tool: "grep",
        backend: "ripgrep",
        root: cwd,
        pattern: "beta",
        outputMode: "content",
        numFiles: 1,
        numLines: 1,
        numMatches: 1,
        appliedLimit: 10,
        appliedOffset: 0,
        timedOut: false
      });
      expect(result.metadata.durationMs).toEqual(expect.any(Number));
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("supports files_with_matches, count, and case-insensitive search", async () => {
    const cwd = await makeTempProject("openharness-grep-modes-");
    try {
      writeFileSync(join(cwd, "a.ts"), "Alpha\nalpha\n", "utf8");

      const files = await executeGrepTool(cwd, {
        pattern: "alpha",
        output_mode: "files_with_matches",
        caseSensitive: false
      });
      const count = await executeGrepTool(cwd, {
        pattern: "alpha",
        outputMode: "count",
        caseSensitive: false
      });

      expect(files).toMatchObject({
        output: "a.ts",
        isError: false,
        metadata: {
          tool: "grep",
          outputMode: "files_with_matches",
          numFiles: 1,
          numMatches: 1
        }
      });
      expect(count).toMatchObject({
        output: "a.ts:2",
        isError: false,
        metadata: {
          tool: "grep",
          outputMode: "count",
          numFiles: 1,
          numMatches: 2
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("parses ripgrep output for file names with separators", async () => {
    const cwd = await makeTempProject("openharness-grep-separator-paths-");
    try {
      mkdirSync(join(cwd, "dir-name"));
      writeFileSync(join(cwd, "my-file.txt"), "needle\n", "utf8");
      writeFileSync(join(cwd, "dir-name", "a.txt"), "one\nneedle\n", "utf8");
      const colonFile = join(cwd, "has:colon.txt");
      try {
        writeFileSync(colonFile, "needle\n", "utf8");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EINVAL"
        ) {
          // Windows file names cannot contain ':'.
        } else {
          throw error;
        }
      }

      const content = await executeGrepTool(cwd, {
        pattern: "needle",
        glob: "**/*.txt"
      });
      const context = await executeGrepTool(cwd, {
        pattern: "needle",
        glob: "dir-name/*.txt",
        context: 1
      });

      expect(content.isError).toBe(false);
      expect(content.output).toContain("my-file.txt:1:needle");
      expect(content.output).toContain("dir-name/a.txt:2:needle");
      if (process.platform !== "win32" && existsSync(colonFile)) {
        expect(content.output).toContain("has:colon.txt:1:needle");
      }
      expect(content.metadata).toMatchObject({
        numFiles:
          process.platform !== "win32" && existsSync(colonFile) ? 3 : 2,
        numMatches:
          process.platform !== "win32" && existsSync(colonFile) ? 3 : 2
      });
      expect(context.output).toContain("dir-name/a.txt-1-one");
      expect(context.output).toContain("dir-name/a.txt:2:needle");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("supports glob and fileGlob aliases", async () => {
    const cwd = await makeTempProject("openharness-grep-glob-alias-");
    try {
      writeFileSync(join(cwd, "a.ts"), "needle\n", "utf8");
      writeFileSync(join(cwd, "b.txt"), "needle\n", "utf8");

      const preferred = await executeGrepTool(cwd, {
        pattern: "needle",
        glob: "*.ts"
      });
      const alias = await executeGrepTool(cwd, {
        pattern: "needle",
        fileGlob: "*.txt"
      });
      const ambiguous = await executeGrepTool(cwd, {
        pattern: "needle",
        glob: "*.ts",
        fileGlob: "*.txt"
      });

      expect(preferred.output).toBe("a.ts:1:needle");
      expect(alias.output).toBe("b.txt:1:needle");
      expect(ambiguous).toMatchObject({
        output: expect.stringContaining("Invalid input for grep"),
        isError: true
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("supports context and rejects ambiguous context options", async () => {
    const cwd = await makeTempProject("openharness-grep-context-");
    try {
      writeFileSync(join(cwd, "a.txt"), "one\ntwo\nthree\n", "utf8");

      const contextResult = await executeGrepTool(cwd, {
        pattern: "two",
        context: 1
      });
      const ambiguous = await executeGrepTool(cwd, {
        pattern: "two",
        context: 1,
        beforeContext: 1
      });

      expect(contextResult.isError).toBe(false);
      expect(contextResult.output).toContain("a.txt-1-one");
      expect(contextResult.output).toContain("a.txt:2:two");
      expect(contextResult.output).toContain("a.txt-3-three");
      expect(ambiguous).toMatchObject({
        output: expect.stringContaining(
          "context cannot be combined with beforeContext or afterContext"
        ),
        isError: true
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("applies offset and head limit", async () => {
    const cwd = await makeTempProject("openharness-grep-limits-");
    try {
      writeFileSync(
        join(cwd, "a.txt"),
        "match one\nmatch two\nmatch three\n",
        "utf8"
      );

      const result = await executeGrepTool(cwd, {
        pattern: "match",
        offset: 1,
        head_limit: 1
      });

      expect(result).toMatchObject({
        output: "a.txt:2:match two",
        isError: false,
        metadata: {
          tool: "grep",
          numMatches: 3,
          numLines: 1,
          appliedLimit: 1,
          appliedOffset: 1,
          truncated: true
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("returns no matches output and metadata", async () => {
    const cwd = await makeTempProject("openharness-grep-empty-");
    try {
      writeFileSync(join(cwd, "a.txt"), "alpha\n", "utf8");

      const result = await executeGrepTool(cwd, { pattern: "missing" });

      expect(result).toMatchObject({
        output: "(no matches)",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          root: cwd,
          pattern: "missing",
          outputMode: "content",
          numFiles: 0,
          numLines: 0,
          numMatches: 0,
          appliedLimit: 200,
          appliedOffset: 0,
          timedOut: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("marks grep results truncated when backend stdout is truncated", async () => {
    const cwd = await makeTempProject("openharness-grep-stdout-truncated-");
    try {
      writeFileSync(join(cwd, "a.txt"), "needle\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          stdout: "a.txt:1:needle\npartial",
          stdoutTruncated: true
        })
      );

      const result = await createGrepTool({ backend }).execute(
        { pattern: "needle" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "a.txt:1:needle",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          numFiles: 1,
          numMatches: 1,
          truncated: true,
          stdoutTruncated: true
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("passes expected args, cwd, timeout, and signal to the ripgrep backend", async () => {
    const cwd = await makeTempProject("openharness-grep-backend-options-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "src", "a.ts"), "beta\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({ stdout: "a.ts:1:beta\n" })
      );
      const controller = new AbortController();

      const result = await createGrepTool({ backend }).execute(
        {
          pattern: "beta",
          root: "src",
          glob: "*.ts",
          type: "ts",
          outputMode: "content",
          caseSensitive: false,
          multiline: true,
          beforeContext: 1,
          afterContext: 2,
          headLimit: 5,
          offset: 0,
          timeoutSeconds: 7
        },
        { cwd, metadata: {}, signal: controller.signal }
      );

      expect(result.isError).toBe(false);
      expect(backend.run).toHaveBeenCalledWith(
        [
          "--no-heading",
          "--line-number",
          "--color",
          "never",
          "--hidden",
          "--glob",
          "*.ts",
          "--glob",
          "!.git/**",
          "--glob",
          "!**/.git/**",
          "--type",
          "ts",
          "-i",
          "--multiline",
          "-B",
          "1",
          "-A",
          "2",
          "--",
          "beta",
          "."
        ],
        {
          cwd: join(cwd, "src"),
          timeoutMs: 7000,
          signal: controller.signal
        }
      );
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("keeps git internals excluded even when the requested glob targets them", async () => {
    const cwd = await makeTempProject("openharness-grep-user-git-glob-");
    try {
      mkdirSync(join(cwd, ".git"));
      writeFileSync(join(cwd, ".git", "config"), "needle\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({ stdout: ".git/config:1:needle\n" })
      );

      const result = await createGrepTool({ backend }).execute(
        { pattern: "needle", glob: ".git/**" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "(no matches)",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          numFiles: 0,
          numMatches: 0
        }
      });
      expect(backend.run).toHaveBeenCalledWith(
        [
          "--no-heading",
          "--line-number",
          "--color",
          "never",
          "--hidden",
          "--glob",
          ".git/**",
          "--glob",
          "!.git/**",
          "--glob",
          "!**/.git/**",
          "--",
          "needle",
          "."
        ],
        {
          cwd,
          timeoutMs: 20_000
        }
      );
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("surfaces ripgrep invalid regex and backend errors", async () => {
    const cwd = await makeTempProject("openharness-grep-rg-invalid-");
    try {
      writeFileSync(join(cwd, "a.txt"), "alpha\n", "utf8");

      const invalid = await executeGrepTool(cwd, { pattern: "match(" });
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: 2,
          stderr: "regex parse error",
          stderrTruncated: true
        })
      );
      const backendError = await createGrepTool({ backend }).execute(
        { pattern: "alpha" },
        { cwd, metadata: {} }
      );

      expect(invalid).toMatchObject({
        isError: true,
        metadata: {
          tool: "grep",
          backend: "ripgrep"
        }
      });
      expect(invalid.output.toLowerCase()).toContain("regex");
      expect(backendError).toMatchObject({
        output: "regex parse error",
        isError: true,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          exitCode: 2,
          stderrTruncated: true
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("falls back to regex search when ripgrep is disabled", async () => {
    const cwd = await makeTempProject("openharness-grep-fallback-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".hidden", "dot.ts"), "needle\n", "utf8");
      writeFileSync(join(cwd, "a.ts"), "needle\n", "utf8");
      writeFileSync(join(cwd, "binary.ts"), Buffer.from([0, 110, 101]));

      const result = await createGrepTool({ disableRipgrep: true }).execute(
        { pattern: "needle", glob: "*.ts", headLimit: 10 },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "a.ts:1:needle",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "fallback",
          root: cwd,
          pattern: "needle",
          outputMode: "content",
          numFiles: 1,
          numMatches: 1,
          timedOut: false
        }
      });
      expect(result.output).not.toContain(".hidden/dot.ts");
      expect(result.output).not.toContain("binary.ts");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("falls back when the ripgrep backend cannot run", async () => {
    const cwd = await makeTempProject("openharness-grep-rg-spawn-fallback-");
    try {
      writeFileSync(join(cwd, "a.txt"), "needle\n", "utf8");
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: null,
          stderr: "spawn ENOENT"
        })
      );

      const result = await createGrepTool({ backend }).execute(
        { pattern: "needle" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "a.txt:1:needle",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "fallback",
          fallbackReason: "spawn ENOENT"
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects complex fallback regex patterns before scanning files", async () => {
    const cwd = await makeTempProject("openharness-grep-fallback-redos-");
    try {
      writeFileSync(join(cwd, "a.txt"), `${"a".repeat(100)}!\n`, "utf8");

      for (const pattern of [
        "(a|aa)+$",
        "(a{1,})+$",
        "(ab)+",
        "(?=a)a",
        "(a)\\1",
        "(?<x>a)\\k<x>"
      ]) {
        const result = await createGrepTool({ disableRipgrep: true }).execute(
          { pattern },
          { cwd, metadata: {} }
        );

        expect(result).toMatchObject({
          output: expect.stringContaining("unsupported fallback regex pattern"),
          isError: true,
          metadata: {
            tool: "grep",
            backend: "fallback",
            timedOut: false
          }
        });
      }
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("does not fall back when type filters cannot be preserved", async () => {
    const cwd = await makeTempProject("openharness-grep-fallback-type-");
    try {
      writeFileSync(join(cwd, "a.ts"), "needle\n", "utf8");

      const disabled = await createGrepTool({ disableRipgrep: true }).execute(
        { pattern: "needle", type: "ts" },
        { cwd, metadata: {} }
      );
      const backend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: null,
          stderr: "spawn ENOENT"
        })
      );
      const spawnFallback = await createGrepTool({ backend }).execute(
        { pattern: "needle", type: "ts" },
        { cwd, metadata: {} }
      );

      expect(disabled).toMatchObject({
        output: "grep fallback does not support type filters",
        isError: true,
        metadata: {
          tool: "grep",
          backend: "fallback",
          timedOut: false
        }
      });
      expect(spawnFallback).toMatchObject({
        output: "grep fallback does not support type filters",
        isError: true,
        metadata: {
          tool: "grep",
          backend: "fallback",
          timedOut: false,
          fallbackReason: "spawn ENOENT"
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("does not fall back when ripgrep times out or is aborted", async () => {
    const cwd = await makeTempProject("openharness-grep-terminal-errors-");
    try {
      const timedOutBackend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: "SIGTERM",
          timedOut: true,
          stdout: "partial\n"
        })
      );
      const abortedBackend = createFakeRipgrepBackend(
        createFakeRipgrepResult({
          exitCode: null,
          signal: "SIGTERM",
          aborted: true
        })
      );

      const timedOut = await createGrepTool({ backend: timedOutBackend }).execute(
        { pattern: "needle", timeoutSeconds: 3 },
        { cwd, metadata: {} }
      );
      const aborted = await createGrepTool({ backend: abortedBackend }).execute(
        { pattern: "needle" },
        { cwd, metadata: {} }
      );

      expect(timedOut).toMatchObject({
        output: expect.stringContaining("[grep timed out after 3 seconds]"),
        isError: true,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          timedOut: true,
          partialOutput: "partial"
        }
      });
      expect(aborted).toMatchObject({
        output: "grep was aborted",
        isError: true,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          aborted: true,
          timedOut: false
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("handles fallback invalid regex, abort, and timeout", async () => {
    const cwd = await makeTempProject("openharness-grep-fallback-errors-");
    const glob = vi.fn(
      async () => await new Promise<string[]>(() => undefined)
    );
    vi.resetModules();
    vi.doMock("tinyglobby", () => ({ glob }));

    try {
      const { createGrepTool: createMockedGrepTool } = await import(
        "../src/tools/project/grep.js"
      );
      const invalid = await createMockedGrepTool({
        disableRipgrep: true
      }).execute({ pattern: "match(" }, { cwd, metadata: {} });
      const controller = new AbortController();
      controller.abort();
      const aborted = await createMockedGrepTool({
        disableRipgrep: true
      }).execute(
        { pattern: "match" },
        { cwd, metadata: {}, signal: controller.signal }
      );
      const timedOut = await createMockedGrepTool({
        disableRipgrep: true
      }).execute(
        { pattern: "match", timeoutSeconds: 1 },
        { cwd, metadata: {} }
      );

      expect(invalid).toMatchObject({
        output: expect.stringContaining("invalid regex pattern"),
        isError: true,
        metadata: { tool: "grep", backend: "fallback" }
      });
      expect(aborted).toMatchObject({
        output: "grep was aborted",
        isError: true,
        metadata: {
          tool: "grep",
          backend: "fallback",
          aborted: true,
          timedOut: false
        }
      });
      expect(timedOut).toMatchObject({
        output: "grep timed out after 1 seconds",
        isError: true,
        metadata: {
          tool: "grep",
          backend: "fallback",
          aborted: false,
          timedOut: true
        }
      });
      const calls = glob.mock.calls as unknown as ReadonlyArray<
        readonly [unknown, { readonly signal?: AbortSignal }]
      >;
      expect(calls[0]?.[1].signal?.aborted).toBe(true);
    } finally {
      vi.doUnmock("tinyglobby");
      vi.resetModules();
      await removeTempProject(cwd);
    }
  });

  it("honors hidden policy and excludes git internals", async () => {
    const cwd = await makeTempProject("openharness-grep-hidden-rg-");
    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, ".github", "workflows"), { recursive: true });
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".git", "config"), "needle\n", "utf8");
      writeFileSync(
        join(cwd, ".github", "workflows", "ci.yml"),
        "needle\n",
        "utf8"
      );
      writeFileSync(join(cwd, ".hidden", "file.txt"), "needle\n", "utf8");
      writeFileSync(join(cwd, "visible.txt"), "needle\n", "utf8");

      const result = await createGrepTool().execute(
        { pattern: "needle", glob: "**/*" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        isError: false,
        metadata: {
          tool: "grep",
          backend: "ripgrep",
          numFiles: 3,
          numMatches: 3
        }
      });
      expect(result.output.split("\n").sort()).toEqual([
        ".github/workflows/ci.yml:1:needle",
        ".hidden/file.txt:1:needle",
        "visible.txt:1:needle"
      ]);
      expect(result.output).not.toContain(".git/config");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("keeps hidden files out of non-git fallback searches", async () => {
    const cwd = await makeTempProject("openharness-grep-hidden-fallback-");
    try {
      mkdirSync(join(cwd, ".hidden"));
      writeFileSync(join(cwd, ".hidden", "file.txt"), "needle\n", "utf8");
      writeFileSync(join(cwd, "visible.txt"), "needle\n", "utf8");

      const result = await createGrepTool({ disableRipgrep: true }).execute(
        { pattern: "needle", glob: "**/*" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "visible.txt:1:needle",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "fallback",
          numFiles: 1,
          numMatches: 1
        }
      });
      expect(result.output).not.toContain(".hidden/file.txt");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("keeps fallback count statistics independent from pagination", async () => {
    const cwd = await makeTempProject("openharness-grep-fallback-count-");
    try {
      writeFileSync(
        join(cwd, "a.txt"),
        "needle one\nneedle two\nneedle three\n",
        "utf8"
      );
      writeFileSync(join(cwd, "b.txt"), "needle four\n", "utf8");
      writeFileSync(join(cwd, "c.txt"), "needle five\n", "utf8");

      const result = await createGrepTool({ disableRipgrep: true }).execute(
        {
          pattern: "needle",
          outputMode: "count",
          offset: 1,
          headLimit: 1
        },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "b.txt:1",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "fallback",
          outputMode: "count",
          numFiles: 3,
          numMatches: 5,
          numLines: 1,
          appliedLimit: 1,
          appliedOffset: 1,
          truncated: true
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("counts files_with_matches paths as whole file names", async () => {
    const cwd = await makeTempProject("openharness-grep-files-stats-");
    try {
      writeFileSync(join(cwd, "name-1-file.txt"), "needle\n", "utf8");

      const result = await createGrepTool({ disableRipgrep: true }).execute(
        {
          pattern: "needle",
          outputMode: "files_with_matches"
        },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "name-1-file.txt",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "fallback",
          numFiles: 1,
          numMatches: 1
        }
      });
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects root escapes, non-directory roots, and symlink root escapes", async () => {
    const cwd = await makeTempProject("openharness-grep-root-cwd-");
    const outside = await makeTempProject("openharness-grep-root-out-");
    try {
      writeFileSync(join(cwd, "file.txt"), "needle\n", "utf8");
      const linkPath = join(cwd, "outside-link");
      try {
        await symlink(outside, linkPath, "junction");
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

      const escaped = await executeGrepTool(cwd, {
        pattern: "needle",
        root: ".."
      });
      const fileRoot = await executeGrepTool(cwd, {
        pattern: "needle",
        root: "file.txt"
      });
      const symlinkRoot = await executeGrepTool(cwd, {
        pattern: "needle",
        root: "outside-link"
      });

      expect(escaped.isError).toBe(true);
      expect(escaped.output).toContain("Path escapes project cwd");
      expect(fileRoot).toMatchObject({
        output: expect.stringContaining("grep search root must be a directory"),
        isError: true,
        metadata: {
          tool: "grep",
          root: join(cwd, "file.txt")
        }
      });
      expect(symlinkRoot.isError).toBe(true);
      expect(symlinkRoot.output).toContain("Path escapes project cwd");
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("fallback does not expose files through internal symlinks when symlinks are supported", async () => {
    const cwd = await makeTempProject("openharness-grep-fallback-link-cwd-");
    const outside = await makeTempProject("openharness-grep-fallback-link-out-");
    try {
      const linkPath = join(cwd, "outside-link");
      writeFileSync(join(outside, "outside.txt"), "needle\n", "utf8");

      try {
        await symlink(outside, linkPath, "junction");
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

      const result = await createGrepTool({ disableRipgrep: true }).execute(
        { pattern: "needle", glob: "**/*" },
        { cwd, metadata: {} }
      );

      expect(result).toMatchObject({
        output: "(no matches)",
        isError: false,
        metadata: {
          tool: "grep",
          backend: "fallback",
          numFiles: 0,
          numMatches: 0
        }
      });
      expect(result.output).not.toContain("outside.txt");
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("validates input and publishes integer schema through the registry", async () => {
    const cwd = await makeTempProject("openharness-grep-validation-");
    try {
      for (const input of [
        null,
        [],
        {},
        { pattern: "" },
        { pattern: "x", outputMode: "bad" },
        { pattern: "x", context: 1.5 },
        { pattern: "x", beforeContext: -1 },
        { pattern: "x", headLimit: 0 },
        { pattern: "x", head_limit: 2001 },
        { pattern: "x", offset: -1 },
        { pattern: "x", timeoutSeconds: 0 },
        { pattern: "x", timeout_seconds: 121 },
        { pattern: "x", extra: true }
      ]) {
        const result = await executeGrepTool(cwd, input);

        expect(result.isError).toBe(true);
        expect(result.output).toContain("Invalid input for grep");
      }

      const registry = new ToolRegistry();
      registry.register(createGrepTool());

      expect(registry.toApiSchema()).toEqual([
        expect.objectContaining({
          name: "grep",
          input_schema: expect.objectContaining({
            additionalProperties: false,
            properties: expect.objectContaining({
              beforeContext: expect.objectContaining({ type: "integer" }),
              afterContext: expect.objectContaining({ type: "integer" }),
              context: expect.objectContaining({ type: "integer" }),
              headLimit: expect.objectContaining({ type: "integer" }),
              head_limit: expect.objectContaining({ type: "integer" }),
              offset: expect.objectContaining({ type: "integer" }),
              timeoutSeconds: expect.objectContaining({ type: "integer" }),
              timeout_seconds: expect.objectContaining({ type: "integer" })
            })
          })
        })
      ]);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("is read-only", () => {
    expect(createGrepTool().isReadOnly?.({ pattern: "alpha" })).toBe(true);
  });
});

describe("default project tool registry", () => {
  it("registers read_file, glob, and grep", () => {
    const registry = createDefaultProjectToolRegistry();

    expect(registry.hasTool("read_file")).toBe(true);
    expect(registry.hasTool("glob")).toBe(true);
    expect(registry.hasTool("grep")).toBe(true);
  });

  it("registers tools into an existing registry", () => {
    const registry = new ToolRegistry();

    registerDefaultProjectTools(registry);

    expect(registry.listTools().map((tool) => tool.name)).toEqual([
      "read_file",
      "glob",
      "grep"
    ]);
  });

  it("exports registry helpers from package root", () => {
    const registry = createDefaultProjectToolRegistryFromRoot();

    expect(registry.hasTool("read_file")).toBe(true);
    expect(registry.hasTool("glob")).toBe(true);
    expect(registry.hasTool("grep")).toBe(true);
  });
});
