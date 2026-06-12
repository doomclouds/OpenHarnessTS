import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { ResolveOpenHarnessPathsOptions } from "../config/index.js";
import type { QueryEngine } from "../engine/index.js";
import {
  getMessageText,
  type ConversationMessage
} from "../messages/index.js";
import type { UsageSnapshot } from "../stream-events/index.js";

export interface SessionStorageOptions extends ResolveOpenHarnessPathsOptions {
  readonly now?: () => Date;
}

export interface SaveSessionSnapshotArgs extends SessionStorageOptions {
  readonly cwd: string | URL;
  readonly sessionId?: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly ConversationMessage[];
  readonly usage?: UsageSnapshot;
  readonly toolMetadata?: Readonly<Record<string, unknown>>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface LoadSessionOptions extends SessionStorageOptions {}

export interface ListSessionsOptions extends SessionStorageOptions {
  readonly limit?: number;
}

export interface ExportSessionTranscriptArgs extends SessionStorageOptions {
  readonly cwd: string | URL;
  readonly sessionId: string;
}

export interface SaveQueryEngineSnapshotArgs extends SessionStorageOptions {
  readonly engine: QueryEngine;
  readonly sessionId?: string;
  readonly usage?: UsageSnapshot;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly ConversationMessage[];
  readonly usage?: UsageSnapshot;
  readonly toolMetadata: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly summary: string;
  readonly messageCount: number;
  readonly path: string;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly summary: string;
  readonly messageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly path: string;
}

export interface LatestSessionPointer extends SessionSummary {}

export interface SessionBackend {
  saveSnapshot(args: SaveSessionSnapshotArgs): Promise<SessionSnapshot>;
  loadLatest(cwd: string | URL): Promise<SessionSnapshot | undefined>;
  loadById(
    cwd: string | URL,
    sessionId: string
  ): Promise<SessionSnapshot | undefined>;
  listRecent(
    cwd: string | URL,
    options?: ListSessionsOptions
  ): Promise<readonly SessionSummary[]>;
  exportTranscript(args: ExportSessionTranscriptArgs): Promise<string>;
}

export interface SessionStartRecord {
  readonly type: "session_start";
  readonly sessionId: string;
  readonly cwd: string;
  readonly model: string;
  readonly systemPrompt: string;
  readonly createdAt: string;
}

export interface SessionMessageRecord {
  readonly type: "message";
  readonly sessionId: string;
  readonly message: ConversationMessage;
}

export interface SessionUsageRecord {
  readonly type: "usage";
  readonly sessionId: string;
  readonly usage: UsageSnapshot;
}

export interface SessionToolMetadataRecord {
  readonly type: "tool_metadata";
  readonly sessionId: string;
  readonly toolMetadata: Readonly<Record<string, unknown>>;
}

export interface SessionSummaryRecord {
  readonly type: "session_summary";
  readonly sessionId: string;
  readonly summary: string;
  readonly messageCount: number;
  readonly updatedAt: string;
}

export type SessionRecord =
  | SessionStartRecord
  | SessionMessageRecord
  | SessionUsageRecord
  | SessionToolMetadataRecord
  | SessionSummaryRecord;

export function createSessionId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

export function validateSessionId(sessionId: string): string {
  if (sessionId.trim().length === 0) {
    throw new Error("sessionId must be non-empty.");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
    throw new Error(
      "sessionId must contain only letters, numbers, underscores, or hyphens."
    );
  }

  return sessionId;
}

export function getNowIso(options: SessionStorageOptions = {}): string {
  return (options.now?.() ?? new Date()).toISOString();
}

export function deriveSessionSummary(
  messages: readonly ConversationMessage[]
): string {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }

    const text = getMessageText(message).trim();
    if (text.length > 0) {
      return text.slice(0, 80);
    }
  }

  return "";
}

export function sanitizeJsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeJsonValue(item))
      .filter((item): item is Exclude<typeof item, undefined> => item !== undefined);
  }

  if (isPlainObject(value)) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const sanitizedValue = sanitizeJsonValue(item);
      if (sanitizedValue !== undefined) {
        sanitized[key] = sanitizedValue;
      }
    }
    return sanitized;
  }

  return String(value);
}

export function sanitizeToolMetadata(
  metadata: Readonly<Record<string, unknown>> = {}
): Readonly<Record<string, unknown>> {
  const sanitized = sanitizeJsonValue(metadata);
  return isPlainObject(sanitized) ? sanitized : {};
}

export function createSessionSummary(
  snapshot: SessionSnapshot
): SessionSummary {
  return {
    sessionId: snapshot.sessionId,
    cwd: snapshot.cwd,
    model: snapshot.model,
    summary: snapshot.summary,
    messageCount: snapshot.messageCount,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
    path: snapshot.path
  };
}

export function createLatestPointer(
  snapshot: SessionSnapshot
): LatestSessionPointer {
  return {
    ...createSessionSummary(snapshot),
    path: basename(snapshot.path)
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
