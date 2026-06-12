import {
  createDeepSeekApiClientFromEnv,
  type DeepSeekReasoningEffort,
  type DeepSeekSdkClient,
  type DeepSeekSdkOptions,
  type DeepSeekThinkingOptions,
  type DeepSeekToolChoice
} from "./api/index.js";
import { QueryEngine, type QueryEngineOptions } from "./engine/index.js";

export interface CreateDeepSeekQueryEngineFromEnvOptions
  extends Omit<QueryEngineOptions, "apiClient" | "model"> {
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly thinking?: DeepSeekThinkingOptions;
  readonly reasoningEffort?: DeepSeekReasoningEffort;
  readonly timeout?: number;
  readonly toolChoice?: DeepSeekToolChoice;
  readonly createSdkClient?: (options: DeepSeekSdkOptions) => DeepSeekSdkClient;
}

export function createDeepSeekQueryEngineFromEnv(
  options: CreateDeepSeekQueryEngineFromEnvOptions
): QueryEngine {
  const {
    apiKey,
    baseURL,
    model,
    thinking,
    reasoningEffort,
    timeout,
    toolChoice,
    createSdkClient,
    ...engineOptions
  } = options;
  const apiClient = createDeepSeekApiClientFromEnv({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(model === undefined ? {} : { model }),
    ...(engineOptions.maxTokens === undefined
      ? {}
      : { maxTokens: engineOptions.maxTokens }),
    ...(thinking === undefined ? {} : { thinking }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(timeout === undefined ? {} : { timeout }),
    ...(toolChoice === undefined ? {} : { toolChoice }),
    ...(createSdkClient === undefined ? {} : { createSdkClient })
  });

  return new QueryEngine({
    ...engineOptions,
    apiClient,
    model: apiClient.model
  });
}
