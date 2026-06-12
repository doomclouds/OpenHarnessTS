import type { ApiClient } from "../api/index.js";
import type { HookExecutor } from "../hooks/index.js";
import {
  createUserMessageFromText,
  isUserMessage,
  type ConversationMessage
} from "../messages/index.js";
import { PermissionChecker, type PermissionMode } from "../permissions/index.js";
import {
  buildSystemPrompt,
  type EnvironmentInfo
} from "../prompts/index.js";
import type { StreamEvent } from "../stream-events/index.js";
import {
  ToolRegistry,
  type ToolDefinition
} from "../tools/index.js";
import type { QueryContext } from "./context.js";
import { runQuery } from "./query.js";

export interface QueryEngineOptions {
  readonly apiClient: ApiClient;
  readonly cwd: string;
  readonly model: string;
  readonly tools?: readonly ToolDefinition[];
  readonly toolRegistry?: ToolRegistry;
  readonly permissionMode?: PermissionMode;
  readonly permissionChecker?: PermissionChecker;
  readonly hookExecutor?: HookExecutor;
  readonly systemPrompt?: string;
  readonly customSystemPrompt?: string;
  readonly environment?: EnvironmentInfo;
  readonly maxTokens?: number;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
  readonly toolMetadata?: Readonly<Record<string, unknown>>;
}

export class QueryEngine {
  private readonly apiClient: ApiClient;
  private readonly toolRegistry: ToolRegistry;
  private readonly permissionChecker: PermissionChecker;
  private readonly cwd: string;
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly maxTokens?: number;
  private readonly maxTurns?: number;
  private readonly signal?: AbortSignal;
  private readonly hookExecutor?: HookExecutor;
  private readonly toolMetadata?: Readonly<Record<string, unknown>>;
  private readonly messages: ConversationMessage[] = [];
  private activeTurn = false;

  public constructor(options: QueryEngineOptions) {
    assertRequiredObject(options, "QueryEngine options are required.");
    assertNonEmptyString(options.cwd, "QueryEngine cwd is required.");
    assertNonEmptyString(options.model, "QueryEngine model is required.");

    if (options.apiClient === undefined) {
      throw new Error("QueryEngine apiClient is required.");
    }

    this.apiClient = options.apiClient;
    this.toolRegistry = new ToolRegistry();
    this.permissionChecker = new PermissionChecker({
      mode: options.permissionMode ?? "default"
    });
    this.cwd = options.cwd;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt ?? buildSystemPrompt({ cwd: options.cwd });

    if (options.maxTokens !== undefined) {
      this.maxTokens = options.maxTokens;
    }
    if (options.maxTurns !== undefined) {
      this.maxTurns = options.maxTurns;
    }
    if (options.signal !== undefined) {
      this.signal = options.signal;
    }
  }

  public submitMessage(
    prompt: string | ConversationMessage
  ): AsyncIterable<StreamEvent> {
    const message =
      typeof prompt === "string" ? createUserMessageFromText(prompt) : prompt;

    if (!isUserMessage(message)) {
      throw new Error("QueryEngine.submitMessage only accepts user messages.");
    }

    if (this.activeTurn) {
      throw new Error("QueryEngine already has an active turn.");
    }

    this.messages.push(message);
    this.activeTurn = true;
    return this.runActiveTurn();
  }

  public getMessages(): readonly ConversationMessage[] {
    return [...this.messages];
  }

  public registerTool(tool: ToolDefinition): void {
    this.toolRegistry.register(tool);
  }

  public listTools(): readonly ToolDefinition[] {
    return this.toolRegistry.listTools();
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.toolRegistry.getTool(name);
  }

  private createContext(): QueryContext {
    return {
      apiClient: this.apiClient,
      toolRegistry: this.toolRegistry,
      permissionChecker: this.permissionChecker,
      cwd: this.cwd,
      model: this.model,
      systemPrompt: this.systemPrompt,
      ...(this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens }),
      ...(this.maxTurns === undefined ? {} : { maxTurns: this.maxTurns }),
      ...(this.signal === undefined ? {} : { signal: this.signal })
    };
  }

  private async *runActiveTurn(): AsyncIterable<StreamEvent> {
    try {
      yield* runQuery(this.createContext(), this.messages);
    } finally {
      this.activeTurn = false;
    }
  }
}

function assertRequiredObject(value: unknown, message: string): void {
  if (typeof value !== "object" || value === null) {
    throw new Error(message);
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}
