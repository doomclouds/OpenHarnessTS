import { resolveProjectPaths } from "../config/index.js";
import type { PermissionMode } from "../permissions/index.js";
import { buildRuntimePrompt } from "../prompts/index.js";
import {
  createDefaultProjectToolRegistry,
  type ToolApiSchema
} from "../tools/index.js";
import type { CliOutputFormat } from "./parser.js";
import {
  MISSING_DEEPSEEK_API_KEY_MESSAGE,
  resolveCliProviderPreview
} from "./provider.js";

export interface BuildCliDryRunPreviewOptions {
  readonly prompt?: string;
  readonly cwd: string;
  readonly outputFormat: CliOutputFormat;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
  readonly env?: NodeJS.ProcessEnv;
  readonly homeDir?: string;
}

export interface CliDryRunInstructionSource {
  readonly path: string;
  readonly kind: string;
  readonly order: number;
  readonly originalCharCount: number;
  readonly loadedCharCount: number;
  readonly truncated: boolean;
}

export interface CliDryRunToolPreview {
  readonly name: string;
  readonly description: string;
  readonly requiredArgs: readonly string[];
  readonly optionalArgs: readonly string[];
}

export type CliDryRunEntrypoint =
  | {
      readonly kind: "interactive_session";
      readonly detail: string;
    }
  | {
      readonly kind: "model_prompt";
      readonly detail: string;
    };

export interface CliDryRunPreview {
  readonly type: "dry_run_preview";
  readonly mode: "dry-run";
  readonly cwd: string;
  readonly prompt?: string;
  readonly promptPreview: string;
  readonly entrypoint: CliDryRunEntrypoint;
  readonly settings: {
    readonly provider: "deepseek";
    readonly apiFormat: "openai-compatible";
    readonly providerSource: "default";
    readonly model: string;
    readonly modelSource: "flag" | "env" | "default";
    readonly baseURL: string;
    readonly baseURLSource: "flag" | "env" | "default";
    readonly apiKeySource: "flag" | "env" | "missing";
    readonly permissionMode: PermissionMode;
    readonly maxTurns?: number;
    readonly outputFormat: CliOutputFormat;
  };
  readonly paths: {
    readonly projectConfigDir: string;
    readonly sessionDir: string;
  };
  readonly validation: {
    readonly authStatus: "configured" | "missing";
    readonly apiClient: {
      readonly status: "ok" | "error";
      readonly detail: string;
    };
    readonly systemPromptChars: number;
  };
  readonly discovery: {
    readonly instructionSources: readonly CliDryRunInstructionSource[];
    readonly tools: readonly CliDryRunToolPreview[];
  };
  readonly readiness: {
    readonly level: "ready" | "blocked";
    readonly reasons: readonly string[];
    readonly nextActions: readonly string[];
  };
  readonly systemPromptPreview: string;
}

export function buildCliDryRunPreview(
  options: BuildCliDryRunPreviewOptions
): CliDryRunPreview {
  const prompt = normalizePrompt(options.prompt);
  const permissionMode = options.permissionMode ?? "default";
  const paths = resolveProjectPaths(options.cwd, {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir })
  });
  const provider = resolveCliProviderPreview({
    flags: {
      ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
      ...(options.baseURL === undefined ? {} : { baseURL: options.baseURL }),
      ...(options.model === undefined ? {} : { model: options.model })
    },
    ...(options.env === undefined ? {} : { env: options.env })
  });
  const runtimePrompt = buildRuntimePrompt({
    cwd: paths.cwd,
    permissionMode,
    instructionOptions: {
      stopAt: paths.cwd
    }
  });
  const tools = summarizeTools(
    createDefaultProjectToolRegistry().toApiSchema()
  );
  const entrypoint = createEntrypoint(prompt);
  const readiness = evaluateReadiness({
    entrypoint,
    authStatus: provider.authStatus
  });

  return {
    type: "dry_run_preview",
    mode: "dry-run",
    cwd: paths.cwd,
    ...(prompt === undefined ? {} : { prompt }),
    promptPreview: safeShort(prompt ?? "", 220),
    entrypoint,
    settings: {
      provider: provider.provider,
      apiFormat: provider.apiFormat,
      providerSource: "default",
      model: provider.model,
      modelSource: provider.modelSource,
      baseURL: provider.baseURL,
      baseURLSource: provider.baseURLSource,
      apiKeySource: provider.apiKeySource,
      permissionMode,
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      outputFormat: options.outputFormat
    },
    paths: {
      projectConfigDir: paths.projectConfigDir,
      sessionDir: paths.sessionDir
    },
    validation: {
      authStatus: provider.authStatus,
      apiClient: provider.apiClientValidation,
      systemPromptChars: Array.from(runtimePrompt.prompt).length
    },
    discovery: {
      instructionSources: (runtimePrompt.projectInstructions?.files ?? []).map(
        (file) => ({
          path: file.path,
          kind: file.kind,
          order: file.order,
          originalCharCount: file.originalCharCount,
          loadedCharCount: file.loadedCharCount,
          truncated: file.truncated
        })
      ),
      tools
    },
    readiness,
    systemPromptPreview: createSystemPromptPreview(runtimePrompt.prompt)
  };
}

