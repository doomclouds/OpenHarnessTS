import { stat } from "node:fs/promises";
import { glob as tinyGlob } from "tinyglobby";
import type { ToolDefinition } from "../definition.js";
import { createToolErrorResult, createToolResult } from "../results.js";
import {
  createRipgrepBackend,
  type RipgrepBackend,
  type RipgrepBackendResult
} from "./backend.js";
import { resolveExistingProjectPath } from "./paths.js";
import {
  createFallbackAbortSignal,
  getGitInternalIgnoreGlobs,
  gitInternalGlobExcludes,
  isInsideGitRepository,
  isRipgrepBackendCannotRun,
  normalizeMatchedPathList,
  normalizeMatchedPaths,
  throwIfAbortedOrTimedOut,
  toTinyglobbyPattern,
  waitForFallbackOperation
} from "./search/index.js";

const defaultLimit = 200;
const maxLimit = 5000;
const defaultTimeoutMs = 30_000;

export interface GlobToolInput {
  readonly pattern?: string;
  readonly path?: string;
  readonly root?: string;
  readonly limit?: number;
}

interface NormalizedGlobToolInput {
  readonly pattern: string;
  readonly root?: string;
  readonly limit: number;
}

export interface CreateGlobToolOptions {
  readonly backend?: RipgrepBackend;
  readonly disableRipgrep?: boolean;
  readonly timeoutMs?: number;
}

interface GlobMatchResult {
  readonly paths: readonly string[];
  readonly backend: "ripgrep" | "fallback";
  readonly fallbackReason?: string;
  readonly backendOutputTruncated: boolean;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
}

class GlobToolExecutionError extends Error {
  constructor(
    message: string,
    readonly metadata: Readonly<Record<string, unknown>>
  ) {
    super(message);
  }
}

export function createGlobTool(
  options: CreateGlobToolOptions = {}
): ToolDefinition<unknown> {
  const backend = options.backend ?? createRipgrepBackend();
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;

  return {
    name: "glob",
    description: "List files in the local project matching a glob pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern relative to the search root."
        },
        path: {
          type: "string",
          description: "Alias for pattern."
        },
        root: {
          type: "string",
          description: "Optional project-relative search root."
        },
        limit: {
          type: "integer",
          description: "Maximum number of paths to return.",
          default: defaultLimit,
          minimum: 1,
          maximum: maxLimit
        }
      },
      additionalProperties: false
    },
    isReadOnly() {
      return true;
    },
    validateInput(input) {
      return validateGlobToolInput(input);
    },
    async execute(input, context) {
      const startedAt = Date.now();
      const validation = validateGlobToolInput(input);

      if (!validation.ok) {
        return createToolErrorResult(
          `Invalid input for glob: ${validation.error}`,
          { tool: "glob" }
        );
      }

      const globInput = validation.value;
      let root: string | undefined;

      try {
        root = await resolveExistingProjectPath(
          context.cwd,
          globInput.root ?? "."
        );

        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) {
          return createToolErrorResult(
            `glob search root must be a directory: ${root}`,
            {
              tool: "glob",
              root
            }
          );
        }

        const includeHidden = await isInsideGitRepository(root);
        const matchResult =
          options.disableRipgrep === true
            ? await fallbackGlob(
                root,
                globInput.pattern,
                globInput.limit + 1,
                includeHidden,
                timeoutMs,
                context.signal
              )
            : await ripgrepGlob(
                backend,
                root,
                globInput.pattern,
                globInput.limit + 1,
                includeHidden,
                timeoutMs,
                context.signal
              );
        const returnedPaths = matchResult.paths.slice(0, globInput.limit);
        const truncated =
          matchResult.paths.length > globInput.limit ||
          matchResult.backendOutputTruncated;

        return createToolResult({
          output:
            returnedPaths.length === 0 ? "(no matches)" : returnedPaths.join("\n"),
          metadata: {
            tool: "glob",
            backend: matchResult.backend,
            root,
            pattern: globInput.pattern,
            matchedFileCount: returnedPaths.length,
            truncated,
            durationMs: Date.now() - startedAt,
            ...(matchResult.fallbackReason === undefined
              ? {}
              : { fallbackReason: matchResult.fallbackReason }),
            ...(matchResult.stdoutTruncated === undefined
              ? {}
              : { stdoutTruncated: matchResult.stdoutTruncated }),
            ...(matchResult.stderrTruncated === undefined
              ? {}
              : { stderrTruncated: matchResult.stderrTruncated })
          }
        });
      } catch (error) {
        return createToolErrorResult(errorToMessage(error), {
          tool: "glob",
          ...(root === undefined ? {} : { root }),
          pattern: globInput.pattern,
          durationMs: Date.now() - startedAt,
          ...(error instanceof GlobToolExecutionError ? error.metadata : {})
        });
      }
    }
  };
}

