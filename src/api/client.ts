import type { ConversationMessage } from "../messages/index.js";
import type { ToolApiSchema } from "../tools/index.js";
import type { ApiStreamEvent } from "./events.js";

export interface ApiMessageRequest {
  readonly model: string;
  readonly messages: readonly ConversationMessage[];
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly tools?: readonly ToolApiSchema[];
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent>;
}
