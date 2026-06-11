import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDeepSeekApiClientFromEnv,
  createToolResult,
  createUserMessageFromText,
  getMessageText,
  PermissionChecker,
  runQuery,
  ToolRegistry,
  type ConversationMessage,
  type StreamEvent,
  type ToolDefinition
} from "../src/index.js";

function requireDeepSeekApiKey(): string {
  const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();

  if (apiKey === undefined || apiKey.length === 0) {
    throw new Error(
      "DEEPSEEK_API_KEY is required for npm run test:deepseek."
    );
  }

  return apiKey;
}

function getDeepSeekModel(): string {
  return process.env["DEEPSEEK_MODEL"]?.trim() || "deepseek-v4-flash";
}

async function collectRunQueryEvents(args: {
  readonly client: ReturnType<typeof createDeepSeekApiClientFromEnv>;
  readonly messages: ConversationMessage[];
  readonly toolRegistry: ToolRegistry;
  readonly maxTokens: number;
  readonly maxTurns?: number;
}): Promise<readonly StreamEvent[]> {
  const events: StreamEvent[] = [];

  for await (const event of runQuery(
    {
      apiClient: args.client,
      toolRegistry: args.toolRegistry,
      permissionChecker: new PermissionChecker({ mode: "full_auto" }),
      cwd: process.cwd(),
      model: getDeepSeekModel(),
      systemPrompt:
        "You are a concise integration test assistant. Follow the user request exactly.",
      maxTokens: args.maxTokens,
      ...(args.maxTurns !== undefined ? { maxTurns: args.maxTurns } : {})
    },
    args.messages
  )) {
    events.push(event);
  }

  return events;
}

function getAssistantTurnCompleteEvents(
  events: readonly StreamEvent[]
): readonly Extract<StreamEvent, { readonly type: "assistant_turn_complete" }>[] {
  return events.filter(
    (
      event
    ): event is Extract<
      StreamEvent,
      { readonly type: "assistant_turn_complete" }
    > => event.type === "assistant_turn_complete"
  );
}

function getFinalAssistantTurnCompleteEvent(
  events: readonly StreamEvent[]
): Extract<StreamEvent, { readonly type: "assistant_turn_complete" }> {
  const completeEvents = getAssistantTurnCompleteEvents(events);
  const finalEvent = completeEvents.at(-1);

  if (finalEvent === undefined) {
    throw new Error("Expected at least one assistant_turn_complete event.");
  }

  return finalEvent;
}

function expectNoErrorEvents(events: readonly StreamEvent[]): void {
  const errorEvents = events.filter((event) => event.type === "error");
  if (errorEvents.length === 0) {
    return;
  }

  const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();
  const errorSummary = errorEvents
    .map((event) =>
      apiKey !== undefined && apiKey.length > 0
        ? event.message.replaceAll(apiKey, "[REDACTED]")
        : event.message
    )
    .join("\n");

  throw new Error(`Unexpected error events:\n${errorSummary}`);
}

describe("DeepSeek real API integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails clearly when the required DeepSeek API key is missing", () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "   ");

    expect(() => requireDeepSeekApiKey()).toThrow(
      "DEEPSEEK_API_KEY is required for npm run test:deepseek."
    );
  });

  it(
    "streams real DeepSeek text through runQuery",
    { timeout: 60_000 },
    async () => {
      requireDeepSeekApiKey();

      const client = createDeepSeekApiClientFromEnv({
        thinking: { type: "disabled" },
        maxTokens: 64
      });
      const messages = [
        createUserMessageFromText("Reply exactly: openharness-deepseek-ok")
      ];
      const events = await collectRunQueryEvents({
        client,
        messages,
        toolRegistry: new ToolRegistry(),
        maxTokens: 64
      });

      expectNoErrorEvents(events);
      expect(
        events.some((event) => event.type === "assistant_turn_complete")
      ).toBe(true);
      expect(events.some((event) => event.type === "assistant_text_delta")).toBe(
        true
      );
      expect(
        getMessageText(getFinalAssistantTurnCompleteEvent(events).message)
      ).toContain("openharness-deepseek-ok");
    }
  );

  it(
    "runs a real DeepSeek thinking tool-call loop through runQuery",
    { timeout: 90_000 },
    async () => {
      requireDeepSeekApiKey();

      let toolCallCount = 0;
      const registry = new ToolRegistry();
      const tool: ToolDefinition = {
        name: "get_test_value",
        description: "Return a deterministic integration test value by key.",
        inputSchema: {
          type: "object",
          properties: {
            key: {
              type: "string"
            }
          },
          required: ["key"],
          additionalProperties: false
        },
        validateInput(input) {
          if (
            typeof input === "object" &&
            input !== null &&
            typeof (input as { readonly key?: unknown }).key === "string"
          ) {
            return {
              ok: true,
              value: {
                key: (input as { readonly key: string }).key
              }
            };
          }

          return {
            ok: false,
            error: "key must be a string"
          };
        },
        isReadOnly: () => true,
        execute(input) {
          const key = (input as { readonly key: string }).key;

          toolCallCount += 1;
          return createToolResult({
            output: `deepseek-tool-ok:${key}`
          });
        }
      };
      registry.register(tool);

      const client = createDeepSeekApiClientFromEnv({
        thinking: { type: "enabled" },
        reasoningEffort: "high",
        toolChoice: "required",
        maxTokens: 256
      });
      const messages = [
        createUserMessageFromText(
          "Use the get_test_value tool with key openharness, then answer with the returned value only."
        )
      ];
      const events = await collectRunQueryEvents({
        client,
        messages,
        toolRegistry: registry,
        maxTokens: 256,
        maxTurns: 4
      });

      expectNoErrorEvents(events);
      expect(toolCallCount).toBeGreaterThan(0);
      expect(events.some((event) => event.type === "tool_execution_started")).toBe(
        true
      );
      expect(
        events.some((event) => event.type === "tool_execution_completed")
      ).toBe(true);
      expect(
        getMessageText(getFinalAssistantTurnCompleteEvent(events).message)
      ).toContain("deepseek-tool-ok:openharness");
    }
  );
});
