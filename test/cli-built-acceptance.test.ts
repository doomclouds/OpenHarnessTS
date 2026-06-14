import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

async function createFixtureProject(root: string): Promise<string> {
  const cwd = join(root, "fixture-project");
  await mkdir(join(cwd, "src"), { recursive: true });
  await writeFile(
    join(cwd, "AGENTS.md"),
    [
      "# Fixture Agent Instructions",
      "",
      "Always mention CLI_ACCEPTANCE_TARGET when summarizing this project.",
      ""
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    join(cwd, "README.md"),
    "# CLI Acceptance Fixture\n\nThis project exists for built CLI acceptance.\n",
    "utf8"
  );
  await writeFile(
    join(cwd, "src", "alpha.ts"),
    [
      'export const CLI_ACCEPTANCE_TARGET = "built cli acceptance";',
      "export function describeAcceptance(): string {",
      "  return CLI_ACCEPTANCE_TARGET;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  return cwd;
}

interface BuiltPrintEnvelope {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly requests: readonly unknown[];
  readonly toolNames: readonly string[];
  readonly toolResultsSeen: readonly {
    readonly toolUseId: string;
    readonly content: string;
    readonly isError?: boolean;
  }[];
}

function getBuiltCliModuleUrl(): string {
  return pathToFileURL(distCliPath).href;
}

async function writeBuiltPrintRunner(args: {
  readonly root: string;
  readonly cwd: string;
  readonly outputFormat: "text" | "json" | "stream-json";
}): Promise<string> {
  const runnerPath = join(args.root, `built-print-${args.outputFormat}.mjs`);
  const runnerSource = `
import { runCli } from ${JSON.stringify(getBuiltCliModuleUrl())};
import {
  createApiMessageCompleteEvent,
  createAssistantMessage,
  createTextBlock,
  createToolUseBlock
} from ${JSON.stringify(pathToFileURL(join(repoRoot, "dist", "index.js")).href)};

function messageComplete(text) {
  return createApiMessageCompleteEvent({
    message: createAssistantMessage([createTextBlock(text)])
  });
}

function assistantToolUse(id, name, input) {
  return createApiMessageCompleteEvent({
    message: createAssistantMessage([
      createToolUseBlock({
        id,
        name,
        input
      })
    ])
  });
}

const requests = [];
const toolNames = [];
const toolResultsSeen = [];
const turns = [
  [
    assistantToolUse("toolu_glob", "glob", {
      pattern: "src/**/*.ts",
      limit: 10
    })
  ],
  [
    assistantToolUse("toolu_grep", "grep", {
      pattern: "CLI_ACCEPTANCE_TARGET",
      glob: "src/**/*.ts",
      headLimit: 10
    })
  ],
  [
    assistantToolUse("toolu_read", "read_file", {
      path: "src/alpha.ts",
      limit: 20
    })
  ],
  [messageComplete("CLI_ACCEPTANCE_TARGET is defined in src/alpha.ts.")]
];

const apiClient = {
  async *streamMessage(request) {
    for (const message of request.messages) {
      const content = message.content;
      if (!Array.isArray(content)) {
        continue;
      }
      for (const block of content) {
        if (block.type !== "tool_result") {
          continue;
        }
        toolResultsSeen.push({
          toolUseId: block.toolUseId,
          content:
            typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content),
          ...(block.isError === undefined ? {} : { isError: block.isError })
        });
      }
    }
    requests.push({
      ...request,
      messages: [...request.messages],
      ...(request.tools === undefined ? {} : { tools: [...request.tools] })
    });
    const turn = turns[requests.length - 1];
    if (turn === undefined) {
      throw new Error(\`No scripted turn \${requests.length}.\`);
    }
    for (const event of turn) {
      const content = event.message?.content;
      const toolUse = Array.isArray(content)
        ? content.find((block) => block.type === "tool_use")
        : undefined;
      if (toolUse?.name !== undefined) {
        toolNames.push(toolUse.name);
      }
      yield event;
    }
  }
};

const stdout = [];
const stderr = [];
const capturedIo = {
  stdout(text) {
    stdout.push(text);
  },
  stderr(text) {
    stderr.push(text);
  }
};
const env = process.env;
const exitCode = await runCli(
  [
    "--cwd",
    ${JSON.stringify(args.cwd)},
    "--print",
    "Inspect the fixture project and identify CLI_ACCEPTANCE_TARGET.",
    "--output-format",
    ${JSON.stringify(args.outputFormat)}
  ],
  capturedIo,
  {
    env,
    printMode: {
      apiClient,
      model: "mock-model",
      env
    }
  }
);

process.stdout.write(
  JSON.stringify({
    exitCode,
    stdout: stdout.join(""),
    stderr: stderr.join(""),
    requests,
    toolNames,
    toolResultsSeen
  })
);
`;
  await writeFile(runnerPath, runnerSource, "utf8");

  return runnerPath;
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

describe("built CLI fixture print acceptance", () => {
  it("renders built JSON print output with fixture session artifacts", async () => {
    const root = createTempRoot("openharness-built-print-json-");

    try {
      const cwd = await createFixtureProject(root);
      const runnerPath = await writeBuiltPrintRunner({
        root,
        cwd,
        outputFormat: "json"
      });
      const runner = await runProcess([runnerPath], {
        env: createIsolatedEnv(root),
        timeoutMs: 15_000
      });

      expectCleanSuccess(runner);
      const envelope = JSON.parse(runner.stdout) as BuiltPrintEnvelope;
      expect(envelope.exitCode).toBe(0);
      expect(envelope.stderr).toBe("");
      expect(envelope.requests).toHaveLength(4);
      expect(envelope.toolNames).toEqual(["glob", "grep", "read_file"]);
      expect(envelope.toolResultsSeen.length).toBeGreaterThanOrEqual(3);
      const globResult = envelope.toolResultsSeen.find(
        (result) => result.toolUseId === "toolu_glob"
      );
      const grepResult = envelope.toolResultsSeen.find(
        (result) => result.toolUseId === "toolu_grep"
      );
      const readFileResult = envelope.toolResultsSeen.find(
        (result) => result.toolUseId === "toolu_read"
      );
      expect(globResult).toBeDefined();
      expect(globResult?.isError).not.toBe(true);
      expect(globResult?.content).toContain("src/alpha.ts");
      expect(grepResult).toBeDefined();
      expect(grepResult?.isError).not.toBe(true);
      expect(grepResult?.content).toContain("CLI_ACCEPTANCE_TARGET");
      expect(readFileResult).toBeDefined();
      expect(readFileResult?.isError).not.toBe(true);
      expect(readFileResult?.content).toContain("built cli acceptance");

      const output = JSON.parse(envelope.stdout) as {
        readonly type: string;
        readonly outputFormat: string;
        readonly assistantText: string;
        readonly cwd: string;
        readonly model: string;
        readonly snapshotPath: string;
        readonly session: {
          readonly sessionId: string;
          readonly sessionDir: string;
          readonly latestPath: string;
          readonly snapshotPath: string;
          readonly transcriptPath: string;
          readonly messageCount: number;
          readonly summary: string;
          readonly messages?: unknown;
          readonly transcript?: unknown;
          readonly sessionBackend?: unknown;
        };
        readonly messages?: unknown;
        readonly transcript?: unknown;
        readonly sessionBackend?: unknown;
      };
      expect(output).toMatchObject({
        type: "final_result",
        outputFormat: "json",
        assistantText: "CLI_ACCEPTANCE_TARGET is defined in src/alpha.ts.",
        cwd: resolve(cwd),
        model: "mock-model"
      });
      expect(output.snapshotPath).toBe(output.session.snapshotPath);
      expect(output.session.sessionId.length).toBeGreaterThan(0);
      expect(output.session.sessionDir).toBe(dirname(output.session.latestPath));
      expect(output.session.sessionDir).toBe(dirname(output.session.snapshotPath));
      expect(output.session.sessionDir).toBe(
        dirname(output.session.transcriptPath)
      );
      expect(output.session.messageCount).toBeGreaterThanOrEqual(5);
      expect(output.session.summary).toContain("Inspect the fixture project");
      expect(output.messages).toBeUndefined();
      expect(output.transcript).toBeUndefined();
      expect(output.sessionBackend).toBeUndefined();
      expect(output.session.messages).toBeUndefined();
      expect(output.session.transcript).toBeUndefined();
      expect(output.session.sessionBackend).toBeUndefined();

      expect((await stat(output.session.snapshotPath)).isFile()).toBe(true);
      expect((await stat(output.session.latestPath)).isFile()).toBe(true);
      expect((await stat(output.session.transcriptPath)).isFile()).toBe(true);

      const latest = JSON.parse(
        await readFile(output.session.latestPath, "utf8")
      ) as {
        readonly sessionId: string;
        readonly path: string;
        readonly messageCount: number;
        readonly summary: string;
      };
      expect(latest).toMatchObject({
        sessionId: output.session.sessionId,
        path: basename(output.session.snapshotPath),
        messageCount: output.session.messageCount,
        summary: output.session.summary
      });

      const snapshot = await readFile(output.session.snapshotPath, "utf8");
      expect(snapshot).toContain(output.session.sessionId);
      expect(snapshot).toContain("CLI_ACCEPTANCE_TARGET");

      const transcript = await readFile(output.session.transcriptPath, "utf8");
      expect(transcript).toContain(
        "Inspect the fixture project and identify CLI_ACCEPTANCE_TARGET."
      );
      expect(transcript).toContain(
        "CLI_ACCEPTANCE_TARGET is defined in src/alpha.ts."
      );
    } finally {
      removeTempRoot(root);
    }
  });

  it("keeps built text print output to assistant text only", async () => {
    const root = createTempRoot("openharness-built-print-text-");

    try {
      const cwd = await createFixtureProject(root);
      const runnerPath = await writeBuiltPrintRunner({
        root,
        cwd,
        outputFormat: "text"
      });
      const runner = await runProcess([runnerPath], {
        env: createIsolatedEnv(root),
        timeoutMs: 15_000
      });

      expectCleanSuccess(runner);
      const envelope = JSON.parse(runner.stdout) as BuiltPrintEnvelope;
      expect(envelope.exitCode).toBe(0);
      expect(envelope.stderr).toBe("");
      expect(envelope.stdout).toBe(
        "CLI_ACCEPTANCE_TARGET is defined in src/alpha.ts.\n"
      );
      expect(envelope.stdout).not.toContain("session-");
      expect(envelope.stdout).not.toContain("latest.json");
      expect(envelope.stdout).not.toContain("transcript-");
    } finally {
      removeTempRoot(root);
    }
  });

  it("renders built stream-json final result with session metadata", async () => {
    const root = createTempRoot("openharness-built-print-stream-");

    try {
      const cwd = await createFixtureProject(root);
      const runnerPath = await writeBuiltPrintRunner({
        root,
        cwd,
        outputFormat: "stream-json"
      });
      const runner = await runProcess([runnerPath], {
        env: createIsolatedEnv(root),
        timeoutMs: 15_000
      });

      expectCleanSuccess(runner);
      const envelope = JSON.parse(runner.stdout) as BuiltPrintEnvelope;
      expect(envelope.exitCode).toBe(0);
      expect(envelope.stderr).toBe("");

      const lines = envelope.stdout.trimEnd().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const finalResult = JSON.parse(lines.at(-1) ?? "{}") as {
        readonly type: string;
        readonly outputFormat: string;
        readonly assistantText: string;
        readonly session: {
          readonly sessionId: string;
          readonly snapshotPath: string;
          readonly latestPath: string;
          readonly transcriptPath: string;
        };
        readonly messages?: unknown;
        readonly transcript?: unknown;
      };

      expect(finalResult).toMatchObject({
        type: "final_result",
        outputFormat: "stream-json",
        assistantText: "CLI_ACCEPTANCE_TARGET is defined in src/alpha.ts."
      });
      expect(finalResult.messages).toBeUndefined();
      expect(finalResult.transcript).toBeUndefined();
      expect((await stat(finalResult.session.snapshotPath)).isFile()).toBe(true);
      expect((await stat(finalResult.session.latestPath)).isFile()).toBe(true);
      expect((await stat(finalResult.session.transcriptPath)).isFile()).toBe(
        true
      );
      expect(finalResult.session.snapshotPath).toContain(
        `${sep}sessions${sep}`
      );
    } finally {
      removeTempRoot(root);
    }
  });
});
