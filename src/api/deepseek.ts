import OpenAI from "openai";
import type { ApiClient, ApiMessageRequest } from "./client.js";
import {
  createApiMessageCompleteEvent,
  createApiTextDeltaEvent,
  type ApiStreamEvent
} from "./events.js";
import {
  createAssistantMessage,
  createTextBlock,
  createToolUseBlock,
  type ContentBlock
} from "../messages/index.js";
import type { UsageSnapshot } from "../stream-events/index.js";
import {
  convertMessagesToOpenAI,
  convertToolsToOpenAI,
  type OpenAIChatMessage,
  type OpenAIFunctionTool
} from "./openai-format.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export type DeepSeekThinkingOptions =
  | { readonly type: "disabled" }
  | { readonly type: "enabled" };

export type DeepSeekReasoningEffort = "high" | "max";

export type DeepSeekToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      readonly type: "function";
      readonly function: {
        readonly name: string;
      };
    };

export interface DeepSeekSdkOptions {
  readonly apiKey: string;
  readonly baseURL: string;
  readonly timeout?: number;
}

export interface DeepSeekSdkClient {
  readonly chat: {
    readonly completions: {
      create(...args: readonly unknown[]): Promise<AsyncIterable<unknown>>;
    };
  };
}

interface DeepSeekChatCompletionParams {
  readonly model: string;
  readonly messages: readonly OpenAIChatMessage[];
  readonly stream: true;
  readonly stream_options: {
    readonly include_usage: true;
  };
  readonly max_tokens?: number;
  readonly tools?: readonly OpenAIFunctionTool[];
  readonly tool_choice?: DeepSeekToolChoice;
  readonly reasoning_effort?: DeepSeekReasoningEffort;
  readonly thinking?: DeepSeekThinkingOptions;
}

interface ToolCallAccumulator {
  readonly index: number;
  id?: string;
  name?: string;
  arguments: string;
}

export interface DeepSeekProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly thinking?: DeepSeekThinkingOptions;
  readonly reasoningEffort?: DeepSeekReasoningEffort;
  readonly timeout?: number;
  readonly toolChoice?: DeepSeekToolChoice;
  readonly createSdkClient?: (options: DeepSeekSdkOptions) => DeepSeekSdkClient;
}

export class DeepSeekApiClient implements ApiClient {
  public readonly baseURL: string;
  public readonly model: string;
  public readonly maxTokens?: number;
  public readonly thinking?: DeepSeekThinkingOptions;
  public readonly reasoningEffort?: DeepSeekReasoningEffort;
  public readonly toolChoice?: DeepSeekToolChoice;

  private readonly sdkClient: DeepSeekSdkClient;

  public constructor(options: DeepSeekProviderOptions) {
    const apiKey = options.apiKey?.trim();

    if (apiKey === undefined || apiKey.length === 0) {
      throw new Error("DeepSeek API key is required.");
    }

    this.baseURL = normalizeDeepSeekBaseURL(options.baseURL);
    this.model = normalizeDeepSeekModel(options.model);

    if (options.maxTokens !== undefined) {
      this.maxTokens = options.maxTokens;
    }

    if (options.thinking !== undefined) {
      this.thinking = options.thinking;
    }

    if (options.reasoningEffort !== undefined) {
      this.reasoningEffort = options.reasoningEffort;
    }

    if (options.toolChoice !== undefined) {
      this.toolChoice = options.toolChoice;
    }

    const sdkOptions: DeepSeekSdkOptions = {
      apiKey,
      baseURL: this.baseURL,
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {})
    };

