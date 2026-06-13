import type { ApiClient } from "../api/index.js";
import type { ProjectPaths, ResolveProjectPathsOptions } from "../config/index.js";
import type { QueryEngine } from "../engine/index.js";
import type { HookExecutor } from "../hooks/index.js";
import type { PermissionChecker, PermissionMode } from "../permissions/index.js";
import type { RuntimePromptResult } from "../prompts/index.js";
import type { SessionBackend } from "../sessions/index.js";
import type { ToolDefinition, ToolRegistry } from "../tools/index.js";

export interface ProjectRuntimeBundle {
  readonly cwd: string;
  readonly paths: ProjectPaths;
  readonly sessionId: string;
  readonly prompt: RuntimePromptResult;
  readonly toolRegistry: ToolRegistry;
  readonly permissionChecker: PermissionChecker;
  readonly hookExecutor: HookExecutor;
  readonly sessionBackend: SessionBackend;
  readonly engine: QueryEngine;
}

export interface BuildProjectRuntimeOptions extends ResolveProjectPathsOptions {
  readonly cwd?: string | URL;
  readonly apiClient: ApiClient;
  readonly model: string;
  readonly sessionId?: string;
  readonly tools?: readonly ToolDefinition[];
  readonly toolRegistry?: ToolRegistry;
  readonly includeDefaultProjectTools?: boolean;
  readonly permissionMode?: PermissionMode;
  readonly permissionChecker?: PermissionChecker;
  readonly hookExecutor?: HookExecutor;
  readonly sessionBackend?: SessionBackend;
  readonly systemPrompt?: string;
  readonly customSystemPrompt?: string;
  readonly maxTokens?: number;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
}
