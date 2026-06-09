import type { ConversationMessage } from "../messages/index.js";

export interface UsageSnapshot {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
  readonly raw?: unknown;
}

export interface AssistantTextDeltaEvent {
  readonly type: "assistant_text_delta";
  readonly text: string;
}

export interface AssistantTurnCompleteEvent {
  readonly type: "assistant_turn_complete";
  readonly message: ConversationMessage;
  readonly usage?: UsageSnapshot;
  readonly stopReason?: string;
}

export interface ToolExecutionStartedEvent {
  readonly type: "tool_execution_started";
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly toolUseId?: string;
}

export interface ToolExecutionCompletedEvent {
  readonly type: "tool_execution_completed";
  readonly toolName: string;
  readonly output: string;
  readonly isError: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly toolUseId?: string;
}

export interface StatusEvent {
  readonly type: "status";
  readonly message: string;
}

export interface ErrorEvent {
  readonly type: "error";
  readonly message: string;
  readonly recoverable: boolean;
}

export type StreamEvent =
  | AssistantTextDeltaEvent
  | AssistantTurnCompleteEvent
  | ToolExecutionStartedEvent
  | ToolExecutionCompletedEvent
  | StatusEvent
  | ErrorEvent;

export function createAssistantTextDeltaEvent(
  text: string
): AssistantTextDeltaEvent {
  return {
    type: "assistant_text_delta",
    text
  };
}

export function createAssistantTurnCompleteEvent(args: {
  readonly message: ConversationMessage;
  readonly usage?: UsageSnapshot;
  readonly stopReason?: string;
}): AssistantTurnCompleteEvent {
  if (args.message.role !== "assistant") {
    throw new Error("Assistant turn completion requires an assistant message.");
  }

  return {
    type: "assistant_turn_complete",
    message: args.message,
    ...(args.usage ? { usage: args.usage } : {}),
    ...(args.stopReason ? { stopReason: args.stopReason } : {})
  };
}

export function createToolExecutionStartedEvent(args: {
  readonly toolName: string;
  readonly toolInput: Readonly<Record<string, unknown>>;
  readonly toolUseId?: string;
}): ToolExecutionStartedEvent {
  return {
    type: "tool_execution_started",
    toolName: args.toolName,
    toolInput: args.toolInput,
    ...(args.toolUseId ? { toolUseId: args.toolUseId } : {})
  };
}

export function createToolExecutionCompletedEvent(args: {
  readonly toolName: string;
  readonly output: string;
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly toolUseId?: string;
}): ToolExecutionCompletedEvent {
  return {
    type: "tool_execution_completed",
    toolName: args.toolName,
    output: args.output,
    isError: args.isError ?? false,
    ...(args.metadata ? { metadata: args.metadata } : {}),
    ...(args.toolUseId ? { toolUseId: args.toolUseId } : {})
  };
}

export function createStatusEvent(message: string): StatusEvent {
  return {
    type: "status",
    message
  };
}

export function createErrorEvent(
  message: string,
  options: { readonly recoverable?: boolean } = {}
): ErrorEvent {
  return {
    type: "error",
    message,
    recoverable: options.recoverable ?? true
  };
}
