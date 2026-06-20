#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeepSeekSdkClient, DeepSeekSdkOptions } from "../api/index.js";
import { runTuiCli, type RunTuiCliOptions } from "../tui/index.js";
import { buildCliDryRunPreview } from "./dry-run.js";
import {
  renderCliDryRunPreview,
  renderCliErrorOutput,
  renderCliOutput
} from "./output.js";
import {
  parseCliArgs,
  type CliPrintOptions,
  type CliTuiOptions
} from "./parser.js";
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
  readonly runTui?: (options: RunTuiCliOptions) => Promise<void>;
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
    "  openharness --tui",
    "  openharness --print <prompt>",
    "",
    "Options:",
    "  --cwd <dir>    Run from an existing working directory.",
    "  --tui         Start the Alpha terminal UI.",
    "  --no-color    Disable color in the terminal UI.",
    "  --dry-run      Preview resolved runtime setup without executing.",
    "  --output-format <format>",
    "                 Render print output as text, json, or stream-json.",
    "  --help         Show help.",
    "  --version      Show version.",
    "",
    "This alpha CLI supports explicit TUI mode and print mode when a provider is configured.",
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
    try {
      const preview = buildCliDryRunPreview({
        ...(result.options.prompt === undefined
          ? {}
          : { prompt: result.options.prompt }),
        cwd: result.options.cwd,
        outputFormat: result.options.outputFormat,
        ...(result.options.model === undefined
          ? {}
          : { model: result.options.model }),
        ...(result.options.apiKey === undefined
          ? {}
          : { apiKey: result.options.apiKey }),
        ...(result.options.baseURL === undefined
          ? {}
          : { baseURL: result.options.baseURL }),
        ...(result.options.maxTurns === undefined
          ? {}
          : { maxTurns: result.options.maxTurns }),
        ...(result.options.permissionMode === undefined
          ? {}
          : { permissionMode: result.options.permissionMode }),
        ...(options.env === undefined ? {} : { env: options.env })
      });

      io.stdout(
        renderCliDryRunPreview({
          preview,
          format: result.options.outputFormat
        })
      );
      return 0;
    } catch (error) {
      io.stderr(
        renderCliErrorOutput({
          format: result.options.outputFormat,
          message: getPrintModeErrorMessage(error)
        })
      );
      return 1;
    }
  }

  if (result.type === "tui") {
    let provider: CliPrintProvider | undefined;

    try {
      const setup = createDirectTuiSetup(result.options, options);
      provider = setup.provider;
      await (options.runTui ?? runTuiCli)(setup.options);
      return 0;
    } catch (error) {
      const message = getPrintModeErrorMessage(error);
      io.stderr(
        renderCliErrorOutput({
          format: "text",
          message: provider?.redact(message) ?? message
        })
      );
      return 1;
    }
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

interface DirectTuiSetup {
  readonly provider: CliPrintProvider;
  readonly options: RunTuiCliOptions;
}

function createDirectPrintModeSetup(
  flags: CliPrintOptions,
  options: RunCliOptions
): DirectPrintModeSetup {
  const provider = createCliProviderFromFlags(
    createCliProviderFlags(flags),
    options
  );

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

function createDirectTuiSetup(
  flags: CliTuiOptions,
  options: RunCliOptions
): DirectTuiSetup {
  const provider = createCliProviderFromFlags(
    createCliProviderFlags(flags),
    options
  );

  return {
    provider,
    options: {
      cwd: flags.cwd,
      apiClient: provider.apiClient,
      model: provider.model,
      permissionMode: provider.permissionMode,
      ...(flags.colorMode === undefined ? {} : { colorMode: flags.colorMode }),
      ...(provider.maxTurns === undefined ? {} : { maxTurns: provider.maxTurns }),
      ...(options.env === undefined ? {} : { env: options.env })
    }
  };
}

function createCliProviderFlags(
  flags: CliPrintOptions | CliTuiOptions
): CliPrintProviderFlags {
  return {
    ...(flags.apiKey === undefined ? {} : { apiKey: flags.apiKey }),
    ...(flags.baseURL === undefined ? {} : { baseURL: flags.baseURL }),
    ...(flags.model === undefined ? {} : { model: flags.model }),
    ...(flags.maxTurns === undefined ? {} : { maxTurns: flags.maxTurns }),
    ...(flags.permissionMode === undefined
      ? {}
      : { permissionMode: flags.permissionMode })
  };
}

function createCliProviderFromFlags(
  flags: CliPrintProviderFlags,
  options: RunCliOptions
): CliPrintProvider {
  try {
    return createCliPrintProvider({
      flags,
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
