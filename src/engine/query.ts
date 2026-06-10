import type { ApiMessageCompleteEvent } from "../api/index.js";
import {
  getToolUses,
  isEffectivelyEmpty,
  type ConversationMessage
} from "../messages/index.js";
import {
  createAssistantTextDeltaEvent,
  createAssistantTurnCompleteEvent,
  createErrorEvent,
  createStatusEvent,
  type StreamEvent
} from "../stream-events/index.js";
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
          yield createStatusEvent(event.message);
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

    if (getToolUses(assistantMessage).length > 0) {
      yield createErrorEvent("Tool execution is not implemented yet", {
        recoverable: false
      });
      return;
    }

    yield createAssistantTurnCompleteEvent({
      message: assistantMessage,
      ...(finalEvent.usage !== undefined ? { usage: finalEvent.usage } : {})
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
