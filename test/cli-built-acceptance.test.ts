import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
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

describe("built CLI acceptance precondition", () => {
  it("has a built CLI entrypoint", () => {
    expect(existsSync(distCliPath)).toBe(true);
  });
});
