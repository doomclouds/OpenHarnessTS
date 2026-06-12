import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PermissionMode } from "../permissions/index.js";
import {
  collectEnvironmentInfo,
  type EnvironmentInfo
} from "./environment.js";
import {
  loadProjectInstructions,
  type LoadProjectInstructionsOptions,
  type ProjectInstructions
} from "./project-instructions.js";
import { buildSystemPrompt } from "./system-prompt.js";

export interface RuntimePromptResult {
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly permissionMode: PermissionMode;
  readonly environment: EnvironmentInfo;
  readonly projectInstructions?: ProjectInstructions;
}

export interface BuildRuntimePromptOptions {
  readonly cwd: string | URL;
  readonly permissionMode?: PermissionMode;
  readonly systemPrompt?: string;
  readonly customSystemPrompt?: string;
  readonly environment?: EnvironmentInfo;
  readonly projectInstructions?: ProjectInstructions;
  readonly loadProjectInstructions?: boolean;
  readonly instructionOptions?: LoadProjectInstructionsOptions;
}

export function buildRuntimePrompt(
  options: BuildRuntimePromptOptions
): RuntimePromptResult {
  assertRequiredObject(options, "BuildRuntimePrompt options are required.");
  if (
    options.systemPrompt !== undefined &&
    options.customSystemPrompt !== undefined
  ) {
    throw new Error(
      "BuildRuntimePrompt options cannot include both systemPrompt and customSystemPrompt."
    );
  }

  const cwd = resolvePathInput(options.cwd, "cwd");
  const permissionMode = options.permissionMode ?? "default";
  const environment = options.environment ?? collectEnvironmentInfo({ cwd });

  if (options.systemPrompt !== undefined) {
    const projectInstructions = options.projectInstructions;

    return {
      prompt: options.systemPrompt,
      systemPrompt: options.systemPrompt,
      permissionMode,
      environment,
      ...(projectInstructions === undefined ? {} : { projectInstructions })
    };
  }

  const projectInstructions =
    options.projectInstructions ??
    (options.loadProjectInstructions === false
      ? undefined
      : loadProjectInstructions(cwd, options.instructionOptions));

  const systemPrompt = buildSystemPrompt({
    ...(options.customSystemPrompt === undefined
      ? {}
      : { customPrompt: options.customSystemPrompt }),
    environment,
    cwd
  });
  const prompt = [
    systemPrompt,
    formatPermissionModeSection(permissionMode),
    projectInstructions?.section
  ]
    .filter(
      (section): section is string =>
        section !== undefined && section.trim().length > 0
    )
    .join("\n\n");

  return {
    prompt,
    systemPrompt,
    permissionMode,
    environment,
    ...(projectInstructions === undefined ? {} : { projectInstructions })
  };
}

function formatPermissionModeSection(mode: PermissionMode): string {
  switch (mode) {
    case "default":
      return `# Permission Mode
- Current mode: default
- Read-only tools may run automatically.
- Mutating tools require confirmation or may be blocked by the runtime.`;
    case "plan":
      return `# Permission Mode
- Current mode: plan
- Read-only tools may run automatically.
- Mutating tools are blocked by the runtime.`;
    case "full_auto":
      return `# Permission Mode
- Current mode: full_auto
- Read-only tools may run automatically.
- Mutating tools may run automatically unless blocked by safety rules.`;
  }
}

function resolvePathInput(value: string | URL, label: "cwd"): string {
  if (value instanceof URL) {
    if (value.protocol !== "file:") {
      throw new Error(`${label} URL must use the file: protocol.`);
    }

    return resolve(fileURLToPath(value));
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty path.`);
  }

  return resolve(value);
}

function assertRequiredObject(value: unknown, message: string): void {
  if (typeof value !== "object" || value === null) {
    throw new Error(message);
  }
}
