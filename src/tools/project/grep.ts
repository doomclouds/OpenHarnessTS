import { readFile, realpath, stat } from "node:fs/promises";
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

export type GrepOutputMode = "content" | "files_with_matches" | "count";

const defaultHeadLimit = 200;
const maxHeadLimit = 2000;
const defaultTimeoutSeconds = 20;
const maxTimeoutSeconds = 120;
const gitInternalGlobExcludes = ["!.git/**", "!**/.git/**"];

export interface GrepToolInput {
  readonly pattern: string;
  readonly root?: string;
  readonly glob?: string;
  readonly fileGlob?: string;
  readonly type?: string;
  readonly outputMode?: GrepOutputMode;
  readonly output_mode?: GrepOutputMode;
  readonly caseSensitive?: boolean;
  readonly multiline?: boolean;
  readonly beforeContext?: number;
  readonly afterContext?: number;
  readonly context?: number;
  readonly headLimit?: number;
  readonly head_limit?: number;
  readonly offset?: number;
  readonly timeoutSeconds?: number;
  readonly timeout_seconds?: number;
}

interface NormalizedGrepToolInput {
  readonly pattern: string;
  readonly root?: string;
  readonly glob?: string;
  readonly type?: string;
  readonly outputMode: GrepOutputMode;
  readonly caseSensitive: boolean;
  readonly multiline: boolean;
  readonly beforeContext?: number;
  readonly afterContext?: number;
  readonly context?: number;
  readonly headLimit: number;
  readonly offset: number;
  readonly timeoutSeconds: number;
}

export interface CreateGrepToolOptions {
  readonly backend?: RipgrepBackend;
  readonly disableRipgrep?: boolean;
}

interface GrepSearchResult {
  readonly lines: readonly string[];
  readonly backend: "ripgrep" | "fallback";
  readonly fallbackReason?: string;
  readonly timedOut: boolean;
  readonly aborted?: boolean;
  readonly partialOutput?: string;
  readonly stdoutTruncated?: boolean;
  readonly stderrTruncated?: boolean;
}

class GrepToolExecutionError extends Error {
  constructor(
    message: string,
    readonly metadata: Readonly<Record<string, unknown>>
  ) {
    super(message);
  }
}

