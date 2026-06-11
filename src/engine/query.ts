import type { ApiMessageCompleteEvent } from "../api/index.js";
import {
  createAggregatedHookResult,
  type AggregatedHookResult,
  type HookEvent,
  type HookPayloadByEvent
} from "../hooks/index.js";
import {
  createUserMessageFromContent,
  getMessageText,
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

  await executeHook(context, "user_prompt_submit", {
    event: "user_prompt_submit",
    prompt: getLatestUserPrompt(messages)
  });

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

    await executeHook(context, "stop", {
      event: "stop",
      stopReason: "tool_uses_empty"
    });

    return;
  }

  yield createErrorEvent(`Max turns exceeded: ${maxTurns}`, {
    recoverable: false
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function executeHook(
  context: QueryContext,
  ...[event, payload]: {
    readonly [E in HookEvent]: [
      event: E,
      payload: HookPayloadByEvent[E]
    ];
  }[HookEvent]
): Promise<AggregatedHookResult> {
  if (context.hookExecutor === undefined) {
    return createAggregatedHookResult();
  }

  try {
    switch (event) {
      case "user_prompt_submit":
        return await context.hookExecutor.execute(event, payload);
      case "pre_tool_use":
        return await context.hookExecutor.execute(event, payload);
      case "post_tool_use":
        return await context.hookExecutor.execute(event, payload);
      case "stop":
        return await context.hookExecutor.execute(event, payload);
      default:
        return assertNever(event);
    }
  } catch (error) {
    return createAggregatedHookResult([
      {
        hookType: "hook_executor",
        success: false,
        output: `Hook ${event} failed: ${getErrorMessage(error)}`
      }
    ]);
  }
}

function getLatestUserPrompt(messages: readonly ConversationMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role === "user") {
      return getMessageText(message);
    }
  }

  return "";
}

function assertNever(value: never): never {
  throw new Error(`Unhandled hook event: ${String(value)}`);
}

async function executeToolUse(
  context: QueryContext,
  toolUse: ToolUseBlock
): Promise<ToolResultBlock> {
  const rawInput = toolUse.input;
  const preHooks =
    context.hookExecutor === undefined
      ? createAggregatedHookResult()
      : await executeHook(context, "pre_tool_use", {
          event: "pre_tool_use",
          toolName: toolUse.name,
          toolInput: createHookSnapshot(rawInput),
          toolUseId: toolUse.id
        });

  if (preHooks.blocked) {
    return finishToolUse(
      context,
      toolUse,
      rawInput,
      createErrorToolResultBlock(
        toolUse.id,
        preHooks.reason || `pre_tool_use hook blocked ${toolUse.name}`
      )
    );
  }

  const tool = context.toolRegistry.getTool(toolUse.name);

  if (tool === undefined) {
    return finishToolUse(
      context,
      toolUse,
      rawInput,
      createErrorToolResultBlock(
        toolUse.id,
        `Unknown tool: ${toolUse.name}`
      )
    );
  }

  let input: unknown = rawInput;

  if (tool.validateInput !== undefined) {
    try {
      const validation = tool.validateInput(rawInput);

      if (!validation.ok) {
        return finishToolUse(
          context,
          toolUse,
          rawInput,
          createErrorToolResultBlock(
            toolUse.id,
            `Invalid input for ${tool.name}: ${validation.error}`
          )
        );
      }

      input = validation.value;
    } catch (error) {
      return finishToolUse(
        context,
        toolUse,
        rawInput,
        createErrorToolResultBlock(
          toolUse.id,
          `Invalid input for ${tool.name}: ${getErrorMessage(error)}`
        )
      );
    }
  }

  let isReadOnly = false;
  try {
    isReadOnly = tool.isReadOnly?.(input) ?? false;
  } catch (error) {
    return finishToolUse(
      context,
      toolUse,
      input,
      createErrorToolResultBlock(
        toolUse.id,
        `Invalid read-only policy for ${tool.name}: ${getErrorMessage(error)}`
      )
    );
  }

  const decision = context.permissionChecker.evaluate({
    toolName: tool.name,
    isReadOnly,
    ...extractPermissionPath(input, rawInput)
  });

  if (!decision.allowed) {
    return finishToolUse(
      context,
      toolUse,
      input,
      createErrorToolResultBlock(toolUse.id, decision.reason)
    );
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

  return finishToolUse(
    context,
    toolUse,
    input,
    createToolResultBlockFromToolResult({
      toolUseId: toolUse.id,
      result
    })
  );
}

async function finishToolUse(
  context: QueryContext,
  toolUse: ToolUseBlock,
  toolInput: unknown,
  toolResult: ToolResultBlock
): Promise<ToolResultBlock> {
  if (context.hookExecutor === undefined) {
    return toolResult;
  }

  await executeHook(context, "post_tool_use", {
    event: "post_tool_use",
    toolName: toolUse.name,
    toolInput: createHookSnapshot(toolInput),
    toolUseId: toolUse.id,
    toolOutput: toolResult.content,
    toolIsError: toolResult.isError,
    toolResultMetadata: createHookSnapshot(toolResult.metadata)
  });

  return toolResult;
}

function createHookSnapshot<T>(value: T): T {
  if (!isHookSnapshotObject(value)) {
    return value;
  }

  return deepFreezeHookSnapshot(cloneHookSnapshotValue(value)) as T;
}

function cloneHookSnapshotValue(
  value: unknown,
  seen: WeakMap<object, unknown> = new WeakMap()
): unknown {
  if (!isHookSnapshotObject(value)) {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);

    for (const item of value) {
      clone.push(cloneHookSnapshotValue(item, seen));
    }

    return clone;
  }

  const clone: Record<string, unknown> = {};
  seen.set(value, clone);

  for (const [key, nestedValue] of Object.entries(value)) {
    clone[key] = cloneHookSnapshotValue(nestedValue, seen);
  }

  return clone;
}

function deepFreezeHookSnapshot<T>(
  value: T,
  seen: WeakSet<object> = new WeakSet()
): T {
  if (!isHookSnapshotObject(value)) {
    return value;
  }

  if (seen.has(value)) {
    return value;
  }
  seen.add(value);

  for (const nestedValue of Object.values(value)) {
    deepFreezeHookSnapshot(nestedValue, seen);
  }

  return Object.freeze(value);
}

function isHookSnapshotObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
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
