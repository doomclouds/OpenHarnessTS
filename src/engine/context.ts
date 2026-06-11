import type { ApiClient } from "../api/index.js";
import type { HookExecutor } from "../hooks/index.js";
import type { PermissionChecker } from "../permissions/index.js";
import type { ToolRegistry } from "../tools/index.js";

export interface QueryContext {
  readonly apiClient: ApiClient;
  readonly toolRegistry: ToolRegistry;
  readonly permissionChecker: PermissionChecker;
  readonly cwd: string;
  readonly model: string;
  readonly systemPrompt?: string;
  readonly maxTokens?: number;
  readonly maxTurns?: number;
  readonly signal?: AbortSignal;
  readonly hookExecutor?: HookExecutor;
  readonly toolMetadata?: Readonly<Record<string, unknown>>;
}