export function createGrepTool(
  options: CreateGrepToolOptions = {}
): ToolDefinition<unknown> {
  const backend = options.backend ?? createRipgrepBackend();

  return {
    name: "grep",
    description: "Search project files with a regular expression.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression pattern to search for."
        },
        root: {
          type: "string",
          description: "Optional project-relative search root."
        },
        glob: {
          type: "string",
          description: "Optional file glob filter."
        },
        fileGlob: {
          type: "string",
          description: "Alias for glob."
        },
        type: {
          type: "string",
          description: "Optional ripgrep file type filter."
        },
        outputMode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"],
          default: "content"
        },
        output_mode: {
          type: "string",
          enum: ["content", "files_with_matches", "count"]
        },
        caseSensitive: {
          type: "boolean",
          default: true
        },
        multiline: {
          type: "boolean",
          default: false
        },
        beforeContext: {
          type: "integer",
          minimum: 0
        },
        afterContext: {
          type: "integer",
          minimum: 0
        },
        context: {
          type: "integer",
          minimum: 0
        },
        headLimit: {
          type: "integer",
          default: defaultHeadLimit,
          minimum: 1,
          maximum: maxHeadLimit
        },
        head_limit: {
          type: "integer",
          minimum: 1,
          maximum: maxHeadLimit
        },
        offset: {
          type: "integer",
          default: 0,
          minimum: 0
        },
        timeoutSeconds: {
          type: "integer",
          default: defaultTimeoutSeconds,
          minimum: 1,
          maximum: maxTimeoutSeconds
        },
        timeout_seconds: {
          type: "integer",
          minimum: 1,
          maximum: maxTimeoutSeconds
        }
      },
      required: ["pattern"],
      additionalProperties: false
    },
    isReadOnly() {
      return true;
    },
    validateInput(input) {
      return validateGrepToolInput(input);
    },
    async execute(input, context) {
      const startedAt = Date.now();
      const validation = validateGrepToolInput(input);

      if (!validation.ok) {
        return createToolErrorResult(
          `Invalid input for grep: ${validation.error}`,
          { tool: "grep" }
        );
      }

      const grepInput = validation.value;
      let root: string | undefined;

      try {
        root = await resolveExistingProjectPath(
          context.cwd,
          grepInput.root ?? "."
        );

        const rootStat = await stat(root);
        if (!rootStat.isDirectory()) {
          return createToolErrorResult(
            `grep search root must be a directory: ${root}`,
            {
              tool: "grep",
              root
            }
          );
        }

        const includeHidden = await isInsideGitRepository(root);
        const searchResult =
          options.disableRipgrep === true
            ? await fallbackGrep(root, grepInput, includeHidden, context.signal)
            : await ripgrepGrep(
                backend,
                root,
                grepInput,
                includeHidden,
                context.signal
              );
        const visibleLines = searchResult.lines.slice(
          grepInput.offset,
          grepInput.offset + grepInput.headLimit
        );
        const output =
          visibleLines.length === 0 ? "(no matches)" : visibleLines.join("\n");
        const stats = computeGrepStats(searchResult.lines, grepInput.outputMode);

        return createToolResult({
          output,
          metadata: {
            tool: "grep",
            backend: searchResult.backend,
            root,
            pattern: grepInput.pattern,
            outputMode: grepInput.outputMode,
            numFiles: stats.numFiles,
            numLines: visibleLines.length,
            numMatches: stats.numMatches,
            appliedLimit: grepInput.headLimit,
            appliedOffset: grepInput.offset,
            timedOut: searchResult.timedOut,
            durationMs: Date.now() - startedAt,
            truncated:
              grepInput.offset + visibleLines.length <
                searchResult.lines.length ||
              searchResult.stdoutTruncated === true,
            ...(searchResult.fallbackReason === undefined
              ? {}
              : { fallbackReason: searchResult.fallbackReason }),
            ...(searchResult.aborted === undefined
              ? {}
              : { aborted: searchResult.aborted }),
            ...(searchResult.partialOutput === undefined
              ? {}
              : { partialOutput: searchResult.partialOutput }),
            ...(searchResult.stdoutTruncated === undefined
              ? {}
              : { stdoutTruncated: searchResult.stdoutTruncated }),
            ...(searchResult.stderrTruncated === undefined
              ? {}
              : { stderrTruncated: searchResult.stderrTruncated })
          }
        });
      } catch (error) {
        return createToolErrorResult(errorToMessage(error), {
          tool: "grep",
          ...(root === undefined ? {} : { root }),
          pattern: grepInput.pattern,
          outputMode: grepInput.outputMode,
          durationMs: Date.now() - startedAt,
          ...(error instanceof GrepToolExecutionError ? error.metadata : {})
        });
      }
    }
  };
}

