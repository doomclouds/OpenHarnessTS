import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeepSeekApiClientFromEnv,
  DeepSeekApiClient,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  normalizeDeepSeekBaseURL,
  type DeepSeekReasoningEffort,
  type DeepSeekSdkClient,
  type DeepSeekSdkOptions
} from "../src/index.js";

function emptyFakeSdkClient(): DeepSeekSdkClient {
  return {
    chat: {
      completions: {
        async create() {
          return (async function* () {})();
        }
      }
    }
  };
}

describe("DeepSeek client configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("exports DeepSeek defaults", () => {
    expect(DEFAULT_DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
    expect(DEFAULT_DEEPSEEK_MODEL).toBe("deepseek-v4-flash");
  });

  it("requires a DeepSeek API key in env helper", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    expect(() => createDeepSeekApiClientFromEnv()).toThrow(
      "DEEPSEEK_API_KEY is required to create a DeepSeek API client."
    );
  });

  it("reads DeepSeek env values and trims base URL trailing slashes", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    vi.stubEnv("DEEPSEEK_API_KEY", "env-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://deepseek.example.com///");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-env-model");

    const client = createDeepSeekApiClientFromEnv({
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(client.baseURL).toBe("https://deepseek.example.com");
    expect(client.model).toBe("deepseek-env-model");
    expect(sdkOptions).toEqual([
      {
        apiKey: "env-key",
        baseURL: "https://deepseek.example.com"
      }
    ]);
  });

  it("lets constructor options override env defaults", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    vi.stubEnv("DEEPSEEK_API_KEY", "env-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://deepseek.example.com");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-env-model");

    const client = createDeepSeekApiClientFromEnv({
      apiKey: "option-key",
      baseURL: "https://override.example.com/",
      model: "deepseek-option-model",
      maxTokens: 1024,
      thinking: { type: "enabled", budgetTokens: 128 },
      reasoningEffort: "high",
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(client.baseURL).toBe("https://override.example.com");
    expect(client.model).toBe("deepseek-option-model");
    expect(client.maxTokens).toBe(1024);
    expect(client.thinking).toEqual({ type: "enabled", budgetTokens: 128 });
    expect(client.reasoningEffort).toBe("high");
    expect(sdkOptions).toEqual([
      {
        apiKey: "option-key",
        baseURL: "https://override.example.com"
      }
    ]);
  });

  it("preserves disabled thinking options", () => {
    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      thinking: { type: "disabled" },
      createSdkClient: emptyFakeSdkClient
    });

    expect(client.thinking).toEqual({ type: "disabled" });
  });

  it("preserves enabled thinking budget and high reasoning effort", () => {
    const reasoningEffort: DeepSeekReasoningEffort = "high";

    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      thinking: { type: "enabled", budgetTokens: 128 },
      reasoningEffort,
      createSdkClient: emptyFakeSdkClient
    });

    expect(client.thinking).toEqual({ type: "enabled", budgetTokens: 128 });
    expect(client.reasoningEffort).toBe("high");
  });

  it("constructs with a fake SDK client and supports required tool choice", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      baseURL: "https://direct.example.com/",
      model: "deepseek-direct-model",
      timeout: 30_000,
      toolChoice: "required",
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(client.baseURL).toBe("https://direct.example.com");
    expect(client.model).toBe("deepseek-direct-model");
    expect(client.toolChoice).toBe("required");
    expect(sdkOptions).toEqual([
      {
        apiKey: "direct-key",
        baseURL: "https://direct.example.com",
        timeout: 30_000
      }
    ]);
  });

  it("requires a DeepSeek API key in direct constructor", () => {
    expect(
      () =>
        new DeepSeekApiClient({
          apiKey: "   ",
          createSdkClient: emptyFakeSdkClient
        })
    ).toThrow("DeepSeek API key is required.");
  });

  it("keeps streamMessage as an explicit skeleton", () => {
    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      createSdkClient: emptyFakeSdkClient
    });

    expect(() =>
      client.streamMessage({
        model: client.model,
        messages: []
      })
    ).toThrow("DeepSeek streaming is not implemented yet.");
  });

  it("normalizes base URL trailing slashes", () => {
    expect(normalizeDeepSeekBaseURL("https://api.example.com///")).toBe(
      "https://api.example.com"
    );
    expect(normalizeDeepSeekBaseURL(undefined)).toBe(
      DEFAULT_DEEPSEEK_BASE_URL
    );
  });
});
