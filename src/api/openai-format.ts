import {
  getMessageText,
  getToolUses,
  isTextBlock,
  isToolResultBlock,
  type ConversationMessage
} from "../messages/index.js";
import type { JsonSchema, ToolApiSchema } from "../tools/index.js";

export interface OpenAIToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export type OpenAIChatMessage =
  | {
      readonly role: "system";
      readonly content: string;
    }
  | {
      readonly role: "user";
      readonly content: string;
    }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly OpenAIToolCall[];
    }
  | {
      readonly role: "tool";
      readonly tool_call_id: string;
      readonly content: string;
    };

export interface OpenAIFunctionTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: JsonSchema;
  };
}

export function convertMessagesToOpenAI(
  messages: readonly ConversationMessage[],
  systemPrompt?: string
): OpenAIChatMessage[] {
  const converted: OpenAIChatMessage[] = [];

  if (systemPrompt !== undefined && systemPrompt.trim().length > 0) {
    converted.push({ role: "system", content: systemPrompt });
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      converted.push(convertAssistantMessageToOpenAI(message));
      continue;
    }

    converted.push(...convertUserMessageToOpenAI(message));
  }

  return converted;
}

export function convertAssistantMessageToOpenAI(
  message: ConversationMessage
): OpenAIChatMessage {
  const content = getMessageText(message);
  const toolCalls = getToolUses(message).map(
    (toolUse): OpenAIToolCall => ({
      id: toolUse.id,
      type: "function",
      function: {
        name: toolUse.name,
        arguments: JSON.stringify(toolUse.input)
      }
    })
  );

  return {
    role: "assistant",
    content: content.length > 0 ? content : toolCalls.length > 0 ? null : "",
    ...(message.reasoningContent !== undefined &&
    message.reasoningContent.length > 0
      ? { reasoning_content: message.reasoningContent }
      : {}),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
  };
}

export function convertToolsToOpenAI(
  tools: readonly ToolApiSchema[]
): OpenAIFunctionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  }));
}

function convertUserMessageToOpenAI(
  message: ConversationMessage
): OpenAIChatMessage[] {
  const toolMessages = message.content
    .filter(isToolResultBlock)
    .map(
      (toolResult): OpenAIChatMessage => ({
        role: "tool",
        tool_call_id: toolResult.toolUseId,
        content: toolResult.content
      })
    );

  const text = message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("");

  if (text.length > 0 || toolMessages.length === 0) {
    return [...toolMessages, { role: "user", content: text }];
  }

  return toolMessages;
}
