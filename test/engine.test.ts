import { describe, expect, it } from "vitest";
import {
  createAssistantMessage,
  createTextBlock,
  createUserMessageFromText,
  getMessageText,
  PermissionChecker,
  runQuery,
  ToolRegistry
} from "../src/index.js";
import type {
  ApiClient,
  ApiMessageRequest,
  ApiStreamEvent,
  ConversationMessage,
  StreamEvent
} from "../src/index.js";

class ScriptedApiClient implements ApiClient {
  public readonly requests: ApiMessageRequest[] = [];
  private readonly turns: readonly (readonly ApiStreamEvent[])[];

  public constructor(turns: readonly (readonly ApiStreamEvent[])[]) {
    this.turns = turns;
  }

  public async *streamMessage(
    request: ApiMessageRequest
  ): AsyncIterable<ApiStreamEvent> {
    this.requests.push({
      ...request,
      messages: [...request.messages],
      ...(request.tools === undefined ? {} : { tools: [...request.tools] })
    });

    const turn = this.turns[this.requests.length - 1];
    if (turn === undefined) {
      throw new Error(`No scripted turn ${this.requests.length}`);
    }

    for (const event of turn) {
      yield event;
    }
  }
}

async function collectPlainEvents(
  client: ApiClient,
  messages: ConversationMessage[]
): Promise<readonly StreamEvent[]> {
  const events: StreamEvent[] = [];

  for await (const event of runQuery(
    {
      apiClient: client,
      toolRegistry: new ToolRegistry(),
      permissionChecker: new PermissionChecker({ mode: "full_auto" }),
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      maxTokens: 128,
      maxTurns: 5
    },
    messages
  )) {
    events.push(event);
  }

  return events;
}

describe("runQuery plain text loop", () => {
  it("streams assistant text and stops after a final message without tool uses", async () => {
    const client = new ScriptedApiClient([
      [
        {
          type: "text_delta",
          text: "hel"
        },
        {
          type: "text_delta",
          text: "lo"
        },
        {
          type: "message_complete",
          message: createAssistantMessage([createTextBlock("hello")])
        }
      ]
    ]);
    const messages = [createUserMessageFromText("say hello")];

    const events = await collectPlainEvents(client, messages);

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      model: "mock-model",
      systemPrompt: "You are a test assistant.",
      maxTokens: 128
    });
    expect(client.requests[0]?.messages).toEqual([
      createUserMessageFromText("say hello")
    ]);
    expect(client.requests[0]?.tools).toEqual([]);
    expect(events.map((event) => event.type)).toEqual([
      "assistant_text_delta",
      "assistant_text_delta",
      "assistant_turn_complete"
    ]);
    expect(events[0]).toEqual({
      type: "assistant_text_delta",
      text: "hel"
    });
    expect(events[1]).toEqual({
      type: "assistant_text_delta",
      text: "lo"
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]?.role).toBe("assistant");
    expect(getMessageText(messages[1] as ConversationMessage)).toBe("hello");
  });

  it("converts provider retry events to status events before turn completion", async () => {
    const client = new ScriptedApiClient([
      [
        {
          type: "retry",
          message: "rate limited",
          attempt: 1,
          maxAttempts: 3,
          delaySeconds: 0.5
        },
        {
          type: "message_complete",
          message: createAssistantMessage([createTextBlock("ready")])
        }
      ]
    ]);
    const messages = [createUserMessageFromText("say ready")];

    const events = await collectPlainEvents(client, messages);

    expect(events.map((event) => event.type)).toEqual([
      "status",
      "assistant_turn_complete"
    ]);
    expect(events[0]).toEqual({
      type: "status",
      message: "rate limited"
    });
    expect(messages).toHaveLength(2);
    expect(getMessageText(messages[1] as ConversationMessage)).toBe("ready");
  });
});
