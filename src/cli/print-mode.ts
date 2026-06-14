import { dirname, join } from "node:path";
import type { ApiClient } from "../api/index.js";
import { getMessageText } from "../messages/index.js";
import type { PermissionMode } from "../permissions/index.js";
import { buildProjectRuntime } from "../project-runtime/index.js";
import type {
  SessionBackend,
  SessionSnapshot
} from "../sessions/index.js";
import type {
  AssistantTurnCompleteEvent,
  StreamEvent,
  UsageSnapshot
} from "../stream-events/index.js";

export class PrintModeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PrintModeError";
  }
}

export interface PrintModeProviderOptions {
  readonly apiClient: ApiClient;
  readonly model: string;
  readonly maxTokens?: number;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
  readonly signal?: AbortSignal;
  readonly sessionId?: string;
  readonly sessionBackend?: SessionBackend;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}

export interface RunPrintModeOptions extends PrintModeProviderOptions {
  readonly prompt: string;
  readonly cwd?: string | URL;
}

export interface PrintModeSessionArtifacts {
  readonly sessionId: string;
  readonly sessionDir: string;
  readonly latestPath: string;
  readonly snapshotPath: string;
  readonly transcriptPath: string;
  readonly messageCount: number;
  readonly summary: string;
}

export interface PrintModeResult {
  readonly assistantText: string;
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly snapshotPath: string;
  readonly transcriptPath: string;
  readonly session: PrintModeSessionArtifacts;
  readonly events: readonly StreamEvent[];
  readonly sessionBackend: SessionBackend;
}

export async function runPrintMode(
  options: RunPrintModeOptions
): Promise<PrintModeResult> {
  const prompt = options.prompt.trim();

  if (prompt.length === 0) {
    throw new PrintModeError("print prompt is required.");
  }

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
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    ...(options.permissionMode === undefined
      ? {}
      : { permissionMode: options.permissionMode }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });
  const events: StreamEvent[] = [];
  const textDeltas: string[] = [];
  let finalAssistantEvent: AssistantTurnCompleteEvent | undefined;
  let usage: UsageSnapshot | undefined;

  for await (const event of runtime.engine.submitMessage(prompt)) {
    events.push(event);

    switch (event.type) {
      case "assistant_text_delta":
        textDeltas.push(event.text);
        break;
      case "assistant_turn_complete":
        finalAssistantEvent = event;
        if (event.usage !== undefined) {
          usage = event.usage;
        }
        break;
      case "error":
        if (!event.recoverable) {
          throw new PrintModeError(event.message);
        }
        break;
      case "status":
      case "tool_execution_started":
      case "tool_execution_completed":
        break;
      default:
        assertNever(event);
    }
  }

  const assistantText =
    textDeltas.length > 0
      ? textDeltas.join("")
      : getFinalAssistantText(finalAssistantEvent);
  const snapshot = await savePrintModeSnapshot(runtime, options, usage);
  const transcriptPath = await exportPrintModeTranscript(runtime, options);
  const session = createPrintModeSessionArtifacts(snapshot, transcriptPath);

  return {
    assistantText,
    sessionId: runtime.sessionId,
    cwd: runtime.cwd,
    model: runtime.engine.getModel(),
    snapshotPath: snapshot.path,
    transcriptPath,
    session,
    events,
    sessionBackend: runtime.sessionBackend
  };
}

function getFinalAssistantText(
  event: AssistantTurnCompleteEvent | undefined
): string {
  if (event === undefined) {
    return "";
  }

  return getMessageText(event.message);
}

async function savePrintModeSnapshot(
  runtime: ReturnType<typeof buildProjectRuntime>,
  options: RunPrintModeOptions,
  usage: UsageSnapshot | undefined
): Promise<SessionSnapshot> {
  try {
    return await runtime.sessionBackend.saveSnapshot({
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
  } catch (error) {
    throw new PrintModeError(
      `Session snapshot save failed: ${getErrorMessage(error)}`
    );
  }
}

async function exportPrintModeTranscript(
  runtime: ReturnType<typeof buildProjectRuntime>,
  options: RunPrintModeOptions
): Promise<string> {
  try {
    return await runtime.sessionBackend.exportTranscript({
      cwd: runtime.cwd,
      sessionId: runtime.sessionId,
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.now === undefined ? {} : { now: options.now })
    });
  } catch (error) {
    throw new PrintModeError(
      `Session transcript export failed: ${getErrorMessage(error)}`
    );
  }
}

function createPrintModeSessionArtifacts(
  snapshot: SessionSnapshot,
  transcriptPath: string
): PrintModeSessionArtifacts {
  const sessionDir = dirname(snapshot.path);

  return {
    sessionId: snapshot.sessionId,
    sessionDir,
    latestPath: join(sessionDir, "latest.json"),
    snapshotPath: snapshot.path,
    transcriptPath,
    messageCount: snapshot.messageCount,
    summary: snapshot.summary
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled print-mode event: ${String(value)}`);
}