function normalizePrompt(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function createEntrypoint(prompt: string | undefined): CliDryRunEntrypoint {
  if (prompt === undefined) {
    return {
      kind: "interactive_session",
      detail:
        "OpenHarness would start and wait for user input. No model or tool call happens until a prompt is submitted."
    };
  }

  return {
    kind: "model_prompt",
    detail:
      "The first live step would be a model request. Exact tool calls and parameters are decided by the model at runtime."
  };
}

function evaluateReadiness(args: {
  readonly entrypoint: CliDryRunEntrypoint;
  readonly authStatus: "configured" | "missing";
}): CliDryRunPreview["readiness"] {
  if (args.entrypoint.kind === "model_prompt" && args.authStatus === "missing") {
    return {
      level: "blocked",
      reasons: [
        `${MISSING_DEEPSEEK_API_KEY_MESSAGE} Live model execution would fail.`
      ],
      nextActions: [
        "Set DEEPSEEK_API_KEY or pass --api-key before running without --dry-run."
      ]
    };
  }

  if (args.entrypoint.kind === "interactive_session") {
    return {
      level: "ready",
      reasons: ["Resolved static CLI setup for an interactive session preview."],
      nextActions: [
        "Provide --print for a single prompt preview, or run OpenHarness normally."
      ]
    };
  }

  return {
    level: "ready",
    reasons: ["Resolved configuration and static discovery checks look usable."],
    nextActions: ["Run the prompt again without --dry-run to execute it."]
  };
}

function summarizeTools(
  schemas: readonly ToolApiSchema[]
): readonly CliDryRunToolPreview[] {
  return schemas.map((schema) => {
    const inputSchema = schema.input_schema;
    const properties = isRecord(inputSchema["properties"])
      ? inputSchema["properties"]
      : {};
    const requiredArgs = Array.isArray(inputSchema["required"])
      ? inputSchema["required"].filter(
          (item): item is string => typeof item === "string"
        )
      : [];
    const optionalArgs = Object.keys(properties).filter(
      (key) => !requiredArgs.includes(key)
    );

    return {
      name: schema.name,
      description: schema.description,
      requiredArgs,
      optionalArgs
    };
  });
}

function safeShort(value: string, limit: number): string {
  const characters = Array.from(value);

  return characters.length > limit
    ? `${characters.slice(0, limit).join("")}...`
    : value;
}

function createSystemPromptPreview(value: string): string {
  return `# OpenHarness\n\n${safeMiddle(value, 2000)}`;
}

function safeMiddle(value: string, limit: number): string {
  const characters = Array.from(value);

  if (characters.length <= limit) {
    return value;
  }

  const marker = "\n...\n";
  const visibleLimit = Math.max(0, limit - Array.from(marker).length);
  const headLength = Math.ceil(visibleLimit / 2);
  const tailLength = Math.floor(visibleLimit / 2);

  return `${characters.slice(0, headLength).join("")}${marker}${characters
    .slice(characters.length - tailLength)
    .join("")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
