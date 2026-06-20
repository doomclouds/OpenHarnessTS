import type { ApiClient } from "../../api/index.js";
import type { ConversationMessage } from "../../messages/index.js";
import type { PermissionMode } from "../../permissions/index.js";
import { buildProjectRuntime } from "../../project-runtime/index.js";
import type { SessionBackend } from "../../sessions/index.js";
import type { StreamEvent, UsageSnapshot } from "../../stream-events/index.js";
import { mapStreamEventToTuiEvents } from "../model/event-mapper.js";
import type { TuiEvent, TuiSessionArtifacts } from "../model/index.js";
import { createTuiSessionArtifacts } from "./session-artifacts.js";

export interface RunTuiRuntimeTurnOptions {
  readonly prompt: string;
  readonly apiClient: ApiClient;
  readonly model: string;
  readonly cwd?: string | URL;
  readonly sessionId?: string;
  readonly sessionBackend?: SessionBackend;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
  readonly initialMessages?: readonly ConversationMessage[];
  readonly maxTokens?: number;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
  readonly signal?: AbortSignal;
  readonly onEvent: (event: TuiEvent) => void | Promise<void>;
}

export interface TuiRuntimeTurnResult {
  readonly sessionId: string;
  readonly artifacts: TuiSessionArtifacts;
  readonly events: readonly StreamEvent[];
  readonly messages: readonly ConversationMessage[];
}

class NonRecoverableRuntimeEventError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NonRecoverableRuntimeEventError";
  }
}

export async function runTuiRuntimeTurn(
  options: RunTuiRuntimeTurnOptions
): Promise<TuiRuntimeTurnResult> {
  const prompt = options.prompt.trim();
  if (prompt.length === 0) {
    throw new Error("TUI runtime prompt is required.");
  }

  await dispatch(options, {
    type: "turn_started",
    busyLabel: "Thinking..."
  });

  const events: StreamEvent[] = [];

  try {
    const runtime = buildProjectRuntime({
      apiClient: options.apiClient,
      model: options.model,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.sessionBackend === undefined
        ? {}
        : { sessionBackend: options.sessionBackend }),
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.initialMessages === undefined
        ? {}
        : { initialMessages: options.initialMessages }),
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      ...(options.permissionMode === undefined
        ? {}
        : { permissionMode: options.permissionMode }),
      ...(options.signal === undefined ? {} : { signal: options.signal })
    });
    let usage: UsageSnapshot | undefined;

    for await (const streamEvent of runtime.engine.submitMessage(prompt)) {
      events.push(streamEvent);

      if (
        streamEvent.type === "assistant_turn_complete" &&
        streamEvent.usage !== undefined
      ) {
        usage = streamEvent.usage;
      }

      for (const tuiEvent of mapStreamEventToTuiEvents(streamEvent)) {
        await dispatch(options, tuiEvent);
      }

      if (streamEvent.type === "error" && !streamEvent.recoverable) {
        throw new NonRecoverableRuntimeEventError(streamEvent.message);
      }
    }

    const snapshot = await runtime.sessionBackend.saveSnapshot({
      cwd: runtime.cwd,
      sessionId: runtime.sessionId,
      model: runtime.engine.getModel(),
      systemPrompt: runtime.engine.getSystemPrompt(),
      messages: runtime.engine.getMessages(),
      toolMetadata: runtime.engine.getToolMetadata(),
      ...(usage === undefined ? {} : { usage }),
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const transcriptPath = await runtime.sessionBackend.exportTranscript({
      cwd: runtime.cwd,
      sessionId: runtime.sessionId,
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
    const artifacts = createTuiSessionArtifacts(snapshot, transcriptPath);

    await dispatch(options, {
      type: "line_complete",
      artifacts
    });

    return {
      sessionId: runtime.sessionId,
      artifacts,
      events,
      messages: runtime.engine.getMessages()
    };
  } catch (error) {
    if (!(error instanceof NonRecoverableRuntimeEventError)) {
      await dispatch(options, {
        type: "error",
        message: getErrorMessage(error)
      });
    }

    throw error;
  }
}

async function dispatch(
  options: RunTuiRuntimeTurnOptions,
  event: TuiEvent
): Promise<void> {
  await options.onEvent(event);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
