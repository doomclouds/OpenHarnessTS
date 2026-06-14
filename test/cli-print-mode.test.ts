import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createApiMessageCompleteEvent,
  createApiTextDeltaEvent,
  createAssistantMessage,
  createTextBlock,
  createToolUseBlock,
  getMessageText
} from "../src/index.js";
import {
  runCli,
  runPrintMode
} from "../src/cli/index.js";
import type {
  ApiClient,
  ApiMessageRequest,
  ApiStreamEvent,
  ConversationMessage,
  ExportSessionTranscriptArgs,
  ListSessionsOptions,
  SaveSessionSnapshotArgs,
  SessionBackend,
  SessionSnapshot,
  SessionSummary
} from "../src/index.js";

class ScriptedApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];

  public constructor(
    private readonly turns: readonly (readonly ApiStreamEvent[])[]
  ) {}

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    this.requests.push({
      ...request,
      messages: [...request.messages],
      ...(request.tools === undefined ? {} : { tools: [...request.tools] })
    });

    const turn = this.turns[this.requests.length - 1];
    if (turn === undefined) {
      throw new Error(`No scripted turn ${this.requests.length}.`);
    }

    for (const event of turn) {
      yield event;
    }
  }
}

class ThrowingApiClient implements ApiClient {
  public async *streamMessage(): AsyncIterable<ApiStreamEvent> {
    throw new Error("network down");
  }
}

class FailingSessionBackend implements SessionBackend {
  public async saveSnapshot(
    _args: SaveSessionSnapshotArgs
  ): Promise<SessionSnapshot> {
    throw new Error("disk full");
  }

  public async loadLatest(): Promise<SessionSnapshot | undefined> {
    return undefined;
  }

  public async loadById(): Promise<SessionSnapshot | undefined> {
    return undefined;
  }

  public async listRecent(
    _cwd: string | URL,
    _options?: ListSessionsOptions
  ): Promise<readonly SessionSummary[]> {
    return [];
  }

  public async exportTranscript(
    _args: ExportSessionTranscriptArgs
  ): Promise<string> {
    throw new Error("transcript unavailable");
  }
}

class FailingTranscriptSessionBackend implements SessionBackend {
  public readonly savedSnapshots: SaveSessionSnapshotArgs[] = [];

  public async saveSnapshot(
    args: SaveSessionSnapshotArgs
  ): Promise<SessionSnapshot> {
    this.savedSnapshots.push(args);
    return {
      sessionId: args.sessionId ?? "transcript_failure",
      cwd: resolve(String(args.cwd)),
      model: args.model,
      systemPrompt: args.systemPrompt,
      messages: args.messages,
      ...(args.usage === undefined ? {} : { usage: args.usage }),
      toolMetadata: args.toolMetadata ?? {},
      createdAt: args.createdAt ?? "2026-06-14T00:00:00.000Z",
      updatedAt: args.updatedAt ?? "2026-06-14T00:00:00.000Z",
      summary: "Save.",
      messageCount: args.messages.length,
      path: join(resolve(String(args.cwd)), "session-transcript_failure.jsonl")
    };
  }

  public async loadLatest(): Promise<SessionSnapshot | undefined> {
    return undefined;
  }

  public async loadById(): Promise<SessionSnapshot | undefined> {
    return undefined;
  }

  public async listRecent(
    _cwd: string | URL,
    _options?: ListSessionsOptions
  ): Promise<readonly SessionSummary[]> {
    return [];
  }

  public async exportTranscript(
    _args: ExportSessionTranscriptArgs
  ): Promise<string> {
    throw new Error("transcript disk full");
  }
}

interface CapturedIo {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly io: {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
  };
}

function createCapturedIo(): CapturedIo {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      stdout(text) {
        stdout.push(text);
      },
      stderr(text) {
        stderr.push(text);
      }
    }
  };
}

