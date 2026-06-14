import { describe, expect, it } from "vitest";
import {
  MISSING_DEEPSEEK_API_KEY_MESSAGE,
  createCliPrintProvider
} from "../src/cli/index.js";
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
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
    ).toThrow(MISSING_DEEPSEEK_API_KEY_MESSAGE);
    expect(sdkOptions).toEqual([]);
  });

  it("does not redact text when no key was provided", () => {
    const redacted = createCliPrintProvider.redactApiKey(undefined, "safe text");

    expect(redacted).toBe("safe text");
  });
});
