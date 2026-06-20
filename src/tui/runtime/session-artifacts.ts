import { dirname, join, win32 } from "node:path";
import type { SessionSnapshot } from "../../sessions/index.js";
import type { TuiSessionArtifacts } from "../model/index.js";

export interface TuiSessionArtifactExports {
  readonly latestPath?: string;
  readonly transcriptPath?: string;
  readonly markdownPath?: string;
}

export type TuiSessionArtifactExportResult =
  | string
  | TuiSessionArtifactExports
  | undefined;

export function createTuiSessionArtifacts(
  snapshot: SessionSnapshot,
  exportResult?: TuiSessionArtifactExportResult
): TuiSessionArtifacts {
  const exports = normalizeArtifactExports(exportResult);

  return {
    sessionId: snapshot.sessionId,
    latestPath: exports.latestPath ?? deriveLatestPath(snapshot.path),
    ...(exports.transcriptPath === undefined
      ? {}
      : { transcriptPath: exports.transcriptPath }),
    ...(exports.markdownPath === undefined
      ? {}
      : { markdownPath: exports.markdownPath })
  };
}

function normalizeArtifactExports(
  exportResult: TuiSessionArtifactExportResult
): TuiSessionArtifactExports {
  if (typeof exportResult === "string") {
    return {
      transcriptPath: exportResult
    };
  }

  return exportResult ?? {};
}

function deriveLatestPath(snapshotPath: string): string {
  if (snapshotPath.includes("\\")) {
    return win32.join(win32.dirname(snapshotPath), "latest.json");
  }

  return join(dirname(snapshotPath), "latest.json");
}