function validateGlobToolInput(input: unknown):
  | {
      readonly ok: true;
      readonly value: NormalizedGlobToolInput;
    }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "input must be an object" };
  }

  const candidate = input as Record<string, unknown>;
  const allowedKeys = new Set(["pattern", "path", "root", "limit"]);
  const unexpectedKey = Object.keys(candidate).find(
    (key) => !allowedKeys.has(key)
  );

  if (unexpectedKey !== undefined) {
    return { ok: false, error: `unexpected property: ${unexpectedKey}` };
  }

  if (candidate.pattern !== undefined && candidate.path !== undefined) {
    return { ok: false, error: "provide either pattern or path, not both" };
  }

  const effectivePattern = candidate.pattern ?? candidate.path;
  if (
    typeof effectivePattern !== "string" ||
    effectivePattern.trim().length === 0
  ) {
    return { ok: false, error: "pattern must be a non-empty string" };
  }

  if (!isSafeRelativeGlobPattern(effectivePattern)) {
    return { ok: false, error: "glob pattern must stay within root" };
  }

  if (candidate.root !== undefined && typeof candidate.root !== "string") {
    return { ok: false, error: "root must be a string" };
  }

  const limit = candidate.limit === undefined ? defaultLimit : candidate.limit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maxLimit
  ) {
    return { ok: false, error: "limit must be an integer between 1 and 5000" };
  }

  return {
    ok: true,
    value: {
      pattern: effectivePattern,
      ...(candidate.root === undefined
        ? {}
        : { root: candidate.root as string }),
      limit
    }
  };
}

async function ripgrepGlob(
  backend: RipgrepBackend,
  root: string,
  pattern: string,
  limit: number,
  includeHidden: boolean,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<GlobMatchResult> {
  const args = [
    "--files",
    ...(includeHidden ? ["--hidden"] : []),
    "--color",
    "never",
    "--glob",
    pattern,
    ...gitInternalGlobExcludes.flatMap((glob) => ["--glob", glob]),
    "."
  ];
  const result = await backend.run(
    args,
    {
      cwd: root,
      timeoutMs,
      ...(signal === undefined ? {} : { signal })
    }
  );

  if (result.timedOut) {
    throw createRipgrepError(
      `glob timed out after ${timeoutMs}ms`,
      result
    );
  }

  if (result.aborted) {
    throw createRipgrepError("glob was aborted", result);
  }

  if (isRipgrepFileListSuccess(result)) {
    return {
      paths: (
        await normalizeMatchedPaths(root, result.stdout, {
          dropIncompleteFinalLine: result.stdoutTruncated
        })
      ).slice(0, limit),
      backend: "ripgrep",
      backendOutputTruncated: result.stdoutTruncated,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    };
  }

  if (isRipgrepBackendCannotRun(result)) {
    return await fallbackGlob(
      root,
      pattern,
      limit,
      includeHidden,
      timeoutMs,
      signal,
      result.stderr.trim()
    );
  }

  throw createRipgrepError(result.stderr.trim() || "ripgrep glob failed", result);
}

function isRipgrepFileListSuccess(result: RipgrepBackendResult): boolean {
  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1 && result.stderr.trim().length === 0) {
    return true;
  }

  return (
    result.exitCode === null &&
    result.signal !== null &&
    result.stdoutTruncated &&
    result.stderr.trim().length === 0
  );
}

async function fallbackGlob(
  root: string,
  pattern: string,
  limit: number,
  includeHidden: boolean,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  fallbackReason?: string
): Promise<GlobMatchResult> {
  const runtime = createFallbackAbortSignal(timeoutMs, signal);

  try {
    throwIfAbortedOrTimedOut(runtime, (timedOut) =>
      createFallbackAbortError(timedOut, timeoutMs)
    );
    const paths = await waitForFallbackOperation(
      tinyGlob(toTinyglobbyPattern(pattern), {
        cwd: root,
        onlyFiles: true,
        dot: includeHidden,
        ignore: getGitInternalIgnoreGlobs(),
        followSymbolicLinks: false,
        signal: runtime.signal
      }),
      runtime,
      (timedOut) => createFallbackAbortError(timedOut, timeoutMs)
    );
    throwIfAbortedOrTimedOut(runtime, (timedOut) =>
      createFallbackAbortError(timedOut, timeoutMs)
    );

    return {
      paths: (await normalizeMatchedPathList(root, paths)).slice(0, limit),
      backend: "fallback",
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      backendOutputTruncated: false
    };
  } catch (error) {
    if (runtime.signal.aborted) {
      throw createFallbackAbortError(runtime.timedOut.value, timeoutMs);
    }

    throw error;
  } finally {
    runtime.cleanup();
  }
}

function createFallbackAbortError(
  timedOut: boolean,
  timeoutMs: number
): GlobToolExecutionError {
  return new GlobToolExecutionError(
    timedOut ? `glob timed out after ${timeoutMs}ms` : "glob was aborted",
    {
      backend: "fallback",
      timedOut,
      aborted: !timedOut
    }
  );
}

function isSafeRelativeGlobPattern(pattern: string): boolean {
  if (
    pattern.startsWith("/") ||
    pattern.startsWith("\\") ||
    /^[a-zA-Z]:[\\/]/u.test(pattern) ||
    /^\\\\/u.test(pattern)
  ) {
    return false;
  }

  return !pattern
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0)
    .some((segment) => segment === "..");
}

function createRipgrepError(
  message: string,
  result: RipgrepBackendResult
): GlobToolExecutionError {
  return new GlobToolExecutionError(message, {
    backend: "ripgrep",
    exitCode: result.exitCode,
    signal: result.signal,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated
  });
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
