import {
  DeepSeekApiClient,
  DEFAULT_DEEPSEEK_MODEL,
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

function redactWithKey(key: string | undefined, text: string): string {
  if (key === undefined || key.length === 0) {
    return text;
  }

  return text.replaceAll(key, "[REDACTED]");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
