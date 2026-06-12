import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  getProjectSessionDir,
  resolveProjectPaths
} from "../config/index.js";
import type { QueryEngine } from "../engine/index.js";
import {
  createLatestPointer,
  createSessionId,
  createSessionSummary,
  deriveSessionSummary,
  getNowIso,
  sanitizeToolMetadata,
  validateSessionId,
  type ExportSessionTranscriptArgs,
  type LatestSessionPointer,
  type ListSessionsOptions,
  type SaveQueryEngineSnapshotArgs,
  type SaveSessionSnapshotArgs,
  type SessionBackend,
  type SessionSnapshot,
  type SessionStorageOptions,
  type SessionSummary
} from "./backend.js";
import {
  buildSessionRecords,
  parseSessionJsonl,
  reconstructSessionSnapshot,
  serializeSessionRecords
} from "./jsonl.js";
import { renderSessionTranscript } from "./transcript.js";

const LATEST_FILE_NAME = "latest.json";

export class FileSessionBackend implements SessionBackend {
  public constructor(private readonly options: SessionStorageOptions = {}) {}

  public async saveSnapshot(
    args: SaveSessionSnapshotArgs
  ): Promise<SessionSnapshot> {
    return saveSessionSnapshot({
      ...this.options,
      ...args
    });
  }

  public async loadLatest(
    cwd: string | URL
  ): Promise<SessionSnapshot | undefined> {
    return loadLatestSession(cwd, this.options);
  }

  public async loadById(
    cwd: string | URL,
    sessionId: string
  ): Promise<SessionSnapshot | undefined> {
    return loadSessionById(cwd, sessionId, this.options);
  }

  public async listRecent(
    cwd: string | URL,
    options: ListSessionsOptions = {}
  ): Promise<readonly SessionSummary[]> {
    return listRecentSessions(cwd, {
      ...this.options,
      ...options
    });
  }

  public async exportTranscript(
    args: ExportSessionTranscriptArgs
  ): Promise<string> {
    return exportSessionTranscript({
      ...this.options,
      ...args
    });
  }
}

export async function saveSessionSnapshot(
  args: SaveSessionSnapshotArgs
): Promise<SessionSnapshot> {
  const sessionId = validateSessionId(args.sessionId ?? createSessionId());
  const cwd = resolveProjectPaths(args.cwd, args).cwd;
  const sessionDir = getProjectSessionDir(cwd, args);
  const createdAt = args.createdAt ?? getNowIso(args);
  const updatedAt = args.updatedAt ?? createdAt;
  const messages = [...args.messages];
  const snapshot: SessionSnapshot = {
    sessionId,
    cwd,
    model: args.model,
    systemPrompt: args.systemPrompt,
    messages,
    ...(args.usage === undefined ? {} : { usage: args.usage }),
    toolMetadata: sanitizeToolMetadata(args.toolMetadata),
    createdAt,
    updatedAt,
    summary: deriveSessionSummary(messages),
    messageCount: messages.length,
    path: join(sessionDir, `session-${sessionId}.jsonl`)
  };

  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    snapshot.path,
    serializeSessionRecords(buildSessionRecords(snapshot)),
    "utf8"
  );
  await writeFile(
    join(sessionDir, LATEST_FILE_NAME),
    `${JSON.stringify(createLatestPointer(snapshot), null, 2)}\n`,
    "utf8"
  );

  return snapshot;
}

export async function loadLatestSession(
  cwd: string | URL,
  options: SessionStorageOptions = {}
): Promise<SessionSnapshot | undefined> {
  const sessionDir = getProjectSessionDir(cwd, options);
  const latestPath = join(sessionDir, LATEST_FILE_NAME);
  let pointer: LatestSessionPointer;

  try {
    pointer = parseLatestPointer(await readFile(latestPath, "utf8"), latestPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }

  const sessionPath = join(sessionDir, basename(pointer.path));
  try {
    const snapshot = await readSnapshotFile(sessionPath);
    if (snapshot.sessionId !== pointer.sessionId) {
      throw new Error(
        `${LATEST_FILE_NAME} points to ${pointer.sessionId}, but ${basename(sessionPath)} contains ${snapshot.sessionId}.`
      );
    }
    return snapshot;
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(
        `${LATEST_FILE_NAME} points to missing session file ${basename(sessionPath)}.`
      );
    }
    throw error;
  }
}

