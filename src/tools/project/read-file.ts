import { readFile, stat } from "node:fs/promises";
import type { ToolDefinition } from "../definition.js";
import { createToolErrorResult, createToolResult } from "../results.js";
import { resolveExistingProjectPath } from "./paths.js";

const defaultLimit = 200;
const maxLimit = 2000;

export interface ReadFileToolInput {
  readonly path: string;
  readonly offset?: number;
  readonly limit?: number;
}

interface NormalizedReadFileToolInput {
  readonly path: string;
  readonly offset: number;
  readonly limit: number;
}

export function createReadFileTool(): ToolDefinition {
  return {
    name: "read_file",
    description: "Read a UTF-8 text file from the local project.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Project-relative path to read."
        },
        offset: {
          type: "number",
          description: "Zero-based starting line.",
          default: 0,
          minimum: 0
        },
        limit: {
          type: "number",
          description: "Maximum number of lines to return.",
          default: defaultLimit,
          minimum: 1,
          maximum: maxLimit
        }
      },
      required: ["path"],
      additionalProperties: false
    },
    isReadOnly() {
      return true;
    },
    validateInput(input) {
      return validateReadFileToolInput(input);
    },
    async execute(input, context) {
      const validation = validateReadFileToolInput(input);

      if (!validation.ok) {
        return createToolErrorResult(
          `Invalid input for read_file: ${validation.error}`,
          { tool: "read_file" }
        );
      }

      const readInput = validation.value;
      let resolvedPath: string;

      try {
        resolvedPath = await resolveExistingProjectPath(
          context.cwd,
          readInput.path
        );
      } catch (error) {
        return createToolErrorResult(errorToMessage(error), {
          tool: "read_file"
        });
      }

      try {
        const fileStat = await stat(resolvedPath);

        if (fileStat.isDirectory()) {
          return createToolErrorResult(`Cannot read directory: ${resolvedPath}`, {
            tool: "read_file",
            resolvedPath
          });
        }

        const buffer = await readFile(resolvedPath);

        if (buffer.includes(0)) {
          return createToolErrorResult(
            `Cannot read binary file: ${resolvedPath}`,
            {
              tool: "read_file",
              resolvedPath,
              binary: true
            }
          );
        }

        const lines = splitTextLines(buffer.toString("utf8"));
        const selectedLines = lines.slice(
          readInput.offset,
          readInput.offset + readInput.limit
        );
        const output =
          selectedLines.length === 0
            ? `(no content in selected range for ${resolvedPath})`
            : selectedLines
                .map(
                  (line, index) =>
                    `${String(readInput.offset + index + 1).padStart(
                      6,
                      " "
                    )}\t${line}`
                )
                .join("\n");

        return createToolResult({
          output,
          metadata: {
            tool: "read_file",
            resolvedPath,
            offset: readInput.offset,
            limit: readInput.limit,
            lineCount: lines.length,
            returnedLineCount: selectedLines.length,
            truncated: readInput.offset + selectedLines.length < lines.length,
            binary: false
          }
        });
      } catch (error) {
        return createToolErrorResult(errorToMessage(error), {
          tool: "read_file",
          resolvedPath
        });
      }
    }
  };
}

function validateReadFileToolInput(input: unknown): {
  readonly ok: true;
  readonly value: NormalizedReadFileToolInput;
} | {
  readonly ok: false;
  readonly error: string;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "input must be an object" };
  }

  const candidate = input as Record<string, unknown>;
  const allowedKeys = new Set(["path", "offset", "limit"]);
  const unexpectedKey = Object.keys(candidate).find(
    (key) => !allowedKeys.has(key)
  );

  if (unexpectedKey !== undefined) {
    return { ok: false, error: `unexpected property: ${unexpectedKey}` };
  }

  if (typeof candidate.path !== "string" || candidate.path.trim().length === 0) {
    return { ok: false, error: "path must be a non-empty string" };
  }

  const offset = candidate.offset === undefined ? 0 : candidate.offset;
  if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) {
    return { ok: false, error: "offset must be an integer >= 0" };
  }

  const limit = candidate.limit === undefined ? defaultLimit : candidate.limit;
  if (
    typeof limit !== "number" ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maxLimit
  ) {
    return { ok: false, error: "limit must be an integer between 1 and 2000" };
  }

  return {
    ok: true,
    value: {
      path: candidate.path,
      offset,
      limit
    }
  };
}

function splitTextLines(text: string): string[] {
  const lines = text.split(/\r?\n/u);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
