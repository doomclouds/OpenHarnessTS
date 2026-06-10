import { describe, expect, it } from "vitest";
import {
  createApiMessageCompleteEvent,
  createApiRetryEvent,
  createApiTextDeltaEvent,
  createAssistantMessage,
  createTextBlock,
  createUserMessageFromText
} from "../src/index.js";
import type {
  ApiClient,
  ApiMessageRequest,
  ApiStreamEvent
} from "../src/index.js";

describe("provider-neutral API events", () => {
  it("creates text delta, retry, and message completion events", () => {
    const assistant = createAssistantMessage([createTextBlock("done")]);

    expect(createApiTextDeltaEvent("hel")).toEqual({
      type: "text_delta",
      text: "hel"
    });
    expect(
      createApiRetryEvent({
        message: "rate limited",
        attempt: 1,
        maxAttempts: 3,
        delaySeconds: 0.5
      })
    ).toEqual({
      type: "retry",
      message: "rate limited",
      attempt: 1,
      maxAttempts: 3,
      delaySeconds: 0.5
    });
    expect(createApiMessageCompleteEvent({ message: assistant })).toEqual({
      type: "message_complete",
      message: assistant
    });
  });
});

describe("provider-neutral API client contract", () => {
  it("provides an API client contract module", async () => {
    await expect(import("../src/api/client.js")).resolves.toBeDefined();
  });

  it("lets a scripted client capture model, messages, system prompt, max tokens, and tools", async () => {
    class CaptureClient implements ApiClient {
      public requests: ApiMessageRequest[] = [];

      public async *streamMessage(
        request: ApiMessageRequest
      ): AsyncIterable<ApiStreamEvent> {
        this.requests.push(request);
        yield createApiTextDeltaEvent("ok");
      }
    }

    const client = new CaptureClient();
    const messages = [createUserMessageFromText("hello")];
    const request: ApiMessageRequest = {
      model: "mock-model",
      messages,
      systemPrompt: "system",
      maxTokens: 64,
      tools: [
        {
          name: "echo",
          description: "Echoes input.",
          input_schema: {
            type: "object",
            properties: {}
          }
        }
      ]
    };
    const events: ApiStreamEvent[] = [];

    for await (const event of client.streamMessage(request)) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "text_delta", text: "ok" }]);
    expect(client.requests).toEqual([request]);
  });
});
