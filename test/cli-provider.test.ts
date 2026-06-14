import { describe, expect, it } from "vitest";
import {
  CliProviderError,
  MISSING_DEEPSEEK_API_KEY_MESSAGE,
  createCliPrintProvider,
  resolveCliProviderPreview
} from "../src/cli/index.js";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  type DeepSeekSdkClient,
  type DeepSeekSdkOptions
} from "../src/index.js";

const EXPECTED_MISSING_DEEPSEEK_API_KEY_MESSAGE =
  "DEEPSEEK_API_KEY is required. Set it in the environment or pass --api-key.";

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

describe("createCliPrintProvider", () => {
  it("lets CLI flags override environment values", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    const provider = createCliPrintProvider({
      flags: {
        apiKey: "flag-key",
        baseURL: "https://flag.example.com///",
        model: "flag-model",
        maxTurns: 4,
        permissionMode: "plan"
      },
      env: {
        DEEPSEEK_API_KEY: "env-key",
        DEEPSEEK_BASE_URL: "https://env.example.com",
        DEEPSEEK_MODEL: "env-model"
      },
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(provider.model).toBe("flag-model");
    expect(provider.apiClient.model).toBe("flag-model");
    expect(provider.apiClient.baseURL).toBe("https://flag.example.com");
    expect(provider.maxTurns).toBe(4);
    expect(provider.permissionMode).toBe("plan");
    expect(provider.redact("token=flag-key")).toBe("token=[REDACTED]");
    expect(sdkOptions).toEqual([
      {
        apiKey: "flag-key",
        baseURL: "https://flag.example.com"
      }
    ]);
  });

  it("uses environment values when flags are absent", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    const provider = createCliPrintProvider({
      flags: {},
      env: {
        DEEPSEEK_API_KEY: "env-key",
        DEEPSEEK_BASE_URL: "https://env.example.com///",
        DEEPSEEK_MODEL: "env-model"
      },
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(provider.model).toBe("env-model");
    expect(provider.apiClient.baseURL).toBe("https://env.example.com");
    expect(provider.permissionMode).toBe("default");
    expect(provider.maxTurns).toBeUndefined();
    expect(Object.hasOwn(provider, "maxTurns")).toBe(false);
    expect(provider.redact("env-key leaked")).toBe("[REDACTED] leaked");
    expect(sdkOptions).toEqual([
      {
        apiKey: "env-key",
        baseURL: "https://env.example.com"
      }
    ]);
  });

  it("uses DeepSeek defaults for model and base URL", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    const provider = createCliPrintProvider({
      flags: {},
      env: {
        DEEPSEEK_API_KEY: "env-key"
      },
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(provider.model).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(provider.apiClient.baseURL).toBe(DEFAULT_DEEPSEEK_BASE_URL);
    expect(sdkOptions).toEqual([
      {
        apiKey: "env-key",
        baseURL: DEFAULT_DEEPSEEK_BASE_URL
      }
    ]);
  });

  it("exports the stable missing key message", () => {
    expect(MISSING_DEEPSEEK_API_KEY_MESSAGE).toBe(
      EXPECTED_MISSING_DEEPSEEK_API_KEY_MESSAGE
    );
  });

  it("throws the stable missing key error before creating a provider", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    expect(() =>
      createCliPrintProvider({
        flags: {},
        env: {
          DEEPSEEK_API_KEY: "   ",
          DEEPSEEK_BASE_URL: "https://env.example.com",
          DEEPSEEK_MODEL: "env-model"
        },
        createSdkClient(options) {
          sdkOptions.push(options);
          return emptyFakeSdkClient();
        }
      })
    ).toThrow(EXPECTED_MISSING_DEEPSEEK_API_KEY_MESSAGE);
    expect(sdkOptions).toEqual([]);
  });

  it("redacts the resolved key from provider construction failures", () => {
    expect.assertions(4);

    try {
      createCliPrintProvider({
        flags: {
          apiKey: "flag-secret"
        },
        env: {
          DEEPSEEK_API_KEY: "env-secret"
        },
        createSdkClient() {
          throw new Error(
            "failed with flag-secret while env-secret was also configured"
          );
        }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(CliProviderError);
      expect((error as CliProviderError).message).toContain("[REDACTED]");
      expect((error as CliProviderError).message).not.toContain("flag-secret");
      expect((error as CliProviderError).message).toContain("env-secret");
    }
  });

  it("does not expose test-only redaction helpers", () => {
    expect(Object.hasOwn(createCliPrintProvider, "redactApiKey")).toBe(false);
  });
});

describe("resolveCliProviderPreview", () => {
  it("reports flag sources without creating an SDK client", () => {
    const preview = resolveCliProviderPreview({
      flags: {
        apiKey: "flag-key",
        baseURL: "https://flag.example.com///",
        model: "flag-model"
      },
      env: {
        DEEPSEEK_API_KEY: "env-key",
        DEEPSEEK_BASE_URL: "https://env.example.com",
        DEEPSEEK_MODEL: "env-model"
      }
    });

    expect(preview).toEqual({
      provider: "deepseek",
      apiFormat: "openai-compatible",
      model: "flag-model",
      modelSource: "flag",
      baseURL: "https://flag.example.com",
      baseURLSource: "flag",
      apiKeySource: "flag",
      authStatus: "configured",
      apiClientValidation: {
        status: "ok",
        detail: ""
      }
    });
    expect(JSON.stringify(preview)).not.toContain("flag-key");
    expect(JSON.stringify(preview)).not.toContain("env-key");
  });

  it("reports environment sources", () => {
    const preview = resolveCliProviderPreview({
      flags: {},
      env: {
        DEEPSEEK_API_KEY: "env-key",
        DEEPSEEK_BASE_URL: "https://env.example.com///",
        DEEPSEEK_MODEL: "env-model"
      }
    });

    expect(preview).toEqual({
      provider: "deepseek",
      apiFormat: "openai-compatible",
      model: "env-model",
      modelSource: "env",
      baseURL: "https://env.example.com",
      baseURLSource: "env",
      apiKeySource: "env",
      authStatus: "configured",
      apiClientValidation: { status: "ok", detail: "" }
    });
    expect(JSON.stringify(preview)).not.toContain("env-key");
  });

  it("reports defaults and missing auth without exposing keys", () => {
    const preview = resolveCliProviderPreview({
      flags: {},
      env: {}
    });

    expect(preview).toEqual({
      provider: "deepseek",
      apiFormat: "openai-compatible",
      model: DEFAULT_DEEPSEEK_MODEL,
      modelSource: "default",
      baseURL: DEFAULT_DEEPSEEK_BASE_URL,
      baseURLSource: "default",
      apiKeySource: "missing",
      authStatus: "missing",
      apiClientValidation: {
        status: "error",
        detail: MISSING_DEEPSEEK_API_KEY_MESSAGE
      }
    });
  });
});
