import { describe, expect, it } from "vitest";
import {
  createAssistantMessage,
  createAssistantTextDeltaEvent,
  createErrorEvent,
  createStatusEvent,
  createTextBlock,
  createToolExecutionCompletedEvent,
  createToolExecutionStartedEvent,
  type ExportSessionTranscriptArgs,
  type ListSessionsOptions,
  type SaveSessionSnapshotArgs,
  type SessionBackend,
  type SessionSnapshot,
  type SessionSummary
} from "../src/index.js";
import * as cli from "../src/cli/index.js";
import type { PrintModeResult } from "../src/cli/index.js";

type RenderCliOutput = (options: {
  readonly result: PrintModeResult;
  readonly format: "text" | "json" | "stream-json";
}) => string;

type RenderCliErrorOutput = (options: {
  readonly format: "text" | "json" | "stream-json";
  readonly message: string;
  readonly code?: string;
}) => string;

const renderCliOutput = (
  cli as unknown as { readonly renderCliOutput: RenderCliOutput }
).renderCliOutput;
const renderCliErrorOutput = (
  cli as unknown as { readonly renderCliErrorOutput: RenderCliErrorOutput }
).renderCliErrorOutput;

class EmptySessionBackend implements SessionBackend {
  public async saveSnapshot(
    _args: SaveSessionSnapshotArgs
  ): Promise<SessionSnapshot> {
    throw new Error("not used");
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
    throw new Error("not used");
  }
}

const expectedSession = {
  sessionId: "session_output",
  sessionDir: "C:\\work\\project\\.openharness",
  latestPath: "C:\\work\\project\\.openharness\\latest.json",
  snapshotPath:
    "C:\\work\\project\\.openharness\\session-session_output.jsonl",
  transcriptPath:
    "C:\\work\\project\\.openharness\\transcript-session_output.md",
  messageCount: 2,
  summary: "Hello"
} as const;

function createResult(): PrintModeResult {
  return {
    assistantText: "Hello from OpenHarness.",
    sessionId: "session_output",
    cwd: "C:\\work\\project",
    model: "deepseek-test",
    snapshotPath:
      "C:\\work\\project\\.openharness\\session-session_output.jsonl",
    transcriptPath:
      "C:\\work\\project\\.openharness\\transcript-session_output.md",
    session: expectedSession,
    sessionBackend: new EmptySessionBackend(),
    events: [
      createStatusEvent("starting"),
      createAssistantTextDeltaEvent("Hello"),
      createAssistantTextDeltaEvent(" from OpenHarness."),
      createToolExecutionStartedEvent({
        toolName: "grep",
        toolUseId: "toolu_1",
        toolInput: { pattern: "OpenHarness" }
      }),
      createToolExecutionCompletedEvent({
        toolName: "grep",
        toolUseId: "toolu_1",
        output: "src/index.ts:1:OpenHarness",
        isError: false
      }),
      createErrorEvent("recoverable warning", { recoverable: true }),
      {
        type: "assistant_turn_complete",
        message: createAssistantMessage([
          createTextBlock("Hello from OpenHarness.")
        ])
      }
    ]
  };
}

