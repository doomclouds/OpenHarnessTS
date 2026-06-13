import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { glob as tinyGlob } from "tinyglobby";
import type { ToolDefinition } from "../definition.js";
import { createToolErrorResult, createToolResult } from "../results.js";
import {
  createRipgrepBackend,
  type RipgrepBackend,
  type RipgrepBackendResult
} from "./backend.js";
import { normalizeProjectPath, resolveExistingProjectPath } from "./paths.js";

const defaultLimit = 200;
const maxLimit = 5000;
const defaultTimeoutMs = 30_000;
const gitInternalGlobExcludes = ["!.git/**", "!**/.git/**"];

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
  const { signal: fallbackSignal, timedOut, cleanup } =
    createFallbackAbortSignal(timeoutMs, signal);

  try {
    throwIfAbortedOrTimedOut(fallbackSignal, timedOut, timeoutMs);
    const paths = await waitForFallbackOperation(
      tinyGlob(toTinyglobbyPattern(pattern), {
        cwd: root,
        onlyFiles: true,
        dot: includeHidden,
        ignore: gitInternalGlobExcludes.map((glob) => glob.slice(1)),
        followSymbolicLinks: false,
        signal: fallbackSignal
      }),
      fallbackSignal,
      timedOut,
      timeoutMs
    );
    throwIfAbortedOrTimedOut(fallbackSignal, timedOut, timeoutMs);

    return {
      paths: (await normalizeMatchedPathList(root, paths)).slice(0, limit),
      backend: "fallback",
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      backendOutputTruncated: false
    };
  } catch (error) {
    if (fallbackSignal.aborted) {
      throw createFallbackAbortError(timedOut.value, timeoutMs);
    }

    throw error;
  } finally {
    cleanup();
  }
}

async function waitForFallbackOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timedOut: { readonly value: boolean },
  timeoutMs: number
): Promise<T> {
  if (signal.aborted) {
    throw createFallbackAbortError(timedOut.value, timeoutMs);
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(createFallbackAbortError(timedOut.value, timeoutMs));

    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", abort);
      });
  });
}

function createFallbackAbortSignal(
  timeoutMs: number,
  signal: AbortSignal | undefined
): {
  readonly signal: AbortSignal;
  readonly timedOut: { value: boolean };
  readonly cleanup: () => void;
} {
  const controller = new AbortController();
  const timedOut = { value: false };
  const timeout = setTimeout(() => {
    timedOut.value = true;
    controller.abort();
  }, timeoutMs);
  const relayAbort = () => controller.abort();

  if (signal?.aborted === true) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", relayAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", relayAbort);
    }
  };
}

function throwIfAbortedOrTimedOut(
  signal: AbortSignal,
  timedOut: { readonly value: boolean },
  timeoutMs: number
): void {
  if (!signal.aborted) {
    return;
  }

  throw createFallbackAbortError(timedOut.value, timeoutMs);
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

async function isInsideGitRepository(root: string): Promise<boolean> {
  let current = await realpath(root);

  while (true) {
    if (await hasGitMarker(current)) {
      return true;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }

    current = parent;
  }

  return false;
}

async function hasGitMarker(directory: string): Promise<boolean> {
  try {
    const gitMarker = await stat(path.join(directory, ".git"));

    return gitMarker.isDirectory() || gitMarker.isFile();
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false;
    }

    throw error;
  }
}

function toTinyglobbyPattern(pattern: string): string {
  return hasPathSeparator(pattern) ? pattern : `**/${pattern}`;
}

function hasPathSeparator(pattern: string): boolean {
  return /[\\/]/u.test(pattern);
}

async function normalizeMatchedPaths(
  root: string,
  output: string,
  options: { readonly dropIncompleteFinalLine?: boolean } = {}
): Promise<string[]> {
  const lines = output
    .split(/\r?\n/u)
    .filter((line) => line.length > 0);

  if (
    options.dropIncompleteFinalLine === true &&
    output.length > 0 &&
    !output.endsWith("\n") &&
    !output.endsWith("\r\n")
  ) {
    lines.pop();
  }

  const normalizedPaths = await Promise.all(
    lines.map((line) => normalizeMatchedPath(root, line))
  );

  return normalizedPaths
    .filter((line): line is string => line !== undefined)
    .sort();
}

async function normalizeMatchedPathList(
  root: string,
  paths: readonly string[]
): Promise<string[]> {
  const normalizedPaths = await Promise.all(
    paths.map((line) => normalizeMatchedPath(root, line))
  );

  return normalizedPaths
    .filter((line): line is string => line !== undefined)
    .sort();
}

async function normalizeMatchedPath(
  root: string,
  projectPath: string
): Promise<string | undefined> {
  const normalized = normalizeProjectPath(projectPath);
  const relativePath = normalized.startsWith("./")
    ? normalized.slice(2)
    : normalized;

  if (isGitInternalPath(relativePath)) {
    return undefined;
  }

  if (!isSafeRelativeMatch(root, relativePath)) {
    return undefined;
  }

  const realMatchedPath = await realpathMatchedPath(
    path.resolve(root, relativePath)
  );
  if (realMatchedPath === undefined) {
    return undefined;
  }

  if (!isInsideRoot(root, realMatchedPath)) {
    return undefined;
  }

  return relativePath;
}

async function realpathMatchedPath(
  matchedPath: string
): Promise<string | undefined> {
  try {
    return await realpath(matchedPath);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }

    throw error;
  }
}

function isGitInternalPath(projectPath: string): boolean {
  return splitPathSegments(projectPath).some((segment) => segment === ".git");
}

function isSafeRelativeGlobPattern(pattern: string): boolean {
  if (
    path.isAbsolute(pattern) ||
    path.posix.isAbsolute(pattern) ||
    path.win32.isAbsolute(pattern)
  ) {
    return false;
  }

  return !splitPathSegments(pattern).some((segment) => segment.includes(".."));
}

function isSafeRelativeMatch(root: string, projectPath: string): boolean {
  if (
    path.isAbsolute(projectPath) ||
    path.posix.isAbsolute(projectPath) ||
    path.win32.isAbsolute(projectPath)
  ) {
    return false;
  }

  if (splitPathSegments(projectPath).some((segment) => segment.includes(".."))) {
    return false;
  }

  const resolvedPath = path.resolve(root, projectPath);

  return isInsideRoot(root, resolvedPath);
}

function isInsideRoot(root: string, projectPath: string): boolean {
  const relativeToRoot = path.relative(root, projectPath);

  return (
    relativeToRoot.length === 0 ||
    (!relativeToRoot.startsWith(`..${path.sep}`) &&
      relativeToRoot !== ".." &&
      !path.isAbsolute(relativeToRoot))
  );
}

function splitPathSegments(projectPath: string): string[] {
  return projectPath.split(/[\\/]+/u).filter((segment) => segment.length > 0);
}

function isRipgrepBackendCannotRun(result: RipgrepBackendResult): boolean {
  const stderr = result.stderr.trim();

  return (
    result.exitCode === null &&
    result.signal === null &&
    !result.timedOut &&
    !result.aborted &&
    result.stdout.length === 0 &&
    !result.stdoutTruncated &&
    !result.stderrTruncated &&
    isSpawnLikeRipgrepFailure(stderr)
  );
}

function isSpawnLikeRipgrepFailure(stderr: string): boolean {
  return /^spawn\b/u.test(stderr);
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
