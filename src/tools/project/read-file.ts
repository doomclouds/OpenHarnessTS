import { open, stat } from "node:fs/promises";
import { TextDecoder } from "node:util";
import type { ToolDefinition } from "../definition.js";
import { createToolErrorResult, createToolResult } from "../results.js";
import { resolveExistingProjectPath } from "./paths.js";

const defaultLimit = 200;
const maxLimit = 2000;
const maxReadFileBytes = 1024 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

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
          type: "integer",
          description: "Zero-based starting line.",
          default: 0,
          minimum: 0
        },
        limit: {
          type: "integer",
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

        if (!fileStat.isFile()) {
          return createToolErrorResult(
            `Cannot read non-regular file: ${resolvedPath}`,
            {
              tool: "read_file",
              resolvedPath
            }
          );
        }

        if (fileStat.size > maxReadFileBytes) {
          return createToolErrorResult(
            `File exceeds read_file size limit: ${resolvedPath}`,
            {
              tool: "read_file",
              resolvedPath,
              fileSizeBytes: fileStat.size,
              maxBytes: maxReadFileBytes
            }
          );
        }

        const cappedRead = await readCappedFile(resolvedPath, fileStat.size);

        if (!cappedRead.ok) {
          return createToolErrorResult(
            `File exceeds read_file size limit: ${resolvedPath}`,
            {
              tool: "read_file",
              resolvedPath,
              fileSizeBytes: cappedRead.fileSizeBytes,
              maxBytes: maxReadFileBytes
            }
          );
        }

        const { buffer } = cappedRead;

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

        const text = decodeUtf8Text(buffer);
        if (text === undefined) {
          return createToolErrorResult(
            `Cannot decode UTF-8 text file: ${resolvedPath}`,
            {
              tool: "read_file",
              resolvedPath,
              binary: true
            }
          );
        }

        const lines = splitTextLines(text);
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

async function readCappedFile(
  resolvedPath: string,
  statSizeBytes: number
): Promise<
  | {
      readonly ok: true;
      readonly buffer: Buffer;
    }
  | {
      readonly ok: false;
      readonly fileSizeBytes: number;
    }
> {
  const file = await open(resolvedPath, "r");

  try {
    const chunks: Buffer[] = [];
    let totalBytesRead = 0;
    let position = 0;

    while (totalBytesRead <= maxReadFileBytes) {
      const bytesRemainingBeforeOverflow =
        maxReadFileBytes + 1 - totalBytesRead;
      const buffer = Buffer.allocUnsafe(bytesRemainingBeforeOverflow);
      const { bytesRead } = await file.read(
        buffer,
        0,
        bytesRemainingBeforeOverflow,
        position
      );

      if (bytesRead === 0) {
        break;
      }

      chunks.push(buffer.subarray(0, bytesRead));
      totalBytesRead += bytesRead;
      position += bytesRead;

      if (totalBytesRead > maxReadFileBytes) {
        return {
          ok: false,
          fileSizeBytes: Math.max(statSizeBytes, totalBytesRead)
        };
      }
    }

    return {
      ok: true,
      buffer: Buffer.concat(chunks, totalBytesRead)
    };
  } finally {
    await file.close();
  }
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

function decodeUtf8Text(buffer: Buffer): string | undefined {
  try {
    return utf8Decoder.decode(buffer);
  } catch {
    return undefined;
  }
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
