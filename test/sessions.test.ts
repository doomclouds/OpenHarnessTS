import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createApiMessageCompleteEvent,
  createAssistantMessage,
  createTextBlock,
  createToolResultBlock,
  createToolUseBlock,
  createUserMessageFromContent,
  createUserMessageFromText,
  getProjectSessionDir,
  QueryEngine,
  type ApiClient,
  type ApiMessageRequest,
  type ApiStreamEvent,
  type ConversationMessage,
  type StreamEvent,
  type UsageSnapshot
} from "../src/index.js";

interface SessionStorageTestOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
}

interface SaveSessionSnapshotTestArgs extends SessionStorageTestOptions {
  readonly cwd: string;
  readonly sessionId?: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly ConversationMessage[];
  readonly usage?: UsageSnapshot;
  readonly toolMetadata?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

interface SaveQueryEngineSnapshotTestArgs extends SessionStorageTestOptions {
  readonly engine: QueryEngine;
  readonly sessionId?: string;
  readonly usage?: UsageSnapshot;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

interface ExportSessionTranscriptTestArgs extends SessionStorageTestOptions {
  readonly cwd: string;
  readonly sessionId: string;
}

interface SessionSnapshotForTest {
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly messages: readonly ConversationMessage[];
  readonly usage?: UsageSnapshot;
  readonly toolMetadata: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly messageCount: number;
  readonly path: string;
}

interface SessionSummaryForTest {
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly summary: string;
  readonly messageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly path: string;
}

interface SessionApiExports extends Record<string, unknown> {
  readonly FileSessionBackend: unknown;
  readonly saveSessionSnapshot: (args: SaveSessionSnapshotTestArgs) => Promise<SessionSnapshotForTest>;
  readonly loadLatestSession: (
    cwd: string,
    options?: SessionStorageTestOptions
  ) => Promise<SessionSnapshotForTest | undefined>;
  readonly loadSessionById: (
    cwd: string,
    sessionId: string,
    options?: SessionStorageTestOptions
  ) => Promise<SessionSnapshotForTest | undefined>;
  readonly listRecentSessions: (
    cwd: string,
    options?: SessionStorageTestOptions & { readonly limit?: number }
  ) => Promise<readonly SessionSummaryForTest[]>;
  readonly exportSessionTranscript: (args: ExportSessionTranscriptTestArgs) => Promise<string>;
  readonly saveQueryEngineSnapshot: (
    args: SaveQueryEngineSnapshotTestArgs
  ) => Promise<SessionSnapshotForTest>;
}

class ScriptedApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];
  public constructor(private readonly turns: readonly (readonly ApiStreamEvent[])[]) {}

