import type { ConversationMessage } from "../messages/index.js";
import type { UsageSnapshot } from "../stream-events/index.js";

export interface ApiTextDeltaEvent {
  readonly type: "text_delta";
  readonly text: string;
}

export interface ApiMessageCompleteEvent {
  readonly type: "message_complete";
  readonly message: ConversationMessage;
  readonly usage?: UsageSnapshot;
}

export interface ApiRetryEvent {
  readonly type: "retry";
  readonly message: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delaySeconds: number;
}

export type ApiStreamEvent =
  | ApiTextDeltaEvent
  | ApiMessageCompleteEvent
  | ApiRetryEvent;

export function createApiTextDeltaEvent(text: string): ApiTextDeltaEvent {
  return {
    type: "text_delta",
    text
  };
}

export function createApiMessageCompleteEvent(args: {
  readonly message: ConversationMessage;
  readonly usage?: UsageSnapshot;
}): ApiMessageCompleteEvent {
  return {
    type: "message_complete",
    message: args.message,
    ...(args.usage !== undefined ? { usage: args.usage } : {})
  };
}

export function createApiRetryEvent(args: {
  readonly message: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delaySeconds: number;
}): ApiRetryEvent {
  return {
    type: "retry",
    message: args.message,
    attempt: args.attempt,
    maxAttempts: args.maxAttempts,
    delaySeconds: args.delaySeconds
  };
}
