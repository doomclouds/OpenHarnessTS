import type { ToolDefinition } from "./tools/index.js";

export type {
  JsonSchema,
  ToolApiSchema,
  ToolDefinition,
  ToolExecutionContext,
  ToolInputValidationResult,
  ToolInputValidator,
  ToolResult
} from "./tools/index.js";

export interface HarnessRuntimeOptions {
  readonly tools?: readonly ToolDefinition[];
}
