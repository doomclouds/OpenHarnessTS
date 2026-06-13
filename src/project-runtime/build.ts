import { resolveProjectPaths } from "../config/index.js";
import { QueryEngine } from "../engine/index.js";
import { InMemoryHookExecutor } from "../hooks/index.js";
import { PermissionChecker } from "../permissions/index.js";
import { buildRuntimePrompt } from "../prompts/index.js";
import {
  createSessionId,
  FileSessionBackend,
  validateSessionId,
  type SessionStorageOptions
} from "../sessions/index.js";
import {
  registerDefaultProjectTools,
  ToolRegistry
} from "../tools/index.js";
import type {
  BuildProjectRuntimeOptions,
  ProjectRuntimeBundle
} from "./bundle.js";

export function buildProjectRuntime(
  options: BuildProjectRuntimeOptions
): ProjectRuntimeBundle {
  assertRequiredObject(options, "BuildProjectRuntime options are required.");

  if (options.apiClient === undefined) {
    throw new Error("buildProjectRuntime apiClient is required.");
  }
  assertNonEmptyString(options.model, "buildProjectRuntime model is required.");

  if (options.toolRegistry !== undefined && options.tools !== undefined) {
    throw new Error(
      "BuildProjectRuntime options cannot include both toolRegistry and tools."
    );
  }

  const pathOptions = buildPathOptions(options);
  const paths = resolveProjectPaths(options.cwd ?? process.cwd(), pathOptions);
  const cwd = paths.cwd;
  const permissionMode = options.permissionMode ?? "default";
  const sessionId =
    options.sessionId === undefined
      ? createSessionId()
      : validateSessionId(options.sessionId);
  const prompt = buildRuntimePrompt({
    cwd,
    permissionMode,
    ...(options.systemPrompt === undefined
      ? {}
      : { systemPrompt: options.systemPrompt }),
    ...(options.customSystemPrompt === undefined
      ? {}
      : { customSystemPrompt: options.customSystemPrompt })
  });
  const toolRegistry =
    options.toolRegistry ?? buildToolRegistry(options);
  const permissionChecker =
    options.permissionChecker ?? new PermissionChecker({ mode: permissionMode });
  const hookExecutor = options.hookExecutor ?? new InMemoryHookExecutor();
  const sessionBackend =
    options.sessionBackend ?? new FileSessionBackend(pathOptions);
  const toolMetadata = {
    sessionId,
    projectCwd: cwd
  };
  const engine = new QueryEngine({
    apiClient: options.apiClient,
    cwd,
    model: options.model,
    toolRegistry,
    permissionChecker,
    hookExecutor,
    systemPrompt: prompt.prompt,
    toolMetadata,
    ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
    ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
    ...(options.signal === undefined ? {} : { signal: options.signal })
  });

  return {
    cwd,
    paths,
    sessionId,
    prompt,
    toolRegistry,
    permissionChecker,
    hookExecutor,
    sessionBackend,
    engine
  };
}

function buildToolRegistry(options: BuildProjectRuntimeOptions): ToolRegistry {
  const registry = new ToolRegistry();

  if (options.includeDefaultProjectTools !== false) {
    registerDefaultProjectTools(registry);
  }

  for (const tool of options.tools ?? []) {
    registry.register(tool);
  }

  return registry;
}

function buildPathOptions(
  options: BuildProjectRuntimeOptions
): SessionStorageOptions {
  return {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir })
  };
}

function assertRequiredObject(value: unknown, message: string): void {
  if (typeof value !== "object" || value === null) {
    throw new Error(message);
  }
}

function assertNonEmptyString(
  value: unknown,
  message: string
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}
