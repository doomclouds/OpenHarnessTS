import type { ApiMessageCompleteEvent } from "../api/index.js";
import {
  createUserMessageFromContent,
  getToolUses,
  isEffectivelyEmpty,
  type ConversationMessage,
  type ToolResultBlock,
  type ToolUseBlock
} from "../messages/index.js";
import {
  createAssistantTextDeltaEvent,
  createAssistantTurnCompleteEvent,
  createErrorEvent,
  createStatusEvent,
  createToolExecutionCompletedEvent,
  createToolExecutionStartedEvent,
  type StreamEvent
} from "../stream-events/index.js";
import {
  createToolErrorResult,
  createToolResultBlockFromToolResult,
  normalizeToolResult,
  type ToolResult
} from "../tools/index.js";
import type { QueryContext } from "./context.js";

const DEFAULT_MAX_TURNS = 200;

export async function* runQuery(
  context: QueryContext,
  messages: ConversationMessage[]
): AsyncIterable<StreamEvent> {
  const maxTurns = context.maxTurns ?? DEFAULT_MAX_TURNS;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    let finalEvent: ApiMessageCompleteEvent | undefined;

    try {
      for await (const event of context.apiClient.streamMessage({
        model: context.model,
        messages: [...messages],
        ...(context.systemPrompt !== undefined
          ? { systemPrompt: context.systemPrompt }
          : {}),
        ...(context.maxTokens !== undefined ? { maxTokens: context.maxTokens } : {}),
        tools: context.toolRegistry.toApiSchema()
      })) {
        if (event.type === "text_delta") {
          yield createAssistantTextDeltaEvent(event.text);
          continue;
        }

        if (event.type === "retry") {
          yield createStatusEvent(
            `Request failed; retrying in ${event.delaySeconds.toFixed(1)}s (attempt ${event.attempt + 1} of ${event.maxAttempts}): ${event.message}`
          );
          continue;
        }

        finalEvent = event;
      }
    } catch (error) {
      yield createErrorEvent(`API error: ${getErrorMessage(error)}`, {
        recoverable: false
      });
      return;
    }

    if (finalEvent === undefined) {
      yield createErrorEvent("Model stream finished without a final message", {
        recoverable: false
      });
      return;
    }

    const assistantMessage = finalEvent.message;

    if (assistantMessage.role !== "assistant") {
      yield createErrorEvent(
        "Model returned a non-assistant final message. The turn was ignored to keep the session healthy.",
        { recoverable: false }
      );
      return;
    }

    if (isEffectivelyEmpty(assistantMessage)) {
      yield createErrorEvent(
        "Model returned an empty assistant message. The turn was ignored to keep the session healthy.",
        { recoverable: false }
      );
      return;
    }

    messages.push(assistantMessage);

    yield createAssistantTurnCompleteEvent({
      message: assistantMessage,
      ...(finalEvent.usage !== undefined ? { usage: finalEvent.usage } : {})
    });

    const toolUses = getToolUses(assistantMessage);
    if (toolUses.length > 0) {
      const toolResults: ToolResultBlock[] = [];

      for (const toolUse of toolUses) {
        yield createToolExecutionStartedEvent({
          toolName: toolUse.name,
          toolInput: toolUse.input,
          toolUseId: toolUse.id
        });

        const toolResult = await executeToolUse(context, toolUse);
        toolResults.push(toolResult);

        yield createToolExecutionCompletedEvent({
          toolName: toolUse.name,
          output: toolResult.content,
          isError: toolResult.isError,
          metadata: toolResult.metadata,
          toolUseId: toolUse.id
        });
      }

      messages.push(createUserMessageFromContent(toolResults));
      continue;
    }

    return;
  }

  yield createErrorEvent(`Max turns exceeded: ${maxTurns}`, {
    recoverable: false
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function executeToolUse(
  context: QueryContext,
  toolUse: ToolUseBlock
): Promise<ToolResultBlock> {
  const tool = context.toolRegistry.getTool(toolUse.name);

  if (tool === undefined) {
    return createErrorToolResultBlock(
      toolUse.id,
      `Unknown tool: ${toolUse.name}`
    );
  }

  const rawInput = toolUse.input;
  let input: unknown = rawInput;

  if (tool.validateInput !== undefined) {
    try {
      const validation = tool.validateInput(rawInput);

      if (!validation.ok) {
        return createErrorToolResultBlock(
          toolUse.id,
          `Invalid input for ${tool.name}: ${validation.error}`
        );
      }

      input = validation.value;
    } catch (error) {
      return createErrorToolResultBlock(
        toolUse.id,
        `Invalid input for ${tool.name}: ${getErrorMessage(error)}`
      );
    }
  }

  let isReadOnly = false;
  try {
    isReadOnly = tool.isReadOnly?.(input) ?? false;
  } catch (error) {
    return createErrorToolResultBlock(
      toolUse.id,
      `Invalid read-only policy for ${tool.name}: ${getErrorMessage(error)}`
    );
  }

  const decision = context.permissionChecker.evaluate({
    toolName: tool.name,
    isReadOnly,
    ...extractPermissionPath(input, rawInput)
  });

  if (!decision.allowed) {
    return createErrorToolResultBlock(toolUse.id, decision.reason);
  }

  let result: ToolResult;
  try {
    result = normalizeToolResult(
      await tool.execute(input, {
        cwd: context.cwd,
        ...(context.signal !== undefined ? { signal: context.signal } : {}),
        metadata: context.toolMetadata ?? {}
      })
    );
  } catch (error) {
    result = createToolErrorResult(
      `Tool ${tool.name} failed: ${getErrorMessage(error)}`
    );
  }

  return createToolResultBlockFromToolResult({
    toolUseId: toolUse.id,
    result
  });
}

function createErrorToolResultBlock(
  toolUseId: string,
  output: string
): ToolResultBlock {
  return createToolResultBlockFromToolResult({
    toolUseId,
    result: createToolErrorResult(output)
  });
}

function extractPermissionPath(
  ...inputs: readonly unknown[]
): { readonly filePath?: string } {
  for (const input of inputs) {
    if (typeof input !== "object" || input === null) {
      continue;
    }

    const record = input as Readonly<Record<string, unknown>>;
    const filePath = record.filePath ?? record.path;

    if (typeof filePath === "string") {
      return { filePath };
    }
  }

  return {};
}