function validateGrepToolInput(input: unknown):
  | {
      readonly ok: true;
      readonly value: NormalizedGrepToolInput;
    }
  | {
      readonly ok: false;
      readonly error: string;
    } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "input must be an object" };
  }

  const candidate = input as Record<string, unknown>;
  const allowedKeys = new Set([
    "pattern",
    "root",
    "glob",
    "fileGlob",
    "type",
    "outputMode",
    "output_mode",
    "caseSensitive",
    "multiline",
    "beforeContext",
    "afterContext",
    "context",
    "headLimit",
    "head_limit",
    "offset",
    "timeoutSeconds",
    "timeout_seconds"
  ]);
  const unexpectedKey = Object.keys(candidate).find(
    (key) => !allowedKeys.has(key)
  );

  if (unexpectedKey !== undefined) {
    return { ok: false, error: `unexpected property: ${unexpectedKey}` };
  }

  if (typeof candidate.pattern !== "string" || candidate.pattern.trim().length === 0) {
    return { ok: false, error: "pattern must be a non-empty string" };
  }

  if (candidate.glob !== undefined && candidate.fileGlob !== undefined) {
    return { ok: false, error: "provide either glob or fileGlob, not both" };
  }

  const glob = candidate.glob ?? candidate.fileGlob;
  if (glob !== undefined && typeof glob !== "string") {
    return { ok: false, error: "glob must be a string" };
  }

  if (candidate.root !== undefined && typeof candidate.root !== "string") {
    return { ok: false, error: "root must be a string" };
  }

  if (candidate.type !== undefined && typeof candidate.type !== "string") {
    return { ok: false, error: "type must be a string" };
  }

  if (
    candidate.caseSensitive !== undefined &&
    typeof candidate.caseSensitive !== "boolean"
  ) {
    return { ok: false, error: "caseSensitive must be a boolean" };
  }

  if (
    candidate.multiline !== undefined &&
    typeof candidate.multiline !== "boolean"
  ) {
    return { ok: false, error: "multiline must be a boolean" };
  }

  const outputModeValue = candidate.outputMode ?? candidate.output_mode;
  const outputMode = readOutputMode(outputModeValue);
  if (outputMode === undefined) {
    return {
      ok: false,
      error: "outputMode must be content, files_with_matches, or count"
    };
  }

  const beforeContext = readOptionalInteger(candidate.beforeContext);
  const afterContext = readOptionalInteger(candidate.afterContext);
  const context = readOptionalInteger(candidate.context);

  if (
    beforeContext === undefined &&
    candidate.beforeContext !== undefined
  ) {
    return { ok: false, error: "beforeContext must be an integer >= 0" };
  }
  if (afterContext === undefined && candidate.afterContext !== undefined) {
    return { ok: false, error: "afterContext must be an integer >= 0" };
  }
  if (context === undefined && candidate.context !== undefined) {
    return { ok: false, error: "context must be an integer >= 0" };
  }
  if (context !== undefined && (beforeContext !== undefined || afterContext !== undefined)) {
    return {
      ok: false,
      error: "context cannot be combined with beforeContext or afterContext"
    };
  }

  const headLimit = readInteger(
    candidate.headLimit ?? candidate.head_limit,
    defaultHeadLimit
  );
  if (
    headLimit === undefined ||
    headLimit < 1 ||
    headLimit > maxHeadLimit
  ) {
    return {
      ok: false,
      error: `headLimit must be an integer between 1 and ${maxHeadLimit}`
    };
  }

  const offset = readInteger(candidate.offset, 0);
  if (offset === undefined || offset < 0) {
    return { ok: false, error: "offset must be an integer >= 0" };
  }

  const timeoutSeconds = readInteger(
    candidate.timeoutSeconds ?? candidate.timeout_seconds,
    defaultTimeoutSeconds
  );
  if (
    timeoutSeconds === undefined ||
    timeoutSeconds < 1 ||
    timeoutSeconds > maxTimeoutSeconds
  ) {
    return {
      ok: false,
      error: `timeoutSeconds must be an integer between 1 and ${maxTimeoutSeconds}`
    };
  }

  return {
    ok: true,
    value: {
      pattern: candidate.pattern,
      ...(candidate.root === undefined ? {} : { root: candidate.root as string }),
      ...(glob === undefined ? {} : { glob: glob as string }),
      ...(candidate.type === undefined ? {} : { type: candidate.type as string }),
      outputMode,
      caseSensitive:
        candidate.caseSensitive === undefined
          ? true
          : (candidate.caseSensitive as boolean),
      multiline:
        candidate.multiline === undefined ? false : (candidate.multiline as boolean),
      ...(beforeContext === undefined ? {} : { beforeContext }),
      ...(afterContext === undefined ? {} : { afterContext }),
      ...(context === undefined ? {} : { context }),
      headLimit,
      offset,
      timeoutSeconds
    }
  };
}

