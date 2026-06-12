import { basename } from "node:path";
import {
  deriveSessionSummary,
  sanitizeToolMetadata,
  validateSessionId,
  type SessionMessageRecord,
  type SessionRecord,
  type SessionSnapshot,
  type SessionStartRecord,
  type SessionSummaryRecord,
  type SessionToolMetadataRecord,
  type SessionUsageRecord
} from "./backend.js";

export function serializeSessionRecords(
  records: readonly SessionRecord[]
): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function parseSessionJsonl(
  content: string,
  path = "session JSONL"
): readonly SessionRecord[] {
  const records: SessionRecord[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.trim().length === 0) {
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(
        `Invalid JSONL in ${basename(path)} at line ${index + 1}`
      );
    }

    records.push(parseSessionRecord(value, index + 1, path));
  }

  return records;
}

export function buildSessionRecords(
  snapshot: SessionSnapshot
): readonly SessionRecord[] {
  const records: SessionRecord[] = [
    {
      type: "session_start",
      sessionId: snapshot.sessionId,
      cwd: snapshot.cwd,
      model: snapshot.model,
      systemPrompt: snapshot.systemPrompt,
      createdAt: snapshot.createdAt
    }
  ];

  for (const message of snapshot.messages) {
    records.push({
      type: "message",
      sessionId: snapshot.sessionId,
      message
    });
  }

  if (snapshot.usage !== undefined) {
    records.push({
      type: "usage",
      sessionId: snapshot.sessionId,
      usage: snapshot.usage
    });
  }

  records.push({
    type: "tool_metadata",
    sessionId: snapshot.sessionId,
    toolMetadata: sanitizeToolMetadata(snapshot.toolMetadata)
  });

  records.push({
    type: "session_summary",
    sessionId: snapshot.sessionId,
    summary: snapshot.summary,
    messageCount: snapshot.messageCount,
    updatedAt: snapshot.updatedAt
  });

  return records;
}

export function reconstructSessionSnapshot(
  records: readonly SessionRecord[],
  path = ""
): SessionSnapshot {
  const start = records.find(isSessionStartRecord);
  if (start === undefined) {
    throw new Error(`Session JSONL ${formatPath(path)}is missing session_start.`);
  }

  const sessionId = validateSessionId(start.sessionId);
  const messages: SessionMessageRecord["message"][] = [];
  let usage: SessionSnapshot["usage"];
  let toolMetadata: Readonly<Record<string, unknown>> = {};
  let summaryRecord: SessionSummaryRecord | undefined;

  for (const record of records) {
    if (record.sessionId !== sessionId) {
      throw new Error(
        `Session JSONL ${formatPath(path)}contains mismatched session id ${record.sessionId}.`
      );
    }

    switch (record.type) {
      case "session_start":
        break;
      case "message":
        messages.push(record.message);
        break;
      case "usage":
        usage = record.usage;
        break;
      case "tool_metadata":
        toolMetadata = sanitizeToolMetadata(record.toolMetadata);
        break;
      case "session_summary":
        summaryRecord = record;
        break;
    }
  }

  const summary = summaryRecord?.summary ?? deriveSessionSummary(messages);
  const messageCount = summaryRecord?.messageCount ?? messages.length;
  const updatedAt = summaryRecord?.updatedAt ?? start.createdAt;

  return {
    sessionId,
    cwd: start.cwd,
    model: start.model,
    systemPrompt: start.systemPrompt,
    messages,
    ...(usage === undefined ? {} : { usage }),
    toolMetadata,
    createdAt: start.createdAt,
    updatedAt,
    summary,
    messageCount,
    path
  };
}

function parseSessionRecord(
  value: unknown,
  lineNumber: number,
  path: string
): SessionRecord {
  if (!isRecord(value) || typeof value.type !== "string") {
    throwInvalidRecord(path, lineNumber, "record type is required.");
  }

  switch (value.type) {
    case "session_start":
      return parseSessionStartRecord(value, lineNumber, path);
    case "message":
      return parseSessionMessageRecord(value, lineNumber, path);
    case "usage":
      return parseSessionUsageRecord(value, lineNumber, path);
    case "tool_metadata":
      return parseSessionToolMetadataRecord(value, lineNumber, path);
    case "session_summary":
      return parseSessionSummaryRecord(value, lineNumber, path);
    default:
      throwInvalidRecord(path, lineNumber, `unknown record type ${value.type}.`);
  }
}

function parseSessionStartRecord(
  value: Record<string, unknown>,
  lineNumber: number,
  path: string
): SessionStartRecord {
  const sessionId = readString(value, "sessionId", lineNumber, path);
  return {
    type: "session_start",
    sessionId,
    cwd: readString(value, "cwd", lineNumber, path),
    model: readString(value, "model", lineNumber, path),
    systemPrompt: readString(value, "systemPrompt", lineNumber, path),
    createdAt: readString(value, "createdAt", lineNumber, path)
  };
}

function parseSessionMessageRecord(
  value: Record<string, unknown>,
  lineNumber: number,
  path: string
): SessionMessageRecord {
  const message = value.message;
  if (!isRecord(message)) {
    throwInvalidRecord(path, lineNumber, "message is required.");
  }

  return {
    type: "message",
    sessionId: readString(value, "sessionId", lineNumber, path),
    message: message as unknown as SessionMessageRecord["message"]
  };
}

function parseSessionUsageRecord(
  value: Record<string, unknown>,
  lineNumber: number,
  path: string
): SessionUsageRecord {
  const usage = value.usage;
  if (!isRecord(usage)) {
    throwInvalidRecord(path, lineNumber, "usage is required.");
  }

  return {
    type: "usage",
    sessionId: readString(value, "sessionId", lineNumber, path),
    usage: usage as SessionUsageRecord["usage"]
  };
}

function parseSessionToolMetadataRecord(
  value: Record<string, unknown>,
  lineNumber: number,
  path: string
): SessionToolMetadataRecord {
  const toolMetadata = value.toolMetadata;
  if (!isRecord(toolMetadata)) {
    throwInvalidRecord(path, lineNumber, "toolMetadata is required.");
  }

  return {
    type: "tool_metadata",
    sessionId: readString(value, "sessionId", lineNumber, path),
    toolMetadata: sanitizeToolMetadata(toolMetadata)
  };
}

function parseSessionSummaryRecord(
  value: Record<string, unknown>,
  lineNumber: number,
  path: string
): SessionSummaryRecord {
  const messageCount = value.messageCount;
  if (
    typeof messageCount !== "number" ||
    !Number.isInteger(messageCount) ||
    messageCount < 0
  ) {
    throwInvalidRecord(path, lineNumber, "messageCount must be a non-negative integer.");
  }

  return {
    type: "session_summary",
    sessionId: readString(value, "sessionId", lineNumber, path),
    summary: readString(value, "summary", lineNumber, path),
    messageCount,
    updatedAt: readString(value, "updatedAt", lineNumber, path)
  };
}

function readString(
  value: Record<string, unknown>,
  key: string,
  lineNumber: number,
  path: string
): string {
  const field = value[key];
  if (typeof field !== "string") {
    throwInvalidRecord(path, lineNumber, `${key} must be a string.`);
  }
  return field;
}

function isSessionStartRecord(
  record: SessionRecord
): record is SessionStartRecord {
  return record.type === "session_start";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwInvalidRecord(
  path: string,
  lineNumber: number,
  reason: string
): never {
  throw new Error(
    `Invalid session record in ${basename(path)} at line ${lineNumber}: ${reason}`
  );
}

function formatPath(path: string): string {
  return path.length === 0 ? "" : `${basename(path)} `;
}
