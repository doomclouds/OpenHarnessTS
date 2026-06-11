import {
  createTextBlock,
  isTextBlock,
  isToolUseBlock,
  type ContentBlock,
  type ToolUseBlock
} from "./blocks.js";

export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  readonly role: MessageRole;
  readonly content: readonly ContentBlock[];
  readonly reasoningContent?: string;
}

export interface AssistantMessageOptions {
  readonly reasoningContent?: string;
}

export function createUserMessageFromText(text: string): ConversationMessage {
  return {
    role: "user",
    content: [createTextBlock(text)]
  };
}

export function createUserMessageFromContent(
  content: readonly ContentBlock[]
): ConversationMessage {
  return {
    role: "user",
    content: [...content]
  };
}

export function createAssistantMessage(
  content: readonly ContentBlock[],
  options: AssistantMessageOptions = {}
): ConversationMessage {
  return {
    role: "assistant",
    content: [...content],
    ...(options.reasoningContent !== undefined
      ? { reasoningContent: options.reasoningContent }
      : {})
  };
}

export function getMessageText(message: ConversationMessage): string {
  return message.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("");
}

export function getToolUses(
  message: ConversationMessage
): readonly ToolUseBlock[] {
  return message.content.filter(isToolUseBlock);
}

export function isEffectivelyEmpty(message: ConversationMessage): boolean {
  const hasMeaningfulText = message.content
    .filter(isTextBlock)
    .some((block) => block.text.trim().length > 0);

  return !hasMeaningfulText && getToolUses(message).length === 0;
}

export function isAssistantMessage(message: ConversationMessage): boolean {
  return message.role === "assistant";
}

export function isUserMessage(message: ConversationMessage): boolean {
  return message.role === "user";
}
