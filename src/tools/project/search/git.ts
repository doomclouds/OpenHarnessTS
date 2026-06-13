import { realpath, stat } from "node:fs/promises";
import path from "node:path";

export const gitInternalGlobExcludes = ["!.git/**", "!**/.git/**"] as const;

export function getGitInternalIgnoreGlobs(): string[] {
  return gitInternalGlobExcludes.map((glob) => glob.slice(1));
}

export async function isInsideGitRepository(root: string): Promise<boolean> {
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
