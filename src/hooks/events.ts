export type HookEvent =
  | "user_prompt_submit"
  | "pre_tool_use"
  | "post_tool_use"
  | "stop";

export interface UserPromptSubmitHookPayload {
  readonly event: "user_prompt_submit";
  readonly prompt: string;
}

export interface PreToolUseHookPayload {
  readonly event: "pre_tool_use";
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly toolUseId: string;
}

export interface PostToolUseHookPayload {
  readonly event: "post_tool_use";
  readonly toolName: string;
  readonly toolInput: unknown;
  readonly toolUseId: string;
  readonly toolOutput: string;
  readonly toolIsError: boolean;
  readonly toolResultMetadata?: Readonly<Record<string, unknown>>;
}

export interface StopHookPayload {
  readonly event: "stop";
  readonly stopReason: "tool_uses_empty";
}

export interface HookPayloadByEvent {
  readonly user_prompt_submit: UserPromptSubmitHookPayload;
  readonly pre_tool_use: PreToolUseHookPayload;
  readonly post_tool_use: PostToolUseHookPayload;
  readonly stop: StopHookPayload;
}

export type HookPayload = HookPayloadByEvent[HookEvent];

export type HookExecuteArgs = {
  readonly [E in HookEvent]: [event: E, payload: HookPayloadByEvent[E]];
}[HookEvent];

export interface HookResult {
  readonly hookType: string;
  readonly success: boolean;
  readonly output?: string;
  readonly blocked?: boolean;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AggregatedHookResult {
  readonly results: readonly HookResult[];
  readonly blocked: boolean;
  readonly reason: string;
}