async function ripgrepGrep(
  backend: RipgrepBackend,
  root: string,
  input: NormalizedGrepToolInput,
  includeHidden: boolean,
  signal: AbortSignal | undefined
): Promise<GrepSearchResult> {
  const args = [
    "--no-heading",
    "--line-number",
    "--color",
    "never",
    ...(includeHidden ? ["--hidden"] : [])
  ];

  if (input.glob !== undefined) {
    args.push("--glob", input.glob);
  }
  args.push(...gitInternalGlobExcludes.flatMap((glob) => ["--glob", glob]));
  if (input.type !== undefined) {
    args.push("--type", input.type);
  }
  if (!input.caseSensitive) {
    args.push("-i");
  }
  if (input.multiline) {
    args.push("--multiline");
  }
  if (input.context !== undefined) {
    args.push("-C", String(input.context));
  }
  if (input.beforeContext !== undefined) {
    args.push("-B", String(input.beforeContext));
  }
  if (input.afterContext !== undefined) {
    args.push("-A", String(input.afterContext));
  }
  if (input.outputMode === "files_with_matches") {
    args.push("--files-with-matches");
  }
  if (input.outputMode === "count") {
    args.push("--count");
  }

  args.push("--", input.pattern, ".");

  const result = await backend.run(args, {
    cwd: root,
    timeoutMs: input.timeoutSeconds * 1000,
    ...(signal === undefined ? {} : { signal })
  });

  if (result.timedOut) {
    throw createRipgrepError(
      `[grep timed out after ${input.timeoutSeconds} seconds]`,
      result,
      { partialOutput: trimTrailingNewline(result.stdout) }
    );
  }

  if (result.aborted) {
    throw createRipgrepError("grep was aborted", result);
  }

  if (isRipgrepSearchSuccess(result)) {
    return {
      lines: await normalizeRipgrepOutput(root, result.stdout, input.outputMode, {
        dropIncompleteFinalLine: result.stdoutTruncated
      }),
      backend: "ripgrep",
      timedOut: false,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated
    };
  }

  if (isRipgrepBackendCannotRun(result)) {
    return await fallbackGrep(
      root,
      input,
      includeHidden,
      signal,
      result.stderr.trim()
    );
  }

  throw createRipgrepError(result.stderr.trim() || "ripgrep search failed", result);
}

function isRipgrepSearchSuccess(result: RipgrepBackendResult): boolean {
  if (result.exitCode === 0 || result.exitCode === 1) {
    return result.stderr.trim().length === 0;
  }

  return (
    result.exitCode === null &&
    result.signal !== null &&
    result.stdoutTruncated &&
    result.stderr.trim().length === 0
  );
}

async function fallbackGrep(
  root: string,
  input: NormalizedGrepToolInput,
  includeHidden: boolean,
  signal: AbortSignal | undefined,
  fallbackReason?: string
): Promise<GrepSearchResult> {
  if (input.type !== undefined) {
    throw new GrepToolExecutionError(
      "grep fallback does not support type filters",
      {
        backend: "fallback",
        timedOut: false,
        ...(fallbackReason === undefined ? {} : { fallbackReason })
      }
    );
  }

  const regexp = createSearchRegExp(input);
  assertSafeFallbackPattern(input.pattern);
  const { signal: fallbackSignal, timedOut, cleanup } =
    createFallbackAbortSignal(input.timeoutSeconds * 1000, signal);

  try {
    throwIfAbortedOrTimedOut(fallbackSignal, timedOut, input.timeoutSeconds);
    const paths = await waitForFallbackOperation(
      tinyGlob(toTinyglobbyPattern(input.glob ?? "**/*"), {
        cwd: root,
        onlyFiles: true,
        dot: includeHidden,
        ignore: gitInternalGlobExcludes.map((glob) => glob.slice(1)),
        followSymbolicLinks: false,
        signal: fallbackSignal
      }),
      fallbackSignal,
      timedOut,
      input.timeoutSeconds
    );
    throwIfAbortedOrTimedOut(fallbackSignal, timedOut, input.timeoutSeconds);

    const lines: string[] = [];
    for (const matchedPath of paths.sort()) {
      throwIfAbortedOrTimedOut(fallbackSignal, timedOut, input.timeoutSeconds);

      const normalizedPath = await normalizeMatchedPath(root, matchedPath);
      if (normalizedPath === undefined) {
        continue;
      }

      const raw = await waitForFallbackOperation(
        readFile(path.join(root, normalizedPath), { signal: fallbackSignal }),
        fallbackSignal,
        timedOut,
        input.timeoutSeconds
      );
      throwIfAbortedOrTimedOut(fallbackSignal, timedOut, input.timeoutSeconds);
      if (raw.includes(0)) {
        continue;
      }

      const text = raw.toString("utf8");
      addFallbackFileMatches(
        lines,
        normalizedPath,
        text,
        regexp,
        input,
        fallbackSignal,
        timedOut
      );
    }

    return {
      lines,
      backend: "fallback",
      ...(fallbackReason === undefined ? {} : { fallbackReason }),
      timedOut: false
    };
  } catch (error) {
    if (error instanceof GrepToolExecutionError) {
      throw error;
    }

    if (fallbackSignal.aborted) {
      throw createFallbackAbortError(timedOut.value, input.timeoutSeconds);
    }

    throw error;
  } finally {
    cleanup();
  }
}

