import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

function createIsolatedEnv(
  root: string,
  overrides: NodeJS.ProcessEnv = {}
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENHARNESS_CONFIG_DIR: join(root, "config"),
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
