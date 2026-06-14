import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface CliProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distCliPath = join(repoRoot, "dist", "cli", "main.js");

function createTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempRoot(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function createIsolatedProjectRoot(root: string, name: string): string {
  const cwd = join(root, name);
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

function createIsolatedEnv(
  root: string,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENHARNESS_CONFIG_DIR: join(root, "config"),
    OPENHARNESS_DATA_DIR: join(root, "data"),
    OPENHARNESS_LOGS_DIR: join(root, "logs"),
    ...overrides
  };

  if (!Object.hasOwn(overrides, "DEEPSEEK_API_KEY")) {
    delete env.DEEPSEEK_API_KEY;
  }
  if (!Object.hasOwn(overrides, "DEEPSEEK_BASE_URL")) {
    delete env.DEEPSEEK_BASE_URL;
  }
  if (!Object.hasOwn(overrides, "DEEPSEEK_MODEL")) {
    delete env.DEEPSEEK_MODEL;
  }

  return env;
}

async function runProcess(
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  } = {}
): Promise<CliProcessResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(`Process timed out: ${process.execPath} ${args.join(" ")}`)
      );
    }, options.timeoutMs ?? 10_000);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        resolveResult({
          exitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8")
        });
      }
    });
  });
}

async function runBuiltCli(
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  } = {}
): Promise<CliProcessResult> {
  return await runProcess([distCliPath, ...args], options);
}

function expectCleanSuccess(result: CliProcessResult): void {
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
}

function expectStderrOnlyFailure(result: CliProcessResult): void {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.length).toBeGreaterThan(0);
}

describe("built CLI acceptance precondition", () => {
  it("has a built CLI entrypoint", () => {
    expect(existsSync(distCliPath)).toBe(true);
  });
});

describe("built CLI executable smoke", () => {
  it("prints help from the built entrypoint", async () => {
    const root = createTempRoot("openharness-built-help-");

    try {
      const result = await runBuiltCli(["--help"], {
        env: createIsolatedEnv(root)
      });

      expectCleanSuccess(result);
      expect(result.stdout).toContain("OpenHarness");
      expect(result.stdout).toContain("openharness --print <prompt>");
      expect(result.stdout).toContain("--dry-run");
      expect(result.stdout).toContain("--output-format");
    } finally {
      removeTempRoot(root);
    }
  });

  it("prints version from the built entrypoint", async () => {
    const root = createTempRoot("openharness-built-version-");

    try {
      const result = await runBuiltCli(["--version"], {
        env: createIsolatedEnv(root)
      });

      expectCleanSuccess(result);
      expect(result.stdout).toMatch(/^OpenHarness \d+\.\d+\.\d+\n$/u);
    } finally {
      removeTempRoot(root);
    }
  });

  it("keeps parser failures on stderr", async () => {
    const root = createTempRoot("openharness-built-errors-");
    const missingCwd = join(root, "missing");

    try {
      const cases: readonly {
        readonly name: string;
        readonly args: readonly string[];
        readonly stderr: string;
      }[] = [
        {
          name: "bare invocation",
          args: [],
          stderr: "No command mode selected"
        },
        {
          name: "unknown option",
          args: ["--unknown-option"],
          stderr: "Unknown option: --unknown-option"
        },
        {
          name: "invalid cwd",
          args: ["--cwd", missingCwd, "--print", "hello"],
          stderr: `Invalid cwd: ${missingCwd}. It must be an existing directory.`
        },
        {
          name: "invalid output format",
          args: ["--print", "hello", "--output-format", "xml"],
          stderr: "--output-format must be one of: text, json, stream-json."
        }
      ];

      for (const testCase of cases) {
        const result = await runBuiltCli(testCase.args, {
          env: createIsolatedEnv(root)
        });

        expectStderrOnlyFailure(result);
        expect(result.stderr).toContain(testCase.stderr);
      }
    } finally {
      removeTempRoot(root);
    }
  });
});