async function makeTempProject(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

interface IsolatedRuntimePaths {
  readonly homeDir: string;
  readonly configDir: string;
  readonly env: {
    readonly OPENHARNESS_CONFIG_DIR: string;
  };
}

function createIsolatedRuntimePaths(root: string): IsolatedRuntimePaths {
  const homeDir = join(root, "home");
  const configDir = join(root, "config");

  return {
    homeDir,
    configDir,
    env: { OPENHARNESS_CONFIG_DIR: configDir }
  };
}

async function removeTempProject(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

async function expectFile(path: string): Promise<void> {
  const info = await stat(path);
  expect(info.isFile()).toBe(true);
}

function messageComplete(text: string): ApiStreamEvent {
  return createApiMessageCompleteEvent({
    message: createAssistantMessage([createTextBlock(text)])
  });
}

function assistantToolUse(args: {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}): ApiStreamEvent {
  return createApiMessageCompleteEvent({
    message: createAssistantMessage([
      createToolUseBlock({
        id: args.id,
        name: args.name,
        input: args.input
      })
    ])
  });
}

describe("runPrintMode", () => {
  it("rejects an empty prompt before calling the provider", async () => {
    const client = new ScriptedApiClient([[messageComplete("unused")]]);

    await expect(
      runPrintMode({
        prompt: "   ",
        apiClient: client,
        model: "mock-model"
      })
    ).rejects.toMatchObject({
      message: "print prompt is required."
    });
    expect(client.requests).toEqual([]);
  });

  it("returns assistant text from text deltas and saves a snapshot", async () => {
    const root = await makeTempProject("openharness-print-text-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const client = new ScriptedApiClient([
      [
        createApiTextDeltaEvent("Hello"),
        createApiTextDeltaEvent(", project."),
        messageComplete("Hello, project.")
      ]
    ]);

    try {
      await mkdir(runtimePaths.homeDir, { recursive: true });
      const result = await runPrintMode({
        prompt: "Say hello.",
        cwd: root,
        homeDir: runtimePaths.homeDir,
        env: runtimePaths.env,
        apiClient: client,
        model: "mock-model",
        sessionId: "print_text",
        now: () => new Date("2026-06-14T00:00:00.000Z")
      });

      expect(result).toMatchObject({
        assistantText: "Hello, project.",
        sessionId: "print_text",
        cwd: resolve(root),
        model: "mock-model"
      });
      expect(result.snapshotPath).toContain("session-print_text.jsonl");
      expect(result.transcriptPath).toBe(result.session.transcriptPath);
      expect(result.session).toMatchObject({
        sessionId: "print_text",
        sessionDir: dirname(result.snapshotPath),
        latestPath: join(dirname(result.snapshotPath), "latest.json"),
        snapshotPath: result.snapshotPath,
        transcriptPath: join(
          dirname(result.snapshotPath),
          "transcript-print_text.md"
        ),
        messageCount: 2,
        summary: "Say hello."
      });
      expect(basename(result.session.transcriptPath)).toBe(
        "transcript-print_text.md"
      );
      await expectFile(result.session.snapshotPath);
      await expectFile(result.session.latestPath);
      await expectFile(result.session.transcriptPath);
      expect(result.events.map((event) => event.type)).toEqual([
        "assistant_text_delta",
        "assistant_text_delta",
        "assistant_turn_complete"
      ]);

      const latest = await result.sessionBackend.loadLatest(result.cwd);
      expect(latest?.sessionId).toBe("print_text");
      expect(latest?.summary).toBe("Say hello.");
      expect(getMessageText(latest?.messages.at(-1) as ConversationMessage)).toBe(
        "Hello, project."
      );
      expect(latest?.messageCount).toBe(result.session.messageCount);
      const transcript = await readFile(result.session.transcriptPath, "utf8");
      expect(transcript).toContain("# OpenHarness Session Transcript");
      expect(transcript).toContain("## User");
      expect(transcript).toContain("Say hello.");
      expect(transcript).toContain("## Assistant");
      expect(transcript).toContain("Hello, project.");
      expect(client.requests).toHaveLength(1);
    } finally {
      await removeTempProject(root);
    }
  });

  it("falls back to the final assistant message when no text deltas were emitted", async () => {
    const root = await makeTempProject("openharness-print-final-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const client = new ScriptedApiClient([[messageComplete("Final only text.")]]);

    try {
      const result = await runPrintMode({
        prompt: "Return final text.",
        cwd: root,
        homeDir: runtimePaths.homeDir,
        env: runtimePaths.env,
        apiClient: client,
        model: "mock-model",
        sessionId: "print_final"
      });

      expect(result.assistantText).toBe("Final only text.");
      expect(result.events.map((event) => event.type)).toEqual([
        "assistant_turn_complete"
      ]);
    } finally {
      await removeTempProject(root);
    }
  });

  it("runs a fake-provider tool-use project turn with default read-only tools", async () => {
    const root = await makeTempProject("openharness-print-tools-");
    const cwd = join(root, "fixture-project");
    const runtimePaths = createIsolatedRuntimePaths(root);

    try {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(
        join(cwd, "AGENTS.md"),
        "# Fixture Agent Instructions\n\nAlways mention PRINT_TARGET.\n",
        "utf8"
      );
      await writeFile(
        join(cwd, "src", "target.ts"),
        "export const PRINT_TARGET = \"cli print mode\";\n",
        "utf8"
      );

      const client = new ScriptedApiClient([
        [
          assistantToolUse({
            id: "toolu_grep",
            name: "grep",
            input: {
              pattern: "PRINT_TARGET",
              glob: "src/**/*.ts",
              headLimit: 10
            }
          })
        ],
        [messageComplete("PRINT_TARGET is defined in src/target.ts.")]
      ]);

      const result = await runPrintMode({
        prompt: "Find PRINT_TARGET.",
        cwd,
        homeDir: runtimePaths.homeDir,
        env: runtimePaths.env,
        apiClient: client,
        model: "mock-model",
        sessionId: "print_tools"
      });

      expect(result.assistantText).toBe(
        "PRINT_TARGET is defined in src/target.ts."
      );
      expect(client.requests).toHaveLength(2);
      expect(client.requests[0]?.systemPrompt).toContain("PRINT_TARGET");
      expect(new Set(client.requests[0]?.tools?.map((tool) => tool.name))).toEqual(
        new Set(["read_file", "glob", "grep"])
      );
      const secondRequestMessages = JSON.stringify(
        client.requests[1]?.messages ?? []
      );
      expect(secondRequestMessages).toContain("src/target.ts");
      expect(secondRequestMessages).toContain("PRINT_TARGET");
      expect(result.events.map((event) => event.type)).toEqual([
        "assistant_turn_complete",
        "tool_execution_started",
        "tool_execution_completed",
        "assistant_turn_complete"
      ]);
      const snapshotText = await readFile(result.snapshotPath, "utf8");
      expect(snapshotText).toContain("PRINT_TARGET");
      const transcript = await readFile(result.session.transcriptPath, "utf8");
      expect(transcript).toContain("```tool");
      expect(transcript).toContain("grep {\"pattern\":\"PRINT_TARGET\"");
      expect(transcript).toContain("```tool-result");
      expect(transcript).toContain("src/target.ts");
    } finally {
      await removeTempProject(root);
    }
  });

  it("forwards runtime limits and permission mode into project execution", async () => {
    const root = await makeTempProject("openharness-print-runtime-flags-");
    const cwd = join(root, "fixture-project");
    const runtimePaths = createIsolatedRuntimePaths(root);

    try {
      await mkdir(join(cwd, "src"), { recursive: true });
      await writeFile(
        join(cwd, "src", "target.ts"),
        "export const PRINT_TARGET = \"cli print mode\";\n",
        "utf8"
      );

      const client = new ScriptedApiClient([
        [
          assistantToolUse({
            id: "toolu_grep",
            name: "grep",
            input: {
              pattern: "PRINT_TARGET",
              glob: "src/**/*.ts",
              headLimit: 10
            }
          })
        ]
      ]);

      await expect(
        runPrintMode({
          prompt: "Find PRINT_TARGET.",
          cwd,
          homeDir: runtimePaths.homeDir,
          env: runtimePaths.env,
          apiClient: client,
          model: "mock-model",
          sessionId: "print_runtime_flags",
          maxTurns: 1,
          permissionMode: "plan"
        })
      ).rejects.toMatchObject({
        message: "Max turns exceeded: 1"
      });

      expect(client.requests).toHaveLength(1);
      expect(client.requests[0]?.systemPrompt).toContain("- Current mode: plan");
    } finally {
      await removeTempProject(root);
    }
  });

  it("fails when the provider throws", async () => {
    const root = await makeTempProject("openharness-print-provider-error-");

    try {
      await expect(
        runPrintMode({
          prompt: "Fail.",
          cwd: root,
          apiClient: new ThrowingApiClient(),
          model: "mock-model",
          sessionId: "print_provider_error"
        })
      ).rejects.toMatchObject({
        message: "API error: network down"
      });
    } finally {
      await removeTempProject(root);
    }
  });

  it("fails when the session snapshot cannot be saved", async () => {
    const root = await makeTempProject("openharness-print-save-error-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const client = new ScriptedApiClient([[messageComplete("Saved text.")]]);

    try {
      await expect(
        runPrintMode({
          prompt: "Save.",
          cwd: root,
          homeDir: runtimePaths.homeDir,
          env: runtimePaths.env,
          apiClient: client,
          model: "mock-model",
          sessionId: "print_save_error",
          sessionBackend: new FailingSessionBackend()
        })
      ).rejects.toMatchObject({
        message: "Session snapshot save failed: disk full"
      });
    } finally {
      await removeTempProject(root);
    }
  });

  it("fails when the session transcript cannot be exported", async () => {
    const root = await makeTempProject("openharness-print-transcript-error-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const client = new ScriptedApiClient([[messageComplete("Saved text.")]]);
    const sessionBackend = new FailingTranscriptSessionBackend();

    try {
      await expect(
        runPrintMode({
          prompt: "Save.",
          cwd: root,
          homeDir: runtimePaths.homeDir,
          env: runtimePaths.env,
          apiClient: client,
          model: "mock-model",
          sessionId: "transcript_failure",
          sessionBackend
        })
      ).rejects.toMatchObject({
        message: "Session transcript export failed: transcript disk full"
      });
      expect(sessionBackend.savedSnapshots).toHaveLength(1);
    } finally {
      await removeTempProject(root);
    }
  });
});

describe("CLI print-mode integration", () => {
  it("writes injected print-mode assistant text to stdout", async () => {
    const root = await makeTempProject("openharness-cli-print-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const captured = createCapturedIo();
    const client = new ScriptedApiClient([[messageComplete("CLI text.")]]);

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello."],
        captured.io,
        {
          version: "1.2.3",
          printMode: {
            apiClient: client,
            model: "mock-model",
            sessionId: "cli_print",
            homeDir: runtimePaths.homeDir,
            env: runtimePaths.env
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stdout).toEqual(["CLI text.\n"]);
      expect(captured.stderr).toEqual([]);
    } finally {
      await removeTempProject(root);
    }
  });

  it("writes json output to stdout", async () => {
    const root = await makeTempProject("openharness-cli-json-output-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const captured = createCapturedIo();
    const client = new ScriptedApiClient([[messageComplete("JSON text.")]]);

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello.", "--output-format", "json"],
        captured.io,
        {
          version: "1.2.3",
          printMode: {
            apiClient: client,
            model: "mock-model",
            sessionId: "cli_json_output",
            homeDir: runtimePaths.homeDir,
            env: runtimePaths.env
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      const parsed = JSON.parse(captured.stdout.join("")) as {
        readonly type: string;
        readonly outputFormat: string;
        readonly assistantText: string;
        readonly sessionId: string;
        readonly snapshotPath: string;
      };
      expect(parsed).toMatchObject({
        type: "final_result",
        outputFormat: "json",
        assistantText: "JSON text.",
        sessionId: "cli_json_output"
      });
      expect(parsed.snapshotPath).toContain("session-cli_json_output.jsonl");
    } finally {
      await removeTempProject(root);
    }
  });

  it("writes stream-json output to stdout", async () => {
    const root = await makeTempProject("openharness-cli-stream-json-output-");
    const runtimePaths = createIsolatedRuntimePaths(root);
    const captured = createCapturedIo();
    const client = new ScriptedApiClient([
      [
        createApiTextDeltaEvent("Stream"),
        createApiTextDeltaEvent(" text."),
        messageComplete("Stream text.")
      ]
    ]);

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello.", "--output-format", "stream-json"],
        captured.io,
        {
          version: "1.2.3",
          printMode: {
            apiClient: client,
            model: "mock-model",
            sessionId: "cli_stream_json_output",
            homeDir: runtimePaths.homeDir,
            env: runtimePaths.env
          }
        }
      );

      expect(exitCode).toBe(0);
      expect(captured.stderr).toEqual([]);
      const lines = captured.stdout
        .join("")
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as { readonly type: string });
      expect(lines.map((line) => line.type)).toEqual([
        "assistant_text_delta",
        "assistant_text_delta",
        "final_result"
      ]);
    } finally {
      await removeTempProject(root);
    }
  });

  it("returns a missing API key error without injected print-mode provider", async () => {
    const root = await makeTempProject("openharness-cli-print-missing-provider-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello."],
        captured.io,
        { version: "1.2.3", env: {} }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(captured.stderr).toEqual([
        "DEEPSEEK_API_KEY is required. Set it in the environment or pass --api-key.\n"
      ]);
    } finally {
      await removeTempProject(root);
    }
  });

  it("writes json errors to stderr for json output", async () => {
    const root = await makeTempProject("openharness-cli-json-error-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello.", "--output-format", "json"],
        captured.io,
        {
          version: "1.2.3",
          printMode: {
            apiClient: new ThrowingApiClient(),
            model: "mock-model",
            sessionId: "cli_json_error"
          }
        }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(JSON.parse(captured.stderr.join(""))).toEqual({
        type: "error",
        outputFormat: "json",
        message: "API error: network down"
      });
    } finally {
      await removeTempProject(root);
    }
  });

  it("writes stream-json errors to stderr for stream-json output", async () => {
    const root = await makeTempProject("openharness-cli-stream-json-error-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello.", "--output-format", "stream-json"],
        captured.io,
        {
          version: "1.2.3",
          printMode: {
            apiClient: new ThrowingApiClient(),
            model: "mock-model",
            sessionId: "cli_stream_json_error"
          }
        }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(JSON.parse(captured.stderr.join(""))).toEqual({
        type: "error",
        outputFormat: "stream-json",
        message: "API error: network down"
      });
    } finally {
      await removeTempProject(root);
    }
  });

  it("writes print-mode failures to stderr only", async () => {
    const root = await makeTempProject("openharness-cli-print-failure-");
    const captured = createCapturedIo();

    try {
      const exitCode = await runCli(
        ["--cwd", root, "--print", "Hello."],
        captured.io,
        {
          version: "1.2.3",
          printMode: {
            apiClient: new ThrowingApiClient(),
            model: "mock-model",
            sessionId: "cli_print_failure"
          }
        }
      );

      expect(exitCode).toBe(1);
      expect(captured.stdout).toEqual([]);
      expect(captured.stderr).toEqual(["API error: network down\n"]);
    } finally {
      await removeTempProject(root);
    }
  });
});
