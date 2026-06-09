import { randomUUID } from "node:crypto";

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ImageBlock {
  readonly type: "image";
  readonly source: ImageSource;
}

export type ImageSource =
  | { readonly type: "path"; readonly path: string }
  | {
      readonly type: "base64";
      readonly mediaType: string;
      readonly data: string;
    }
  | { readonly type: "url"; readonly url: string };

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly toolUseId: string;
  readonly content: string;
  readonly isError: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock;

export function createTextBlock(text: string): TextBlock {
  return {
    type: "text",
    text
  };
}

export function createToolUseBlock(args: {
  readonly id?: string;
  readonly name: string;
  readonly input?: Readonly<Record<string, unknown>>;
}): ToolUseBlock {
  const name = args.name.trim();

  if (name.length === 0) {
    throw new Error("Tool name cannot be empty.");
  }

  return {
    type: "tool_use",
    id: args.id ?? `toolu_${randomUUID().replaceAll("-", "")}`,
    name,
    input: args.input ?? {}
  };
}

export function createToolResultBlock(args: {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): ToolResultBlock {
  if (args.toolUseId.trim().length === 0) {
    throw new Error("Tool result must reference a tool use id.");
  }

  return {
    type: "tool_result",
    toolUseId: args.toolUseId,
    content: args.content,
    isError: args.isError ?? false,
    metadata: args.metadata ?? {}
  };
}

export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

export function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === "tool_use";
}

export function isToolResultBlock(
  block: ContentBlock
): block is ToolResultBlock {
  return block.type === "tool_result";
}