    this.sdkClient =
      options.createSdkClient?.(sdkOptions) ??
      (new OpenAI(sdkOptions) as DeepSeekSdkClient);
  }

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    const tools =
      request.tools !== undefined && request.tools.length > 0
        ? convertToolsToOpenAI(request.tools)
        : undefined;
    const maxTokens = request.maxTokens ?? this.maxTokens;
    const requestedModel = request.model.trim();
    const toolChoice =
      tools !== undefined &&
      this.toolChoice !== undefined &&
      !isUnsupportedThinkingToolChoice(this.thinking, this.toolChoice)
        ? this.toolChoice
        : undefined;

    const params: DeepSeekChatCompletionParams = {
      model: requestedModel.length > 0 ? requestedModel : this.model,
      messages: convertMessagesToOpenAI(request.messages, request.systemPrompt),
      stream: true,
      stream_options: { include_usage: true },
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(tools !== undefined ? { tools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
      ...(this.reasoningEffort !== undefined
        ? { reasoning_effort: this.reasoningEffort }
        : {}),
      ...(this.thinking !== undefined ? { thinking: this.thinking } : {})
    };

    const stream = await this.sdkClient.chat.completions.create(params);
    const visibleText: string[] = [];
    const reasoningText: string[] = [];
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let usage: UsageSnapshot | undefined;

    for await (const chunk of stream) {
      usage = getUsage(chunk) ?? usage;

      const delta = getRecord(getFirstChoice(chunk)?.["delta"]);
      if (delta === undefined) {
        continue;
      }

      const contentPiece = getString(delta["content"]);
      if (contentPiece !== undefined && contentPiece.length > 0) {
        visibleText.push(contentPiece);
        yield createApiTextDeltaEvent(contentPiece);
      }

      const reasoningPiece = getString(delta["reasoning_content"]);
      if (reasoningPiece !== undefined && reasoningPiece.length > 0) {
        reasoningText.push(reasoningPiece);
      }

      collectToolCallDelta(delta["tool_calls"], toolCalls);
    }

    const contentBlocks: ContentBlock[] = [];
    const text = visibleText.join("");
    if (text.length > 0) {
      contentBlocks.push(createTextBlock(text));
    }

    for (const toolCall of [...toolCalls.values()].sort(
      (left, right) => left.index - right.index
    )) {
      if (toolCall.name === undefined || toolCall.name.trim().length === 0) {
        continue;
      }

      contentBlocks.push(
        createToolUseBlock({
          ...(toolCall.id !== undefined && toolCall.id.trim().length > 0
            ? { id: toolCall.id }
            : {}),
          name: toolCall.name,
          input: parseToolArguments(toolCall.arguments)
        })
      );
    }

    const reasoningContent = reasoningText.join("");

    yield createApiMessageCompleteEvent({
      message: createAssistantMessage(contentBlocks, {
        ...(reasoningContent.length > 0 ? { reasoningContent } : {})
      }),
      ...(usage !== undefined ? { usage } : {})
    });
  }
}

function isUnsupportedThinkingToolChoice(
  thinking: DeepSeekThinkingOptions | undefined,
  toolChoice: DeepSeekToolChoice
): boolean {
  return thinking?.type === "enabled" && toolChoice === "required";
}

export function createDeepSeekApiClientFromEnv(
  options: DeepSeekProviderOptions = {}
): DeepSeekApiClient {
  const apiKey = options.apiKey ?? process.env["DEEPSEEK_API_KEY"];
  const baseURL = options.baseURL ?? process.env["DEEPSEEK_BASE_URL"];
  const model = options.model ?? process.env["DEEPSEEK_MODEL"];

  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error(
      "DEEPSEEK_API_KEY is required to create a DeepSeek API client."
    );
  }

  return new DeepSeekApiClient({
    ...options,
    apiKey,
    ...(baseURL !== undefined ? { baseURL } : {}),
    ...(model !== undefined ? { model } : {})
  });
}

export function normalizeDeepSeekBaseURL(baseURL?: string): string {
  const normalized = baseURL?.trim().replace(/\/+$/u, "");
  return normalized !== undefined && normalized.length > 0
    ? normalized
    : DEFAULT_DEEPSEEK_BASE_URL;
}

function normalizeDeepSeekModel(model?: string): string {
  const normalized = model?.trim();
  return normalized !== undefined && normalized.length > 0
    ? normalized
    : DEFAULT_DEEPSEEK_MODEL;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function getFirstChoice(chunk: unknown): Record<string, unknown> | undefined {
  const record = getRecord(chunk);
  const choices = Array.isArray(record?.["choices"])
    ? record["choices"]
    : undefined;

  return choices === undefined ? undefined : getRecord(choices[0]);
}

function getUsage(chunk: unknown): UsageSnapshot | undefined {
  const usage = getRecord(getRecord(chunk)?.["usage"]);
  const inputTokens = getNumber(usage?.["prompt_tokens"]);
  const outputTokens = getNumber(usage?.["completion_tokens"]);

  if (inputTokens === undefined || outputTokens === undefined) {
    return undefined;
  }

  return { inputTokens, outputTokens };
}

function collectToolCallDelta(
  value: unknown,
  toolCalls: Map<number, ToolCallAccumulator>
): void {
  if (!Array.isArray(value)) {
    return;
  }

  for (const item of value) {
    const toolCall = getRecord(item);
    const index = getNumber(toolCall?.["index"]);
    if (index === undefined) {
      continue;
    }

    const accumulator = toolCalls.get(index) ?? {
      index,
      arguments: ""
    };
    const id = getString(toolCall?.["id"]);
    if (id !== undefined) {
      accumulator.id = id;
    }

    const functionDelta = getRecord(toolCall?.["function"]);
    const name = getString(functionDelta?.["name"]);
    if (name !== undefined) {
      accumulator.name = name;
    }

    const argumentDelta = getString(functionDelta?.["arguments"]);
    if (argumentDelta !== undefined) {
      accumulator.arguments += argumentDelta;
    }

    toolCalls.set(index, accumulator);
  }
}

function parseToolArguments(value: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(value);
    return getRecord(parsed) ?? {};
  } catch {
    return {};
  }
}
