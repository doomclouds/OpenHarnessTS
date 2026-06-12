import {
  getMessageText,
  getToolUses,
  isToolResultBlock,
  type ConversationMessage
} from "../messages/index.js";

export function renderSessionTranscript(
  messages: readonly ConversationMessage[]
): string {
  const parts = ["# OpenHarness Session Transcript", ""];

  for (const message of messages) {
    parts.push(`## ${capitalize(message.role)}`, "");

    const text = getMessageText(message).trim();
    if (text.length > 0) {
      parts.push(text, "");
    }

    if (
      message.reasoningContent !== undefined &&
      message.reasoningContent.trim().length > 0
    ) {
      parts.push(...renderFencedBlock("reasoning", message.reasoningContent.trim()));
    }

    for (const toolUse of getToolUses(message)) {
      parts.push(...renderFencedBlock(
        "tool",
        `${toolUse.name} ${JSON.stringify(toolUse.input)}`
      ));
    }

    for (const block of message.content) {
      if (isToolResultBlock(block)) {
        parts.push(...renderFencedBlock("tool-result", block.content));
      }
    }
  }

  return `${parts.join("\n").trim()}\n`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function renderFencedBlock(info: string, content: string): string[] {
  const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
  return [`${fence}${info}`, content, fence, ""];
}

function longestBacktickRun(content: string): number {
  let longest = 0;
  for (const match of content.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return longest;
}
