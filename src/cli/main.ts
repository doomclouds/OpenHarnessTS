#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeepSeekSdkClient, DeepSeekSdkOptions } from "../api/index.js";
import { renderCliErrorOutput, renderCliOutput } from "./output.js";
import { parseCliArgs, type CliPrintOptions } from "./parser.js";
import {
  PrintModeError,
  runPrintMode,
  type PrintModeProviderOptions,
  type RunPrintModeOptions
} from "./print-mode.js";
import {
  CliProviderError,
  createCliPrintProvider,
  type CliPrintProvider,
  type CliPrintProviderFlags
} from "./provider.js";

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface RunCliOptions {
  readonly cwd?: string;
  readonly version?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly createSdkClient?: (options: DeepSeekSdkOptions) => DeepSeekSdkClient;
  readonly printMode?: PrintModeProviderOptions;
}

const defaultIo: CliIo = {
  stdout(text) {
    process.stdout.write(text);
  },
  stderr(text) {
    process.stderr.write(text);
  }
};

function readPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as {
    readonly version?: unknown;
  };

  return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
}

export function renderHelp(): string {
  return [
    "OpenHarness",
    "",
    "Usage:",
    "  openharness --print <prompt>",
    "",
    "Options:",
    "  --cwd <dir>    Run from an existing working directory.",
    "  --output-format <format>",
    "                 Render print output as text, json, or stream-json.",
    "  --help         Show help.",
    "  --version      Show version.",
    "",
    "This alpha CLI can run print mode only when a provider is configured.",
    ""
  ].join("\n");
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
  options: RunCliOptions = {}
): Promise<number> {
  const version = options.version ?? readPackageVersion();
  const parseOptions =
    options.cwd === undefined ? { version } : { cwd: options.cwd, version };
  const result = parseCliArgs(argv, parseOptions);

  if (result.type === "help") {
    io.stdout(renderHelp());
    return 0;
  }

  if (result.type === "version") {
    io.stdout(`OpenHarness ${result.version}\n`);
    return 0;
  }

  if (result.type === "error") {
    io.stderr(`${result.error.message}\n`);
    return 1;
  }

  if (result.type === "dry_run") {
    // Temporary guard until the dry-run runner task wires the preview.
    io.stderr("Dry-run preview is not wired yet.\n");
    return 1;
  }

  let provider: CliPrintProvider | undefined;
  const outputFormat = result.options.outputFormat;

  try {
    let printOptions: RunPrintModeOptions;
    if (options.printMode === undefined) {
      const setup = createDirectPrintModeSetup(result.options, options);
      provider = setup.provider;
      printOptions = setup.options;
    } else {
      printOptions = {
        prompt: result.options.prompt,
        cwd: result.options.cwd,
        ...options.printMode
      };
    }

    const printResult = await runPrintMode(printOptions);
    io.stdout(renderCliOutput({ result: printResult, format: outputFormat }));
    return 0;
  } catch (error) {
    const message = getPrintModeErrorMessage(error);
    io.stderr(
      renderCliErrorOutput({
        format: outputFormat,
        message: provider?.redact(message) ?? message
      })
    );
    return 1;
  }
}

interface DirectPrintModeSetup {
  readonly provider: CliPrintProvider;
  readonly options: RunPrintModeOptions;
}

function createDirectPrintModeSetup(
  flags: CliPrintOptions,
  options: RunCliOptions
): DirectPrintModeSetup {
  let provider: CliPrintProvider;

  try {
    const providerFlags: CliPrintProviderFlags = {
      ...(flags.apiKey === undefined ? {} : { apiKey: flags.apiKey }),
      ...(flags.baseURL === undefined ? {} : { baseURL: flags.baseURL }),
      ...(flags.model === undefined ? {} : { model: flags.model }),
      ...(flags.maxTurns === undefined ? {} : { maxTurns: flags.maxTurns }),
      ...(flags.permissionMode === undefined
        ? {}
        : { permissionMode: flags.permissionMode })
    };

    provider = createCliPrintProvider({
      flags: providerFlags,
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.createSdkClient === undefined
        ? {}
        : { createSdkClient: options.createSdkClient })
    });
  } catch (error) {
    if (error instanceof CliProviderError) {
      throw error;
    }

    throw new CliProviderError(getPrintModeErrorMessage(error));
  }

  return {
    provider,
    options: {
      prompt: flags.prompt,
      cwd: flags.cwd,
      apiClient: provider.apiClient,
      model: provider.model,
      permissionMode: provider.permissionMode,
      ...(provider.maxTurns === undefined ? {} : { maxTurns: provider.maxTurns }),
      ...(options.env === undefined ? {} : { env: options.env })
    }
  };
}

function getPrintModeErrorMessage(error: unknown): string {
  if (error instanceof PrintModeError || error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const entrypoint = process.argv[1];

if (
  entrypoint !== undefined &&
  resolve(entrypoint) === fileURLToPath(import.meta.url)
) {
  runCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${getPrintModeErrorMessage(error)}\n`);
      process.exitCode = 1;
    });
}