function createSearchRegExp(input: NormalizedGrepToolInput): RegExp {
  const flags = `${input.caseSensitive ? "" : "i"}${input.multiline ? "m" : ""}gu`;

  try {
    return new RegExp(input.pattern, flags);
  } catch (error) {
    throw new GrepToolExecutionError(
      `invalid regex pattern '${input.pattern}': ${errorToMessage(error)}`,
      {
        backend: "fallback",
        timedOut: false
      }
    );
  }
}

function assertSafeFallbackPattern(pattern: string): void {
  if (hasPotentiallyCatastrophicFallbackPattern(pattern)) {
    throw new GrepToolExecutionError(
      `unsupported fallback regex pattern '${pattern}'`,
      {
        backend: "fallback",
        timedOut: false
      }
    );
  }
}

function hasPotentiallyCatastrophicFallbackPattern(pattern: string): boolean {
  return (
    hasUnescaped(pattern, "|") ||
    /\\[1-9]/u.test(pattern) ||
    /\\k<[^>]+>/u.test(pattern) ||
    /\(\?<?[!=]/u.test(pattern) ||
    /\((?:[^()\\]|\\.)+\)[+*?{]/u.test(pattern) ||
    /\((?:[^()\\]|\\.)*[+*{](?:[^()\\]|\\.)*\)/u.test(pattern)
  );
}

function addFallbackFileMatches(
  lines: string[],
  filePath: string,
  text: string,
  regexp: RegExp,
  input: NormalizedGrepToolInput,
  signal: AbortSignal,
  timedOut: { readonly value: boolean }
): void {
  if (input.multiline) {
    addMultilineFallbackMatches(
      lines,
      filePath,
      text,
      regexp,
      input,
      signal,
      timedOut
    );
    return;
  }

  const textLines = splitTextLines(text);
  let fileMatches = 0;
  const matchedLineNumbers = new Set<number>();

  for (const [index, line] of textLines.entries()) {
    throwIfAbortedOrTimedOut(signal, timedOut, input.timeoutSeconds);
    regexp.lastIndex = 0;

    if (!regexp.test(line)) {
      continue;
    }

    fileMatches += 1;
    matchedLineNumbers.add(index);

    if (input.outputMode === "files_with_matches") {
      lines.push(filePath);
      return;
    }
  }

  if (input.outputMode === "count") {
    if (fileMatches > 0) {
      lines.push(`${filePath}:${fileMatches}`);
    }
    return;
  }

  for (const lineIndex of expandContextLineNumbers(
    matchedLineNumbers,
    textLines.length,
    input
  )) {
    const isMatch = matchedLineNumbers.has(lineIndex);
    lines.push(
      `${filePath}${isMatch ? ":" : "-"}${lineIndex + 1}${
        isMatch ? ":" : "-"
      }${textLines[lineIndex] ?? ""}`
    );
  }
}

function addMultilineFallbackMatches(
  lines: string[],
  filePath: string,
  text: string,
  regexp: RegExp,
  input: NormalizedGrepToolInput,
  signal: AbortSignal,
  timedOut: { readonly value: boolean }
): void {
  const textLines = splitTextLines(text);
  const lineStarts = getLineStartOffsets(textLines);
  const matchedLineNumbers = new Set<number>();
  let fileMatches = 0;

  for (const match of text.matchAll(regexp)) {
    throwIfAbortedOrTimedOut(signal, timedOut, input.timeoutSeconds);
    fileMatches += 1;
    matchedLineNumbers.add(findLineIndex(lineStarts, match.index ?? 0));

    if (input.outputMode === "files_with_matches") {
      lines.push(filePath);
      return;
    }
  }

  if (input.outputMode === "count") {
    if (fileMatches > 0) {
      lines.push(`${filePath}:${fileMatches}`);
    }
    return;
  }

  for (const lineIndex of expandContextLineNumbers(
    matchedLineNumbers,
    textLines.length,
    input
  )) {
    const isMatch = matchedLineNumbers.has(lineIndex);
    lines.push(
      `${filePath}${isMatch ? ":" : "-"}${lineIndex + 1}${
        isMatch ? ":" : "-"
      }${textLines[lineIndex] ?? ""}`
    );
  }
}

function expandContextLineNumbers(
  matchedLineNumbers: ReadonlySet<number>,
  lineCount: number,
  input: NormalizedGrepToolInput
): number[] {
  const before = input.context ?? input.beforeContext ?? 0;
  const after = input.context ?? input.afterContext ?? 0;
  const expanded = new Set<number>();

  for (const lineIndex of matchedLineNumbers) {
    const start = Math.max(0, lineIndex - before);
    const end = Math.min(lineCount - 1, lineIndex + after);

    for (let index = start; index <= end; index += 1) {
      expanded.add(index);
    }
  }

  return [...expanded].sort((left, right) => left - right);
}

async function normalizeRipgrepOutput(
  root: string,
  output: string,
  outputMode: GrepOutputMode,
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

  const normalizedLines = await Promise.all(
    lines.map((line) => normalizeRipgrepLine(root, line, outputMode))
  );

  return normalizedLines.filter((line): line is string => line !== undefined);
}

async function normalizeRipgrepLine(
  root: string,
  line: string,
  outputMode: GrepOutputMode
): Promise<string | undefined> {
  if (outputMode === "files_with_matches") {
    const normalizedPath = await normalizeMatchedPath(root, line);

    return normalizedPath;
  }

  const parsed =
    outputMode === "count"
      ? await parseRipgrepCountLine(root, line)
      : await parseRipgrepTextLine(root, line);

  if (parsed === undefined) {
    return undefined;
  }

  return `${parsed.path}${line.slice(parsed.pathEnd)}`;
}

interface ParsedRipgrepLine {
  readonly path: string;
  readonly pathEnd: number;
  readonly separator: ":" | "-";
}

async function parseRipgrepTextLine(
  root: string,
  line: string
): Promise<ParsedRipgrepLine | undefined> {
  let parsed: ParsedRipgrepLine | undefined;

  for (const candidate of findTextLineCandidates(line)) {
    const normalizedPath = await normalizeMatchedPath(
      root,
      line.slice(0, candidate.pathEnd)
    );

    if (normalizedPath !== undefined) {
      parsed = {
        path: normalizedPath,
        pathEnd: candidate.pathEnd,
        separator: candidate.separator
      };
    }
  }

  return parsed;
}

async function parseRipgrepCountLine(
  root: string,
  line: string
): Promise<ParsedRipgrepLine | undefined> {
  let parsed: ParsedRipgrepLine | undefined;

  for (const pathEnd of findCountLineCandidates(line)) {
    const normalizedPath = await normalizeMatchedPath(
      root,
      line.slice(0, pathEnd)
    );

    if (normalizedPath !== undefined) {
      parsed = {
        path: normalizedPath,
        pathEnd,
        separator: ":"
      };
    }
  }

  return parsed;
}

function findTextLineCandidates(
  line: string
): Array<{ readonly pathEnd: number; readonly separator: ":" | "-" }> {
  const candidates: Array<{
    readonly pathEnd: number;
    readonly separator: ":" | "-";
  }> = [];

  for (let index = 0; index < line.length; index += 1) {
    const separator = line[index];
    if (separator !== ":" && separator !== "-") {
      continue;
    }

    const digitsStart = index + 1;
    const digitsEnd = readDigitsEnd(line, digitsStart);
    if (digitsEnd === digitsStart || line[digitsEnd] !== separator) {
      continue;
    }

    candidates.push({ pathEnd: index, separator });
  }

  return candidates;
}

function findCountLineCandidates(line: string): number[] {
  const candidates: number[] = [];

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== ":") {
      continue;
    }

    const digitsStart = index + 1;
    const digitsEnd = readDigitsEnd(line, digitsStart);
    if (digitsEnd === digitsStart || digitsEnd !== line.length) {
      continue;
    }

    candidates.push(index);
  }

  return candidates;
}

function readDigitsEnd(line: string, start: number): number {
  let index = start;

  while (index < line.length && isAsciiDigit(line[index] ?? "")) {
    index += 1;
  }

  return index;
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
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

async function waitForFallbackOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timedOut: { readonly value: boolean },
  timeoutSeconds: number
): Promise<T> {
  if (signal.aborted) {
    throw createFallbackAbortError(timedOut.value, timeoutSeconds);
  }

  return await new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(createFallbackAbortError(timedOut.value, timeoutSeconds));

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
  timeoutSeconds: number
): void {
  if (!signal.aborted) {
    return;
  }

  throw createFallbackAbortError(timedOut.value, timeoutSeconds);
}

function createFallbackAbortError(
  timedOut: boolean,
  timeoutSeconds: number
): GrepToolExecutionError {
  return new GrepToolExecutionError(
    timedOut
      ? `grep timed out after ${timeoutSeconds} seconds`
      : "grep was aborted",
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

function computeGrepStats(
  lines: readonly string[],
  outputMode: GrepOutputMode
): { readonly numFiles: number; readonly numMatches: number } {
  if (outputMode === "files_with_matches") {
    const files = new Set(lines.filter((line) => line.length > 0));

    return {
      numFiles: files.size,
      numMatches: files.size
    };
  }

  if (outputMode === "count") {
    const countEntries = lines.map((line) => {
      const countSeparator = findNormalizedCountPathEnd(line);
      const count = Number.parseInt(line.slice(countSeparator + 1), 10);

      return {
        file: line.slice(0, countSeparator),
        count: Number.isNaN(count) ? 0 : count
      };
    });

    return {
      numFiles: countEntries.length,
      numMatches: countEntries.reduce((total, entry) => total + entry.count, 0)
    };
  }

  const files = new Set<string>();
  let contentMatches = 0;

  for (const line of lines) {
    const parsed = findNormalizedTextLineCandidate(line);
    const separator = parsed?.separator ?? ":";
    const pathEnd = parsed?.pathEnd ?? -1;
    const file = pathEnd < 0 ? line : line.slice(0, pathEnd);

    if (file.length > 0) {
      files.add(file);
    }

    if (separator === ":") {
      contentMatches += 1;
    }
  }

  return {
    numFiles: files.size,
    numMatches: contentMatches
  };
}

function findNormalizedCountPathEnd(line: string): number {
  const candidates = findCountLineCandidates(line);

  return candidates.at(-1) ?? line.lastIndexOf(":");
}

function findNormalizedTextLineCandidate(
  line: string
): { readonly pathEnd: number; readonly separator: ":" | "-" } | undefined {
  return findTextLineCandidates(line).at(-1);
}

function splitTextLines(text: string): string[] {
  const lines = text.split(/\r?\n/u);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function getLineStartOffsets(lines: readonly string[]): number[] {
  const offsets: number[] = [];
  let currentOffset = 0;

  for (const line of lines) {
    offsets.push(currentOffset);
    currentOffset += line.length + 1;
  }

  return offsets;
}

function findLineIndex(lineStarts: readonly number[], offset: number): number {
  let selected = 0;

  for (const [index, lineStart] of lineStarts.entries()) {
    if (lineStart > offset) {
      break;
    }

    selected = index;
  }

  return selected;
}

function toTinyglobbyPattern(pattern: string): string {
  return hasPathSeparator(pattern) ? pattern : `**/${pattern}`;
}

function hasPathSeparator(pattern: string): boolean {
  return /[\\/]/u.test(pattern);
}

function hasUnescaped(value: string, character: string): boolean {
  let escaped = false;

  for (const current of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (current === "\\") {
      escaped = true;
      continue;
    }

    if (current === character) {
      return true;
    }
  }

  return false;
}

function isGitInternalPath(projectPath: string): boolean {
  return splitPathSegments(projectPath).some((segment) => segment === ".git");
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
  result: RipgrepBackendResult,
  extraMetadata: Readonly<Record<string, unknown>> = {}
): GrepToolExecutionError {
  return new GrepToolExecutionError(message, {
    backend: "ripgrep",
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    ...extraMetadata
  });
}

function trimTrailingNewline(output: string): string {
  return output.replace(/\r?\n$/u, "");
}

function readOutputMode(value: unknown): GrepOutputMode | undefined {
  if (value === undefined) {
    return "content";
  }

  if (
    value === "content" ||
    value === "files_with_matches" ||
    value === "count"
  ) {
    return value;
  }

  return undefined;
}

function readOptionalInteger(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }

  return value;
}

function readInteger(value: unknown, fallback: number): number | undefined {
  if (value === undefined) {
    return fallback;
  }

  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
