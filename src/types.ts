export type HarnessMessageRole = "system" | "user" | "assistant" | "tool";

export interface HarnessMessage {
  readonly role: HarnessMessageRole;
  readonly content: string;
}

export interface ToolExecutionContext {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ToolResult<TOutput = unknown> {
  readonly ok: boolean;
  readonly output?: TOutput;
  readonly error?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: unknown;
  execute(
    input: TInput,
    context: ToolExecutionContext
  ): Promise<ToolResult<TOutput>> | ToolResult<TOutput>;
}

export interface HarnessRuntimeOptions {
  readonly tools?: readonly ToolDefinition[];
}
