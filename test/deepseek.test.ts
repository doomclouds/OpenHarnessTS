import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeepSeekApiClientFromEnv,
  createDeepSeekQueryEngineFromEnv,
  createUserMessageFromText,
  DeepSeekApiClient,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  getMessageText,
  getToolUses,
  normalizeDeepSeekBaseURL,
  QueryEngine,
  type DeepSeekReasoningEffort,
  type DeepSeekSdkClient,
  type DeepSeekSdkOptions,
  type ToolApiSchema
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

function fakeStreamSdkClient(args: {
  readonly chunks: readonly unknown[];
  readonly requests?: unknown[];
}): DeepSeekSdkClient {
  return {
    chat: {
      completions: {
        async create(params) {
          args.requests?.push(params);

          return (async function* () {
            for (const chunk of args.chunks) {
              yield chunk;
            }
          })();
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
      thinking: { type: "enabled" },
      reasoningEffort: "high",
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(client.baseURL).toBe("https://override.example.com");
    expect(client.model).toBe("deepseek-option-model");
    expect(client.maxTokens).toBe(1024);
    expect(client.thinking).toEqual({ type: "enabled" });
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

  it("preserves enabled thinking and high reasoning effort", () => {
    const reasoningEffort: DeepSeekReasoningEffort = "high";

    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      thinking: { type: "enabled" },
      reasoningEffort,
      createSdkClient: emptyFakeSdkClient
    });

    expect(client.thinking).toEqual({ type: "enabled" });
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

  it("sends streaming request params to the SDK", async () => {
    const requests: unknown[] = [];
    const tools: ToolApiSchema[] = [
      {
        name: "lookup_fixture",
        description: "Look up a fixture value.",
        input_schema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"]
        }
      }
    ];
    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      model: "client-model",
      maxTokens: 512,
      thinking: { type: "disabled" },
      reasoningEffort: "high",
      toolChoice: "required",
      createSdkClient: () =>
        fakeStreamSdkClient({
          chunks: [],
          requests
        })
    });

    const events = [];
    for await (const event of client.streamMessage({
      model: "",
      messages: [createUserMessageFromText("hello")],
      systemPrompt: "You are concise.",
      maxTokens: 1024,
      tools
    })) {
      events.push(event);
    }

    expect(requests).toEqual([
      {
        model: "client-model",
        messages: [
          { role: "system", content: "You are concise." },
          { role: "user", content: "hello" }
        ],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: 1024,
        tools: [
          {
            type: "function",
            function: {
              name: "lookup_fixture",
              description: "Look up a fixture value.",
              parameters: tools[0]!.input_schema
            }
          }
        ],
        tool_choice: "required",
        reasoning_effort: "high",
        thinking: { type: "disabled" }
      }
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message_complete" });
  });

  it("omits required tool choice when thinking is enabled", async () => {
    const requests: unknown[] = [];
    const tools: ToolApiSchema[] = [
      {
        name: "lookup_fixture",
        description: "Look up a fixture value.",
        input_schema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"]
        }
      }
    ];
    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      thinking: { type: "enabled" },
      reasoningEffort: "high",
      toolChoice: "required",
      createSdkClient: () =>
        fakeStreamSdkClient({
          chunks: [],
          requests
        })
    });

    const events = [];
    for await (const event of client.streamMessage({
      model: "deepseek-test",
      messages: [createUserMessageFromText("use a tool")],
      tools
    })) {
      events.push(event);
    }

    expect(requests).toEqual([
      {
        model: "deepseek-test",
        messages: [{ role: "user", content: "use a tool" }],
        stream: true,
        stream_options: { include_usage: true },
        tools: [
          {
            type: "function",
            function: {
              name: "lookup_fixture",
              description: "Look up a fixture value.",
              parameters: tools[0]!.input_schema
            }
          }
        ],
        reasoning_effort: "high",
        thinking: { type: "enabled" }
      }
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message_complete" });
  });

  it("streams visible text deltas and captures reasoning and usage in the final message", async () => {
    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      createSdkClient: () =>
        fakeStreamSdkClient({
          chunks: [
            { choices: [{ delta: { content: "Hello" } }] },
            { choices: [{ delta: { reasoning_content: "hidden " } }] },
            { choices: [{ delta: { content: " world" } }] },
            { choices: [{ delta: { reasoning_content: "thought" } }] },
            { usage: { prompt_tokens: 7, completion_tokens: 11 } }
          ]
        })
    });

    const events = [];
    for await (const event of client.streamMessage({
      model: "deepseek-test",
      messages: [createUserMessageFromText("hello")]
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      {
        type: "message_complete",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
          reasoningContent: "hidden thought"
        },
        usage: { inputTokens: 7, outputTokens: 11 }
      }
    ]);
  });

  it("aggregates streamed tool call deltas by index into sorted final tool uses", async () => {
    const client = new DeepSeekApiClient({
      apiKey: "direct-key",
      createSdkClient: () =>
        fakeStreamSdkClient({
          chunks: [
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 1,
                        id: "call_b",
                        type: "function",
                        function: {
                          name: "bad_args",
                          arguments: "{\"bad\""
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_a",
                        type: "function",
                        function: {
                          name: "lookup_fixture",
                          arguments: "{\"key\":"
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: "\"openharness\"}"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          ]
        })
    });

    const events = [];
    for await (const event of client.streamMessage({
      model: "deepseek-test",
      messages: [createUserMessageFromText("use tools")]
    })) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "message_complete" });

    const complete = events[0]!;
    expect(complete.type).toBe("message_complete");
    if (complete.type !== "message_complete") {
      throw new Error("Expected a complete event.");
    }

    expect(getMessageText(complete.message)).toBe("");
    expect(getToolUses(complete.message)).toEqual([
      {
        type: "tool_use",
        id: "call_a",
        name: "lookup_fixture",
        input: { key: "openharness" }
      },
      {
        type: "tool_use",
        id: "call_b",
        name: "bad_args",
        input: {}
      }
    ]);
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

describe("DeepSeek QueryEngine factory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("creates a QueryEngine from DeepSeek env values without starting a request", () => {
    const sdkOptions: DeepSeekSdkOptions[] = [];

    vi.stubEnv("DEEPSEEK_API_KEY", "env-key");
    vi.stubEnv("DEEPSEEK_BASE_URL", "https://deepseek.example.com///");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-env-model");

    const engine = createDeepSeekQueryEngineFromEnv({
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      systemPrompt: "You are a test assistant.",
      createSdkClient(options) {
        sdkOptions.push(options);
        return emptyFakeSdkClient();
      }
    });

    expect(engine).toBeInstanceOf(QueryEngine);
    expect(sdkOptions).toEqual([
      {
        apiKey: "env-key",
        baseURL: "https://deepseek.example.com"
      }
    ]);
  });

  it("runs a no-network QueryEngine request through the DeepSeek factory", async () => {
    const requests: unknown[] = [];

    vi.stubEnv("DEEPSEEK_API_KEY", "env-key");
    vi.stubEnv("DEEPSEEK_MODEL", "deepseek-env-model");

    const engine = createDeepSeekQueryEngineFromEnv({
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      systemPrompt: "You are a test assistant.",
      createSdkClient: () =>
        fakeStreamSdkClient({
          requests,
          chunks: [
            { choices: [{ delta: { content: "Hi" } }] },
            { usage: { prompt_tokens: 3, completion_tokens: 5 } }
          ]
        })
    });

    const events = [];
    for await (const event of engine.submitMessage("hello")) {
      events.push(event);
    }

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      model: "deepseek-env-model",
      messages: [
        { role: "system", content: "You are a test assistant." },
        { role: "user", content: "hello" }
      ],
      stream: true,
      stream_options: { include_usage: true }
    });
    expect(events.map((event) => event.type)).toEqual([
      "assistant_text_delta",
      "assistant_turn_complete"
    ]);
    expect(engine.getMessages()).toHaveLength(2);
  });

  it("preserves the existing missing API key error", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    expect(() =>
      createDeepSeekQueryEngineFromEnv({
        cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
        systemPrompt: "You are a test assistant.",
        createSdkClient: emptyFakeSdkClient
      })
    ).toThrow("DEEPSEEK_API_KEY is required to create a DeepSeek API client.");
  });
});