describe("built CLI dry-run acceptance", () => {
  it("prints bare dry-run text without creating a config directory", async () => {
    const root = createTempRoot("openharness-built-dry-run-text-");
    const cwd = createIsolatedProjectRoot(root, "project");

    try {
      const result = await runBuiltCli(["--cwd", cwd, "--dry-run"], {
        env: createIsolatedEnv(root)
      });

      expectCleanSuccess(result);
      expect(result.stdout).toContain("OpenHarness Dry Run");
      expect(result.stdout).toContain("interactive_session");
      expect(result.stdout).toContain("Available Tools");
      expect(result.stdout).toContain("read_file");
      expect(existsSync(join(root, "config"))).toBe(false);
      expect(existsSync(join(root, "data"))).toBe(false);
      expect(existsSync(join(root, "logs"))).toBe(false);
      expect(existsSync(join(cwd, ".openharness"))).toBe(false);
    } finally {
      removeTempRoot(root);
    }
  });

  it("prints dry-run JSON for a model prompt without leaking the flag API key", async () => {
    const root = createTempRoot("openharness-built-dry-run-json-");
    const cwd = createIsolatedProjectRoot(root, "project");

    try {
      const result = await runBuiltCli(
        [
          "--dry-run",
          "--print",
          "hello",
          "--api-key",
          "flag-key",
          "--output-format",
          "json"
        ],
        {
          cwd,
          env: createIsolatedEnv(root)
        }
      );

      expectCleanSuccess(result);
      const payload = JSON.parse(result.stdout) as {
        readonly cwd?: string;
        readonly paths?: {
          readonly sessionDir?: string;
        };
      };
      expect(payload).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run",
        entrypoint: { kind: "model_prompt" },
        readiness: { level: "ready" }
      });
      expect(payload.cwd).toBe(resolve(cwd));
      expect(payload.paths?.sessionDir).toContain(root);
      expect(payload.paths?.sessionDir).toContain("data");
      expect(result.stdout).not.toContain("flag-key");
    } finally {
      removeTempRoot(root);
    }
  });

  it("prints dry-run stream-json as exactly one JSON line", async () => {
    const root = createTempRoot("openharness-built-dry-run-stream-json-");
    const cwd = createIsolatedProjectRoot(root, "project");

    try {
      const result = await runBuiltCli(
        ["--dry-run", "--output-format", "stream-json"],
        {
          cwd,
          env: createIsolatedEnv(root)
        }
      );

      expectCleanSuccess(result);
      const lines = result.stdout.trimEnd().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
        type: "dry_run_preview",
        mode: "dry-run"
      });
    } finally {
      removeTempRoot(root);
    }
  });

  it("prints missing provider key JSON failure without session artifact paths", async () => {
    const root = createTempRoot("openharness-built-missing-key-json-");
    const cwd = createIsolatedProjectRoot(root, "project");

    try {
      const result = await runBuiltCli(
        ["--print", "hello", "--output-format", "json"],
        {
          cwd,
          env: createIsolatedEnv(root)
        }
      );

      expectStderrOnlyFailure(result);
      const error = JSON.parse(result.stderr) as Record<string, unknown>;
      expect(Object.keys(error).sort()).toEqual([
        "message",
        "outputFormat",
        "type"
      ]);
      expect(error).toMatchObject({
        type: "error",
        outputFormat: "json"
      });
      expect(typeof error.message).toBe("string");
      expect(error.message).toContain("DEEPSEEK_API_KEY");
      expect(error).not.toHaveProperty("snapshotPath");
      expect(error).not.toHaveProperty("transcriptPath");
      expect(error).not.toHaveProperty("latestPath");
      expect(error).not.toHaveProperty("sessionDir");
      expect(result.stderr).not.toContain("snapshotPath");
      expect(result.stderr).not.toContain("transcriptPath");
      expect(result.stderr).not.toContain("latestPath");
      expect(result.stderr).not.toContain("sessionDir");
    } finally {
      removeTempRoot(root);
    }
  });
});