  public async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    this.requests.push(request);
    const turn = this.turns[this.requests.length - 1];
    if (turn === undefined) {
      throw new Error(`No scripted turn ${this.requests.length}`);
    }
    for (const event of turn) {
      yield event;
    }
  }
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeStorageContext(): { readonly root: string; readonly homeDir: string; readonly cwd: string } {
  const root = makeTempDir("openharness-sessions-");
  return {
    root,
    homeDir: join(root, "home"),
    cwd: join(root, "workspace", "project")
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

async function collectEvents(iterable: AsyncIterable<StreamEvent>): Promise<readonly StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

async function loadRootSessionExports(): Promise<SessionApiExports> {
  const modulePath = "../src/index.js" as string;
  return (await import(modulePath)) as unknown as SessionApiExports;
}

async function loadSessionBarrelExports(): Promise<SessionApiExports> {
  const modulePath = "../src/sessions/index.js" as string;
  return (await import(modulePath)) as unknown as SessionApiExports;
}

describe("session snapshot filesystem persistence", () => {
  it("saves JSONL as the source of truth and latest.json as a pointer", async () => {
    const { saveSessionSnapshot } = await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();
    const usage: UsageSnapshot = { inputTokens: 3, outputTokens: 5 };
    const messages = [
      createUserMessageFromText("inspect this project"),
      createAssistantMessage([
        createTextBlock("I will inspect it."),
        createToolUseBlock({
          id: "toolu_echo",
          name: "echo",
          input: { value: "hello" }
        })
      ]),
      createUserMessageFromContent([
        createToolResultBlock({
          toolUseId: "toolu_echo",
          content: "hello",
          metadata: { elapsedMs: 1 }
        })
      ]),
      createAssistantMessage([createTextBlock("done")], {
        reasoningContent: "brief reasoning"
      })
    ];

    try {
      const snapshot = await saveSessionSnapshot({
        cwd,
        homeDir,
        env: {},
        sessionId: "sess_001",
        model: "mock-model",
        systemPrompt: "You are OpenHarness.",
        messages,
        usage,
        toolMetadata: {
          permissionMode: "default",
          nested: { value: true },
          unsupported: new URL("https://example.com")
        },
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:01.000Z"
      });

      const sessionDir = getProjectSessionDir(cwd, { env: {}, homeDir });
      const jsonlPath = join(sessionDir, "session-sess_001.jsonl");
      const latestPath = join(sessionDir, "latest.json");
      const latest = readJson(latestPath);
      const jsonlLines = readFileSync(jsonlPath, "utf8").trim().split(/\r?\n/);

      expect(snapshot).toMatchObject({
        sessionId: "sess_001",
        cwd: resolve(cwd),
        model: "mock-model",
        summary: "inspect this project",
        messageCount: 4,
        path: jsonlPath
      });
      expect(existsSync(jsonlPath)).toBe(true);
      expect(latest).toEqual({
        sessionId: "sess_001",
        path: "session-sess_001.jsonl",
        cwd: resolve(cwd),
        model: "mock-model",
        summary: "inspect this project",
        messageCount: 4,
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:01.000Z"
      });
      expect(latest).not.toHaveProperty("messages");
      expect(jsonlLines.map((line) => JSON.parse(line).type)).toEqual([
        "session_start",
        "message",
        "message",
        "message",
        "message",
        "usage",
        "tool_metadata",
        "session_summary"
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads latest and by id from JSONL", async () => {
    const { loadLatestSession, loadSessionById, saveSessionSnapshot } =
      await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();
    const messages = [
      createUserMessageFromText("load me"),
      createAssistantMessage([createTextBlock("loaded")])
    ];

    try {
      await saveSessionSnapshot({
        cwd,
        homeDir,
        env: {},
        sessionId: "sess_load",
        model: "mock-model",
        systemPrompt: "System",
        messages,
        usage: { inputTokens: 1, outputTokens: 2 },
        toolMetadata: { permissionMode: "full_auto" },
        createdAt: "2026-06-12T11:00:00.000Z",
        updatedAt: "2026-06-12T11:00:01.000Z"
      });

      const latest = await loadLatestSession(cwd, { env: {}, homeDir });
      const byId = await loadSessionById(cwd, "sess_load", { env: {}, homeDir });

      expect(latest).toEqual(byId);
      expect(latest?.messages).toEqual(messages);
      expect(latest?.usage).toEqual({ inputTokens: 1, outputTokens: 2 });
      expect(latest?.toolMetadata).toEqual({ permissionMode: "full_auto" });
      expect(latest?.summary).toBe("load me");
      expect(latest?.messageCount).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lists recent sessions newest first", async () => {
    const { listRecentSessions, saveSessionSnapshot } = await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();

    try {
      await saveSessionSnapshot({
        cwd,
        homeDir,
        env: {},
        sessionId: "older",
        model: "mock-model",
        systemPrompt: "System",
        messages: [createUserMessageFromText("older prompt")],
        createdAt: "2026-06-12T09:00:00.000Z",
        updatedAt: "2026-06-12T09:00:01.000Z"
      });
      await saveSessionSnapshot({
        cwd,
        homeDir,
        env: {},
        sessionId: "newer",
        model: "mock-model",
        systemPrompt: "System",
        messages: [createUserMessageFromText("newer prompt")],
        createdAt: "2026-06-12T12:00:00.000Z",
        updatedAt: "2026-06-12T12:00:01.000Z"
      });

      const recent = await listRecentSessions(cwd, { env: {}, homeDir, limit: 1 });

      expect(recent).toEqual([
        {
          sessionId: "newer",
          cwd: resolve(cwd),
          model: "mock-model",
          summary: "newer prompt",
          messageCount: 1,
          createdAt: "2026-06-12T12:00:00.000Z",
          updatedAt: "2026-06-12T12:00:01.000Z",
          path: join(getProjectSessionDir(cwd, { env: {}, homeDir }), "session-newer.jsonl")
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exports transcript markdown from JSONL", async () => {
    const { exportSessionTranscript, saveSessionSnapshot } = await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();

    try {
      await saveSessionSnapshot({
        cwd,
        homeDir,
        env: {},
        sessionId: "sess_transcript",
        model: "mock-model",
        systemPrompt: "System",
        messages: [
          createUserMessageFromText("hello"),
          createAssistantMessage([
            createTextBlock("hi"),
            createToolUseBlock({
              id: "toolu_echo",
              name: "echo",
              input: { value: "hello" }
            })
          ]),
          createUserMessageFromContent([
            createToolResultBlock({
              toolUseId: "toolu_echo",
              content: "hello"
            })
          ])
        ],
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:01.000Z"
      });

      const transcriptPath = await exportSessionTranscript({
        cwd,
        sessionId: "sess_transcript",
        env: {},
        homeDir
      });
      const transcript = readFileSync(transcriptPath, "utf8");

      expect(basename(transcriptPath)).toBe("transcript-sess_transcript.md");
      expect(transcript).toContain("# OpenHarness Session Transcript");
      expect(transcript).toContain("## User");
      expect(transcript).toContain("hello");
      expect(transcript).toContain("## Assistant");
      expect(transcript).toContain("hi");
      expect(transcript).toContain("```tool");
      expect(transcript).toContain("echo {\"value\":\"hello\"}");
      expect(transcript).toContain("```tool-result");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns undefined for missing latest and missing session id", async () => {
    const { loadLatestSession, loadSessionById } = await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();

    try {
      await expect(loadLatestSession(cwd, { env: {}, homeDir })).resolves.toBeUndefined();
      await expect(loadSessionById(cwd, "missing", { env: {}, homeDir })).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws clear errors for invalid ids and malformed direct loads", async () => {
    const { loadSessionById, saveSessionSnapshot } = await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();

    try {
      await expect(
        saveSessionSnapshot({
          cwd,
          homeDir,
          env: {},
          sessionId: "../bad",
          model: "mock-model",
          systemPrompt: "System",
          messages: []
        })
      ).rejects.toThrow("sessionId must contain only letters, numbers, underscores, or hyphens.");

      const sessionDir = getProjectSessionDir(cwd, { env: {}, homeDir });
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, "session-broken.jsonl"), "{\"type\":\"session_start\"\n", {
        encoding: "utf8"
      });

      await expect(loadSessionById(cwd, "broken", { env: {}, homeDir })).rejects.toThrow(
        "Invalid JSONL in session-broken.jsonl at line 1"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists a completed QueryEngine run through the helper", async () => {
    const { saveQueryEngineSnapshot } = await loadRootSessionExports();
    const { root, homeDir, cwd } = makeStorageContext();
    const client = new ScriptedApiClient([
      [
        createApiMessageCompleteEvent({
          message: createAssistantMessage([createTextBlock("saved")]),
          usage: { inputTokens: 7, outputTokens: 11 }
        })
      ]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd,
      model: "mock-model",
      systemPrompt: "System",
      toolMetadata: { permissionMode: "default" }
    });

    try {
      const events = await collectEvents(engine.submitMessage("save me"));
      const complete = events.find((event) => event.type === "assistant_turn_complete");
      expect(complete?.type).toBe("assistant_turn_complete");
      if (complete?.type !== "assistant_turn_complete" || complete.usage === undefined) {
        throw new Error("Expected completed assistant turn with usage.");
      }
      const usage: UsageSnapshot = complete.usage;

      const snapshot = await saveQueryEngineSnapshot({
        engine,
        env: {},
        homeDir,
        sessionId: "engine_run",
        usage,
        createdAt: "2026-06-12T10:00:00.000Z",
        updatedAt: "2026-06-12T10:00:01.000Z"
      });

      expect(snapshot.messages).toEqual(engine.getMessages());
      expect(snapshot.usage).toEqual({ inputTokens: 7, outputTokens: 11 });
      expect(snapshot.toolMetadata).toEqual({ permissionMode: "default" });
      expect(readJson(join(getProjectSessionDir(cwd, { env: {}, homeDir }), "latest.json"))).toMatchObject({
        sessionId: "engine_run",
        path: "session-engine_run.jsonl"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("session public exports", () => {
  it("exports session APIs from the sessions barrel and package root", async () => {
    const sessions = await loadSessionBarrelExports();
    const root = await loadRootSessionExports();

    expectSessionExports(sessions);
    expectSessionExports(root);
  });
});

function expectSessionExports(exports: Record<string, unknown>): void {
  expect(typeof exports.FileSessionBackend).toBe("function");
  expect(typeof exports.saveSessionSnapshot).toBe("function");
  expect(typeof exports.loadLatestSession).toBe("function");
  expect(typeof exports.loadSessionById).toBe("function");
  expect(typeof exports.listRecentSessions).toBe("function");
  expect(typeof exports.exportSessionTranscript).toBe("function");
  expect(typeof exports.saveQueryEngineSnapshot).toBe("function");
}
