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
      parts.push("```reasoning", message.reasoningContent.trim(), "```", "");
    }

    for (const toolUse of getToolUses(message)) {
      parts.push(
        "```tool",
        `${toolUse.name} ${JSON.stringify(toolUse.input)}`,
        "```",
        ""
      );
    }

    for (const block of message.content) {
      if (isToolResultBlock(block)) {
        parts.push("```tool-result", block.content, "```", "");
      }
    }
  }

  return `${parts.join("\n").trim()}\n`;
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
