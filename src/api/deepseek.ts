import OpenAI from "openai";
import type { ApiClient, ApiMessageRequest } from "./client.js";
import type { ApiStreamEvent } from "./events.js";

export const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";

export interface DeepSeekThinkingOptions {
  readonly enabled?: boolean;
  readonly budgetTokens?: number;
}

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
      create(...args: readonly unknown[]): unknown;
    };
  };
}

export interface DeepSeekProviderOptions {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly thinking?: DeepSeekThinkingOptions;
  readonly reasoningEffort?: string;
  readonly timeout?: number;
  readonly toolChoice?: DeepSeekToolChoice;
  readonly createSdkClient?: (options: DeepSeekSdkOptions) => DeepSeekSdkClient;
}

export class DeepSeekApiClient implements ApiClient {
  public readonly baseURL: string;
  public readonly model: string;
  public readonly maxTokens?: number;
  public readonly thinking?: DeepSeekThinkingOptions;
  public readonly reasoningEffort?: string;
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

  public streamMessage(_request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    void this.sdkClient;
    throw new Error("DeepSeek streaming is not implemented yet.");
  }
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
