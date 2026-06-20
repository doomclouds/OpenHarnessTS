import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { PermissionMode } from "../permissions/index.js";

export interface ParseCliArgsOptions {
  readonly cwd?: string;
  readonly version?: string;
}

export type CliParseErrorCode =
  | "missing_mode"
  | "missing_print_prompt"
  | "invalid_cwd"
  | "unknown_option"
  | "invalid_option_value";

export interface CliParseError {
  readonly code: CliParseErrorCode;
  readonly message: string;
  readonly option?: string;
  readonly value?: string;
}

export type CliOutputFormat = "text" | "json" | "stream-json";
export type CliColorMode = "full" | "none";

export interface CliPrintOptions {
  readonly prompt: string;
  readonly cwd: string;
  readonly outputFormat: CliOutputFormat;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
}

export interface CliDryRunOptions {
  readonly prompt?: string;
  readonly cwd: string;
  readonly outputFormat: CliOutputFormat;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
}

export interface CliTuiOptions {
  readonly cwd: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly maxTurns?: number;
  readonly permissionMode?: PermissionMode;
  readonly colorMode?: CliColorMode;
}

export type CliParseResult =
  | { readonly type: "help" }
  | { readonly type: "version"; readonly version: string }
  | { readonly type: "print"; readonly options: CliPrintOptions }
  | { readonly type: "dry_run"; readonly options: CliDryRunOptions }
  | { readonly type: "tui"; readonly options: CliTuiOptions }
  | { readonly type: "error"; readonly error: CliParseError };

function missingPrintPrompt(): CliParseResult {
  return {
    type: "error",
    error: {
      code: "missing_print_prompt",
      option: "--print",
      message: "--print requires a non-empty prompt value."
    }
  };
}

function invalidCwd(value: string): CliParseResult {
  if (value.length === 0) {
    return {
      type: "error",
      error: {
        code: "invalid_cwd",
        option: "--cwd",
        value,
        message: "--cwd requires an existing directory path."
      }
    };
  }

  return {
    type: "error",
    error: {
      code: "invalid_cwd",
      option: "--cwd",
      value,
      message: `Invalid cwd: ${value}. It must be an existing directory.`
    }
  };
}

function unknownOption(option: string): CliParseResult {
  return {
    type: "error",
    error: {
      code: "unknown_option",
      option,
      message: `Unknown option: ${option}`
    }
  };
}

function invalidOptionValue(
  option: string,
  value: string,
  message: string
): CliParseResult {
  return {
    type: "error",
    error: {
      code: "invalid_option_value",
      option,
      value,
      message
    }
  };
}

function readNonEmptyOptionValue(
  args: readonly string[],
  index: number,
  option: string
): string | CliParseResult {
  const value = args[index + 1];

  if (value === undefined || value.startsWith("--") || value.trim().length === 0) {
    return invalidOptionValue(option, "", `${option} requires a non-empty value.`);
  }

  return value.trim();
}

function parsePositiveIntegerOption(
  value: string,
  option: string
): number | CliParseResult {
  const parsed = Number(value);

  if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(parsed)) {
    return invalidOptionValue(
      option,
      value,
      `${option} requires a positive integer value.`
    );
  }

  return parsed;
}

function parsePermissionMode(value: string): PermissionMode | CliParseResult {
  if (value === "default" || value === "plan" || value === "full_auto") {
    return value;
  }

  return invalidOptionValue(
    "--permission-mode",
    value,
    "--permission-mode must be one of: default, plan, full_auto."
  );
}

function parseOutputFormat(value: string): CliOutputFormat | CliParseResult {
  if (value === "text" || value === "json" || value === "stream-json") {
    return value;
  }

  return invalidOptionValue(
    "--output-format",
    value,
    "--output-format must be one of: text, json, stream-json."
  );
}

