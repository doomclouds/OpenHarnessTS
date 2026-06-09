import {
  createToolResultBlock,
  type ToolResultBlock
} from "../messages/index.js";
import {
  createToolErrorResult,
  normalizeToolResult,
  type ToolResult
} from "./results.js";
import type { ToolExecutionContext } from "./definition.js";
import type { ToolRegistry } from "./registry.js";

export interface RegisteredToolCall {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly input: unknown;
}

export async function executeRegisteredTool(
  registry: ToolRegistry,
  call: RegisteredToolCall,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const tool = registry.getTool(call.toolName);

  if (!tool) {
    return createToolErrorResult(`Unknown tool: ${call.toolName}`);
  }

  let input = call.input;

  if (tool.validateInput) {
    try {
      const validation = tool.validateInput(call.input);

      if (!validation.ok) {
        return createToolErrorResult(
          `Invalid input for ${tool.name}: ${validation.error}`
        );
      }

      input = validation.value;
    } catch (error) {
      return createToolErrorResult(
        `Invalid input for ${tool.name}: ${errorToMessage(error)}`
      );
    }
  }

  try {
    return normalizeToolResult(await tool.execute(input, context));
  } catch (error) {
    return createToolErrorResult(
      `Tool ${tool.name} failed: ${errorToMessage(error)}`
    );
  }
}

export function createToolResultBlockFromToolResult(args: {
  readonly toolUseId: string;
  readonly result: ToolResult;
}): ToolResultBlock {
  return createToolResultBlock({
    toolUseId: args.toolUseId,
    content: args.result.output,
    isError: args.result.isError,
    metadata: args.result.metadata
  });
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
