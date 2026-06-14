import {
  DeepSeekApiClient,
  DEFAULT_DEEPSEEK_MODEL,
  normalizeDeepSeekBaseURL,
  type DeepSeekSdkClient,
  type DeepSeekSdkOptions
} from "../api/index.js";
import type { PermissionMode } from "../permissions/index.js";

export const MISSING_DEEPSEEK_API_KEY_MESSAGE =
  "DEEPSEEK_API_KEY is required. Set it in the environment or pass --api-key.";

export interface CliPrintProviderFlags {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
}

export interface CreateCliPrintProviderOptions {
  readonly flags: CliPrintProviderFlags;
  readonly env?: NodeJS.ProcessEnv;
  readonly createSdkClient?: (options: DeepSeekSdkOptions) => DeepSeekSdkClient;
}

export interface CliPrintProvider {
  readonly apiClient: DeepSeekApiClient;
  readonly model: string;
  readonly maxTurns?: number;
  readonly permissionMode: PermissionMode;
  readonly redact: (text: string) => string;
}

export type CliProviderValueSource = "flag" | "env" | "default";

export interface CliProviderPreview {
  readonly provider: "deepseek";
  readonly apiFormat: "openai-compatible";
  readonly model: string;
  readonly modelSource: CliProviderValueSource;
  readonly baseURL: string;
  readonly baseURLSource: CliProviderValueSource;
  readonly apiKeySource: "flag" | "env" | "missing";
  readonly authStatus: "configured" | "missing";
  readonly apiClientValidation: {
    readonly status: "ok" | "error";
    readonly detail: string;
  };
}

export class CliProviderError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliProviderError";
  }
}

export function createCliPrintProvider(
  options: CreateCliPrintProviderOptions
): CliPrintProvider {
  const env = options.env ?? process.env;
  const apiKey = firstNonEmpty(options.flags.apiKey, env["DEEPSEEK_API_KEY"]);

  if (apiKey === undefined) {
    throw new CliProviderError(MISSING_DEEPSEEK_API_KEY_MESSAGE);
  }

  const baseURL = firstNonEmpty(
    options.flags.baseURL,
    env["DEEPSEEK_BASE_URL"]
  );
  const model = firstNonEmpty(options.flags.model, env["DEEPSEEK_MODEL"]);
  let apiClient: DeepSeekApiClient;
  try {
    apiClient = new DeepSeekApiClient({
      apiKey,
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(model === undefined ? {} : { model }),
      ...(options.createSdkClient === undefined
        ? {}
        : { createSdkClient: options.createSdkClient })
    });
  } catch (error) {
    throw new CliProviderError(redactWithKey(apiKey, getErrorMessage(error)));
  }

  const resolvedModel = apiClient.model || DEFAULT_DEEPSEEK_MODEL;

  return {
    apiClient,
    model: resolvedModel,
    ...(options.flags.maxTurns === undefined
      ? {}
      : { maxTurns: options.flags.maxTurns }),
    permissionMode: options.flags.permissionMode ?? "default",
    redact(text) {
      return redactWithKey(apiKey, text);
    }
  };
}

export function resolveCliProviderPreview(
  options: CreateCliPrintProviderOptions
): CliProviderPreview {
  const env = options.env ?? process.env;
  const model = resolveProviderValue(
    options.flags.model,
    env["DEEPSEEK_MODEL"],
    DEFAULT_DEEPSEEK_MODEL
  );
  const baseURL = resolveProviderValue(
    options.flags.baseURL,
    env["DEEPSEEK_BASE_URL"],
    undefined
  );
  const apiKeySource = resolveApiKeySource(
    options.flags.apiKey,
    env["DEEPSEEK_API_KEY"]
  );
  const authStatus = apiKeySource === "missing" ? "missing" : "configured";

  return {
    provider: "deepseek",
    apiFormat: "openai-compatible",
    model: model.value ?? DEFAULT_DEEPSEEK_MODEL,
    modelSource: model.source,
    baseURL: normalizeDeepSeekBaseURL(baseURL.value),
    baseURLSource: baseURL.source,
    apiKeySource,
    authStatus,
    apiClientValidation:
      authStatus === "configured"
        ? { status: "ok", detail: "" }
        : {
            status: "error",
            detail: MISSING_DEEPSEEK_API_KEY_MESSAGE
          }
  };
}

function firstNonEmpty(
  first: string | undefined,
  second: string | undefined
): string | undefined {
  const normalizedFirst = normalizeOptionalString(first);
  if (normalizedFirst !== undefined) {
    return normalizedFirst;
  }

  return normalizeOptionalString(second);
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();

  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}

function resolveProviderValue(
  flagValue: string | undefined,
  envValue: string | undefined,
  defaultValue: string | undefined
): {
  readonly value: string | undefined;
  readonly source: CliProviderValueSource;
} {
  const normalizedFlagValue = normalizeOptionalString(flagValue);
  if (normalizedFlagValue !== undefined) {
    return { value: normalizedFlagValue, source: "flag" };
  }

  const normalizedEnvValue = normalizeOptionalString(envValue);
  if (normalizedEnvValue !== undefined) {
    return { value: normalizedEnvValue, source: "env" };
  }

  return { value: defaultValue, source: "default" };
}

function resolveApiKeySource(
  flagValue: string | undefined,
  envValue: string | undefined
): "flag" | "env" | "missing" {
  if (normalizeOptionalString(flagValue) !== undefined) {
    return "flag";
  }

  if (normalizeOptionalString(envValue) !== undefined) {
    return "env";
  }

  return "missing";
}

function redactWithKey(key: string | undefined, text: string): string {
  if (key === undefined || key.length === 0) {
    return text;
  }

  return text.replaceAll(key, "[REDACTED]");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