function isExistingDirectory(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function parseCliArgs(
  args: readonly string[],
  options: ParseCliArgsOptions = {}
): CliParseResult {
  let cwd = resolve(options.cwd ?? process.cwd());
  let printPrompt: string | undefined;
  let model: string | undefined;
  let apiKey: string | undefined;
  let baseURL: string | undefined;
  let maxTurns: number | undefined;
  let permissionMode: PermissionMode | undefined;
  let outputFormat: CliOutputFormat = "text";
  let dryRun = false;
  let tui = false;
  let colorMode: CliColorMode | undefined;
  let incompatibleWithTui: string | undefined;

  if (args.length === 0) {
    return {
      type: "error",
      error: {
        code: "missing_mode",
        message:
          "No command mode selected. Use --help, --version, or --print <prompt>."
      }
    };
  }

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === undefined) {
      continue;
    }

    if (token === "--help") {
      return { type: "help" };
    }

    if (token === "--version") {
      return { type: "version", version: options.version ?? "0.0.0" };
    }

    if (token === "--cwd") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return invalidCwd("");
      }

      if (!isExistingDirectory(value)) {
        return invalidCwd(value);
      }

      cwd = resolve(value);
      index += 1;
      continue;
    }

    if (token === "--print") {
      if (tui) {
        incompatibleWithTui = "--print";
        const value = args[index + 1];
        if (value !== undefined && !value.startsWith("--")) {
          index += 1;
        }
        continue;
      }

      const value = args[index + 1];

      if (value === undefined || value.startsWith("--")) {
        return missingPrintPrompt();
      }

      const prompt = value.trim();

      if (prompt.length === 0) {
        return missingPrintPrompt();
      }

      printPrompt = prompt;
      incompatibleWithTui = "--print";
      index += 1;
      continue;
    }

    if (token === "--model") {
      const value = readNonEmptyOptionValue(args, index, "--model");
      if (typeof value !== "string") {
        return value;
      }

      model = value;
      index += 1;
      continue;
    }

    if (token === "--api-key") {
      const value = readNonEmptyOptionValue(args, index, "--api-key");
      if (typeof value !== "string") {
        return value;
      }

      apiKey = value;
      index += 1;
      continue;
    }

    if (token === "--base-url") {
      const value = readNonEmptyOptionValue(args, index, "--base-url");
      if (typeof value !== "string") {
        return value;
      }

      baseURL = value;
      index += 1;
      continue;
    }

    if (token === "--max-turns") {
      const value = readNonEmptyOptionValue(args, index, "--max-turns");
      if (typeof value !== "string") {
        return value;
      }

      const parsed = parsePositiveIntegerOption(value, "--max-turns");
      if (typeof parsed !== "number") {
        return parsed;
      }

      maxTurns = parsed;
      index += 1;
      continue;
    }

    if (token === "--permission-mode") {
      const value = readNonEmptyOptionValue(args, index, "--permission-mode");
      if (typeof value !== "string") {
        return value;
      }

      const parsed = parsePermissionMode(value);
      if (typeof parsed !== "string") {
        return parsed;
      }

      permissionMode = parsed;
      index += 1;
      continue;
    }

    if (token === "--output-format") {
      if (tui) {
        incompatibleWithTui = "--output-format";
        const value = args[index + 1];
        if (value !== undefined && !value.startsWith("--")) {
          index += 1;
        }
        continue;
      }

      const value = readNonEmptyOptionValue(args, index, "--output-format");
      if (typeof value !== "string") {
        return value;
      }

      const parsed = parseOutputFormat(value);
      if (typeof parsed !== "string") {
        return parsed;
      }

      outputFormat = parsed;
      incompatibleWithTui = "--output-format";
      index += 1;
      continue;
    }

    if (token === "--dry-run") {
      dryRun = true;
      incompatibleWithTui = "--dry-run";
      continue;
    }

    if (token === "--tui") {
      tui = true;
      continue;
    }

    if (token === "--no-color") {
      colorMode = "none";
      continue;
    }

    return unknownOption(token);
  }

  if (tui) {
    if (incompatibleWithTui !== undefined || printPrompt !== undefined || dryRun) {
      return invalidOptionValue(
        "--tui",
        incompatibleWithTui ?? (printPrompt !== undefined ? "--print" : "--dry-run"),
        "--tui cannot be combined with --print, --dry-run, or --output-format."
      );
    }

    return {
      type: "tui",
      options: {
        cwd,
        ...(model === undefined ? {} : { model }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(baseURL === undefined ? {} : { baseURL }),
        ...(maxTurns === undefined ? {} : { maxTurns }),
        ...(permissionMode === undefined ? {} : { permissionMode }),
        ...(colorMode === undefined ? {} : { colorMode })
      }
    };
  }

  if (colorMode !== undefined) {
    return unknownOption("--no-color");
  }

  if (dryRun) {
    return {
      type: "dry_run",
      options: {
        ...(printPrompt === undefined ? {} : { prompt: printPrompt }),
        cwd,
        outputFormat,
        ...(model === undefined ? {} : { model }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(baseURL === undefined ? {} : { baseURL }),
        ...(maxTurns === undefined ? {} : { maxTurns }),
        ...(permissionMode === undefined ? {} : { permissionMode })
      }
    };
  }

  if (printPrompt !== undefined) {
    return {
      type: "print",
      options: {
        prompt: printPrompt,
        cwd,
        outputFormat,
        ...(model === undefined ? {} : { model }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(baseURL === undefined ? {} : { baseURL }),
        ...(maxTurns === undefined ? {} : { maxTurns }),
        ...(permissionMode === undefined ? {} : { permissionMode })
      }
    };
  }

  return {
    type: "error",
    error: {
      code: "missing_mode",
      message:
        "No command mode selected. Use --help, --version, or --print <prompt>."
    }
  };
}