export async function loadSessionById(
  cwd: string | URL,
  sessionId: string,
  options: SessionStorageOptions = {}
): Promise<SessionSnapshot | undefined> {
  const value = validateSessionId(sessionId);
  const sessionPath = join(
    getProjectSessionDir(cwd, options),
    `session-${value}.jsonl`
  );

  try {
    return await readSnapshotFile(sessionPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

export async function listRecentSessions(
  cwd: string | URL,
  options: ListSessionsOptions = {}
): Promise<readonly SessionSummary[]> {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive integer.");
  }

  const sessionDir = getProjectSessionDir(cwd, options);
  let entries: readonly string[];
  try {
    entries = await readdir(sessionDir);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.startsWith("session-") || !entry.endsWith(".jsonl")) {
      continue;
    }

    try {
      const snapshot = await readSnapshotFile(join(sessionDir, entry));
      summaries.push(createSessionSummary(snapshot));
    } catch {
      continue;
    }
  }

  summaries.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  );
  return summaries.slice(0, limit);
}

export async function exportSessionTranscript(
  args: ExportSessionTranscriptArgs
): Promise<string> {
  const sessionId = validateSessionId(args.sessionId);
  const snapshot = await loadSessionById(args.cwd, sessionId, args);
  if (snapshot === undefined) {
    throw new Error(`Session ${sessionId} was not found.`);
  }

  const path = join(
    getProjectSessionDir(args.cwd, args),
    `transcript-${sessionId}.md`
  );
  await writeFile(path, renderSessionTranscript(snapshot.messages), "utf8");
  return path;
}

export async function saveQueryEngineSnapshot(
  args: SaveQueryEngineSnapshotArgs
): Promise<SessionSnapshot> {
  const engine: QueryEngine = args.engine;
  return saveSessionSnapshot({
    cwd: engine.getCwd(),
    model: engine.getModel(),
    systemPrompt: engine.getSystemPrompt(),
    messages: engine.getMessages(),
    toolMetadata: engine.getToolMetadata(),
    ...(args.usage === undefined ? {} : { usage: args.usage }),
    ...(args.sessionId === undefined ? {} : { sessionId: args.sessionId }),
    ...(args.createdAt === undefined ? {} : { createdAt: args.createdAt }),
    ...(args.updatedAt === undefined ? {} : { updatedAt: args.updatedAt }),
    ...(args.env === undefined ? {} : { env: args.env }),
    ...(args.homeDir === undefined ? {} : { homeDir: args.homeDir }),
    ...(args.now === undefined ? {} : { now: args.now })
  });
}

async function readSnapshotFile(path: string): Promise<SessionSnapshot> {
  const content = await readFile(path, "utf8");
  return reconstructSessionSnapshot(parseSessionJsonl(content, path), path);
}

function parseLatestPointer(content: string, path: string): LatestSessionPointer {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in ${basename(path)}.`);
  }

  if (!isRecord(value)) {
    throw new Error(`${LATEST_FILE_NAME} must contain an object.`);
  }

  return {
    sessionId: validateSessionId(readString(value, "sessionId")),
    path: readString(value, "path"),
    cwd: readString(value, "cwd"),
    model: readString(value, "model"),
    summary: readString(value, "summary"),
    messageCount: readPositiveOrZeroInteger(value, "messageCount"),
    createdAt: readString(value, "createdAt"),
    updatedAt: readString(value, "updatedAt")
  };
}

function readString(value: Record<string, unknown>, key: string): string {
  const field = value[key];
  if (typeof field !== "string") {
    throw new Error(`${LATEST_FILE_NAME} field ${key} must be a string.`);
  }
  return field;
}

function readPositiveOrZeroInteger(
  value: Record<string, unknown>,
  key: string
): number {
  const field = value[key];
  if (
    typeof field !== "number" ||
    !Number.isInteger(field) ||
    field < 0
  ) {
    throw new Error(
      `${LATEST_FILE_NAME} field ${key} must be a non-negative integer.`
    );
  }
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