function parseJsonLines(text: string): unknown[] {
  return text
    .trimEnd()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

describe("renderCliOutput", () => {
  it("renders text output as assistant text plus newline", () => {
    expect(renderCliOutput({ result: createResult(), format: "text" })).toBe(
      "Hello from OpenHarness.\n"
    );
  });

  it("renders json output as one final result without raw events", () => {
    const output = renderCliOutput({ result: createResult(), format: "json" });
    const parsed = JSON.parse(output) as {
      readonly type: string;
      readonly outputFormat: string;
      readonly assistantText: string;
      readonly sessionId: string;
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
      };
      readonly summary: {
        readonly eventCount: number;
        readonly textDeltaCount: number;
        readonly toolCallCount: number;
        readonly toolResults: readonly unknown[];
        readonly statuses: readonly unknown[];
        readonly errors: readonly unknown[];
      };
      readonly events?: unknown;
      readonly messages?: unknown;
      readonly transcript?: unknown;
    };

    expect(parsed.type).toBe("final_result");
    expect(parsed.outputFormat).toBe("json");
    expect(parsed.assistantText).toBe("Hello from OpenHarness.");
    expect(parsed.sessionId).toBe("session_output");
    expect(parsed.cwd).toBe("C:\\work\\project");
    expect(parsed.model).toBe("deepseek-test");
    expect(parsed.snapshotPath).toBe(
      "C:\\work\\project\\.openharness\\session-session_output.jsonl"
    );
    expect(parsed.session).toEqual(expectedSession);
    expect(parsed.session.sessionId).toBe(parsed.sessionId);
    expect(parsed.session.snapshotPath).toBe(parsed.snapshotPath);
    expect(parsed.summary).toMatchObject({
      eventCount: 7,
      textDeltaCount: 2,
      toolCallCount: 1
    });
    expect(parsed.summary.toolResults).toHaveLength(1);
    expect(parsed.summary.statuses).toHaveLength(1);
    expect(parsed.summary.errors).toHaveLength(1);
    expect(parsed.events).toBeUndefined();
    expect(parsed.messages).toBeUndefined();
    expect(parsed.transcript).toBeUndefined();
  });

  it("renders stream-json output as ordered json lines ending in final result", () => {
    const output = renderCliOutput({
      result: createResult(),
      format: "stream-json"
    });
    const lines = parseJsonLines(output) as Array<{
      readonly type: string;
      readonly snapshotPath?: string;
      readonly session?: typeof expectedSession;
    }>;

    expect(lines.map((line) => line.type)).toEqual([
      "status",
      "assistant_text_delta",
      "assistant_text_delta",
      "tool_execution_started",
      "tool_execution_completed",
      "error",
      "final_result"
    ]);
    const final = lines.at(-1) as {
      readonly type: string;
      readonly outputFormat: string;
      readonly assistantText: string;
      readonly sessionId: string;
      readonly cwd: string;
      readonly model: string;
      readonly snapshotPath: string;
      readonly summary: unknown;
      readonly session: typeof expectedSession & {
        readonly messages?: unknown;
        readonly transcript?: unknown;
      };
      readonly messages?: unknown;
      readonly transcript?: unknown;
    };

    expect(final).toMatchObject({
      type: "final_result",
      outputFormat: "stream-json",
      assistantText: "Hello from OpenHarness.",
      sessionId: "session_output",
      cwd: "C:\\work\\project",
      model: "deepseek-test",
      snapshotPath: expectedSession.snapshotPath
    });
    expect(final.summary).toMatchObject({
      eventCount: 7,
      textDeltaCount: 2,
      toolCallCount: 1
    });
    expect(final.session).toEqual(expectedSession);
    expect(final.session.snapshotPath).toBe(final.snapshotPath);
    expect(final.messages).toBeUndefined();
    expect(final.transcript).toBeUndefined();
    expect(final.session.messages).toBeUndefined();
    expect(final.session.transcript).toBeUndefined();
  });
});

describe("renderCliErrorOutput", () => {
  it("renders text errors as plain text", () => {
    expect(
      renderCliErrorOutput({
        format: "text",
        message: "provider failed"
      })
    ).toBe("provider failed\n");
  });

  it("renders json errors as one json object", () => {
    const parsed = JSON.parse(
      renderCliErrorOutput({
        format: "json",
        message: "provider failed",
        code: "provider_error"
      })
    ) as {
      readonly type: string;
      readonly outputFormat: string;
      readonly message: string;
      readonly code: string;
    };

    expect(parsed).toEqual({
      type: "error",
      outputFormat: "json",
      message: "provider failed",
      code: "provider_error"
    });
  });

  it("renders stream-json errors as one json line", () => {
    const lines = parseJsonLines(
      renderCliErrorOutput({
        format: "stream-json",
        message: "provider failed"
      })
    ) as Array<{
      readonly type: string;
      readonly outputFormat: string;
      readonly message: string;
    }>;

    expect(lines).toEqual([
      {
        type: "error",
        outputFormat: "stream-json",
        message: "provider failed"
      }
    ]);
  });
});
