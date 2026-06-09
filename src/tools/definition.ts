import type { ToolResult } from "./results.js";

export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolApiSchema {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JsonSchema;
}

export type ToolInputValidationResult<TInput> =
  | { readonly ok: true; readonly value: TInput }
  | { readonly ok: false; readonly error: string };

export type ToolInputValidator<TInput> = (
  input: unknown
) => ToolInputValidationResult<TInput>;

export interface ToolExecutionContext {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface ToolDefinition<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: JsonSchema;
  readonly isReadOnly?: (input: TInput) => boolean;
  readonly validateInput?: ToolInputValidator<TInput>;
  execute(
    input: TInput,
    context: ToolExecutionContext
  ): Promise<ToolResult> | ToolResult;
}
