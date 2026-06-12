import { describe, expect, it } from "vitest";
import {
  createAssistantMessage,
  createTextBlock,
  createUserMessageFromText,
  getMessageText,
  QueryEngine,
  type ApiClient,
  type ApiMessageRequest,
  type ApiStreamEvent,
  type ConversationMessage,
  type StreamEvent
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

function textComplete(text: string): ApiStreamEvent {
  return {
    type: "message_complete",
    message: createAssistantMessage([createTextBlock(text)])
  };
}

async function collectEvents(
  iterable: AsyncIterable<StreamEvent>
): Promise<readonly StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("QueryEngine plain text facade", () => {
  it("submits a string prompt, streams events, and owns message history", async () => {
    const client = new ScriptedApiClient([
      [
        { type: "text_delta", text: "hel" },
        { type: "text_delta", text: "lo" },
        textComplete("hello")
      ]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    const events = await collectEvents(engine.submitMessage("say hello"));

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]).toMatchObject({
      model: "mock-model",
      systemPrompt: "You are a test assistant."
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
    expect(engine.getMessages()).toHaveLength(2);
    expect(engine.getMessages()[0]).toEqual(
      createUserMessageFromText("say hello")
    );
    expect(getMessageText(engine.getMessages()[1]!)).toBe("hello");
  });

  it("accepts a user ConversationMessage", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    await collectEvents(
      engine.submitMessage(createUserMessageFromText("message object"))
    );

    expect(client.requests[0]?.messages).toEqual([
      createUserMessageFromText("message object")
    ]);
  });

  it("rejects assistant messages before mutating history", async () => {
    const client = new ScriptedApiClient([[textComplete("unused")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    expect(() =>
      engine.submitMessage(createAssistantMessage([createTextBlock("bad")]))
    ).toThrow("QueryEngine.submitMessage only accepts user messages.");
    expect(engine.getMessages()).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it("returns a message array copy from getMessages", async () => {
    const client = new ScriptedApiClient([[textComplete("done")]]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    await collectEvents(engine.submitMessage("copy"));

    const snapshot = engine.getMessages() as ConversationMessage[];
    snapshot.pop();

    expect(snapshot).toHaveLength(1);
    expect(engine.getMessages()).toHaveLength(2);
  });

  it("rejects overlapping turns before the active turn is consumed", async () => {
    const client = new ScriptedApiClient([
      [textComplete("first done")],
      [textComplete("second done")]
    ]);
    const engine = new QueryEngine({
      apiClient: client,
      cwd: "C:/WorkSpace/ResearchProjects/OpenHarnessTS",
      model: "mock-model",
      systemPrompt: "You are a test assistant."
    });

    const first = engine.submitMessage("first");

    expect(() => engine.submitMessage("second")).toThrow(
      "QueryEngine already has an active turn."
    );
    expect(engine.getMessages()).toEqual([createUserMessageFromText("first")]);
    expect(client.requests).toEqual([]);

    await collectEvents(first);

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]?.messages).toEqual([
      createUserMessageFromText("first")
    ]);

    const secondEvents = await collectEvents(engine.submitMessage("second"));

    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]?.messages).toEqual([
      createUserMessageFromText("first"),
      createAssistantMessage([createTextBlock("first done")]),
      createUserMessageFromText("second")
    ]);
    expect(secondEvents.map((event) => event.type)).toEqual([
      "assistant_turn_complete"
    ]);
    expect(getMessageText(engine.getMessages().at(-1)!)).toBe("second done");
  });
});
