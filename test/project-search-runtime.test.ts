import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RipgrepBackendResult } from "../src/tools/index.js";
import {
  createFallbackAbortSignal,
  gitInternalGlobExcludes,
  isInsideGitRepository,
  isRipgrepBackendCannotRun,
  normalizeMatchedPath,
  normalizeMatchedPathList,
  normalizeMatchedPaths,
  throwIfAbortedOrTimedOut,
  toTinyglobbyPattern,
  waitForFallbackOperation
} from "../src/tools/project/search/index.js";

async function makeTempProject(prefix: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), prefix));
}

async function removeTempProject(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

function createAbortError(
  timedOut: boolean,
  units: number
): Error & { readonly timedOut: boolean; readonly aborted: boolean } {
  return Object.assign(
    new Error(timedOut ? `timed out after ${units}` : "aborted"),
    {
      timedOut,
      aborted: !timedOut
    }
  );
}

function createRipgrepResult(
  overrides: Partial<RipgrepBackendResult> = {}
): RipgrepBackendResult {
  return {
    backend: "ripgrep",
    stdout: "",
    stderr: "",
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    ...overrides
  };
}

describe("project search fallback runtime", () => {
  it("maps pre-aborted caller signals to abort errors", () => {
    const controller = new AbortController();
    controller.abort();

    const runtime = createFallbackAbortSignal(10_000, controller.signal);

    try {
      expect(() =>
        throwIfAbortedOrTimedOut(runtime, (timedOut) =>
          createAbortError(timedOut, 10_000)
        )
      ).toThrow("aborted");
    } finally {
      runtime.cleanup();
    }
  });

  it("maps fallback timeouts to timeout errors", async () => {
    const runtime = createFallbackAbortSignal(1);

    try {
      await expect(
        waitForFallbackOperation(
          new Promise<string>(() => undefined),
          runtime,
          (timedOut) => createAbortError(timedOut, 1)
        )
      ).rejects.toMatchObject({
        message: "timed out after 1",
        timedOut: true,
        aborted: false
      });
    } finally {
      runtime.cleanup();
    }
  });

  it("removes caller abort listeners during cleanup", () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");

    const runtime = createFallbackAbortSignal(10_000, controller.signal);
    runtime.cleanup();

    expect(add).toHaveBeenCalledWith("abort", expect.any(Function), {
      once: true
    });
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("waits for successful fallback operations", async () => {
    const runtime = createFallbackAbortSignal(10_000);

    try {
      await expect(
        waitForFallbackOperation(
          Promise.resolve("ok"),
          runtime,
          (timedOut) => createAbortError(timedOut, 10_000)
        )
      ).resolves.toBe("ok");
    } finally {
      runtime.cleanup();
    }
  });

  it("removes operation abort listeners after a successful operation", async () => {
    const runtime = createFallbackAbortSignal(10_000);
    const remove = vi.spyOn(runtime.signal, "removeEventListener");

    try {
      await waitForFallbackOperation(
        Promise.resolve("ok"),
        runtime,
        (timedOut) => createAbortError(timedOut, 10_000)
      );
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    } finally {
      runtime.cleanup();
    }
  });
});

describe("project search git helpers", () => {
  it("detects git repositories with directory markers", async () => {
    const cwd = await makeTempProject("openharness-search-git-dir-");

    try {
      mkdirSync(join(cwd, ".git"));
      mkdirSync(join(cwd, "src"));

      await expect(isInsideGitRepository(join(cwd, "src"))).resolves.toBe(true);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("detects git worktrees with file markers", async () => {
    const cwd = await makeTempProject("openharness-search-git-file-");

    try {
      writeFileSync(join(cwd, ".git"), "gitdir: ../real-git\n", "utf8");
      mkdirSync(join(cwd, "src"));

      await expect(isInsideGitRepository(join(cwd, "src"))).resolves.toBe(true);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("returns false outside git repositories", async () => {
    const cwd = await makeTempProject("openharness-search-not-git-");

    try {
      await expect(isInsideGitRepository(cwd)).resolves.toBe(false);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("exports the forced git internal excludes used by project search tools", () => {
    expect(gitInternalGlobExcludes).toEqual(["!.git/**", "!**/.git/**"]);
  });
});

describe("project search match helpers", () => {
  it("normalizes matched paths and sorts deterministic output", async () => {
    const cwd = await makeTempProject("openharness-search-matches-");

    try {
      mkdirSync(join(cwd, "src"));
      writeFileSync(join(cwd, "b.txt"), "b\n", "utf8");
      writeFileSync(join(cwd, "src", "a.txt"), "a\n", "utf8");

      await expect(
        normalizeMatchedPaths(cwd, ".\\b.txt\nsrc/a.txt\n")
      ).resolves.toEqual(["b.txt", "src/a.txt"]);
      await expect(
        normalizeMatchedPathList(cwd, ["src/a.txt", "b.txt"])
      ).resolves.toEqual(["b.txt", "src/a.txt"]);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("drops incomplete final lines when backend output was truncated", async () => {
    const cwd = await makeTempProject("openharness-search-truncated-");

    try {
      writeFileSync(join(cwd, "complete.txt"), "ok\n", "utf8");
      writeFileSync(join(cwd, "partial.txt"), "not returned\n", "utf8");

      await expect(
        normalizeMatchedPaths(cwd, "complete.txt\npartial.txt", {
          dropIncompleteFinalLine: true
        })
      ).resolves.toEqual(["complete.txt"]);
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("rejects git internal paths", async () => {
    const cwd = await makeTempProject("openharness-search-git-internal-");

    try {
      mkdirSync(join(cwd, ".git"));
      writeFileSync(join(cwd, ".git", "config"), "secret\n", "utf8");

      await expect(normalizeMatchedPath(cwd, ".git/config")).resolves.toBeUndefined();
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("drops paths escaping root through symlinks when symlinks are supported", async () => {
    const cwd = await makeTempProject("openharness-search-link-cwd-");
    const outside = await makeTempProject("openharness-search-link-out-");

    try {
      const outsideFile = join(outside, "outside.txt");
      const linkPath = join(cwd, "outside-link.txt");
      writeFileSync(outsideFile, "outside\n", "utf8");

      try {
        await symlink(outsideFile, linkPath, "file");
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          (error.code === "EPERM" || error.code === "EACCES")
        ) {
          return;
        }

        throw error;
      }

      await expect(normalizeMatchedPath(cwd, "outside-link.txt")).resolves.toBeUndefined();
    } finally {
      await removeTempProject(cwd);
      await removeTempProject(outside);
    }
  });

  it("drops matches that disappear before realpath", async () => {
    const cwd = await makeTempProject("openharness-search-missing-");

    try {
      await expect(normalizeMatchedPath(cwd, "missing.txt")).resolves.toBeUndefined();
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("allows matched file names containing dot-dot without traversal", async () => {
    const cwd = await makeTempProject("openharness-search-dotdot-name-");

    try {
      writeFileSync(join(cwd, "foo..bar"), "ok\n", "utf8");
      mkdirSync(join(cwd, "v1..v2"));
      writeFileSync(join(cwd, "v1..v2", "report.txt"), "ok\n", "utf8");

      await expect(normalizeMatchedPath(cwd, "foo..bar")).resolves.toBe("foo..bar");
      await expect(
        normalizeMatchedPath(cwd, "v1..v2/report.txt")
      ).resolves.toBe("v1..v2/report.txt");
    } finally {
      await removeTempProject(cwd);
    }
  });

  it("adapts bare fallback glob patterns to recursive tinyglobby patterns", () => {
    expect(toTinyglobbyPattern("*.ts")).toBe("**/*.ts");
    expect(toTinyglobbyPattern("src/*.ts")).toBe("src/*.ts");
    expect(toTinyglobbyPattern("src\\*.ts")).toBe("src\\*.ts");
  });
});

describe("project search ripgrep helpers", () => {
  it("detects spawn-like ripgrep backend failures", () => {
    expect(
      isRipgrepBackendCannotRun(
        createRipgrepResult({
          exitCode: null,
          signal: null,
          stderr: "spawn ENOENT"
        })
      )
    ).toBe(true);
  });

  it("does not classify timeout, abort, command failure, or truncated output as backend-unavailable", () => {
    expect(
      isRipgrepBackendCannotRun(
        createRipgrepResult({
          exitCode: null,
          signal: "SIGTERM",
          timedOut: true,
          stderr: "spawn ENOENT"
        })
      )
    ).toBe(false);
    expect(
      isRipgrepBackendCannotRun(
        createRipgrepResult({
          exitCode: null,
          signal: "SIGTERM",
          aborted: true,
          stderr: "spawn ENOENT"
        })
      )
    ).toBe(false);
    expect(
      isRipgrepBackendCannotRun(
        createRipgrepResult({
          exitCode: 2,
          signal: null,
          stderr: "spawn ENOENT"
        })
      )
    ).toBe(false);
    expect(
      isRipgrepBackendCannotRun(
        createRipgrepResult({
          exitCode: null,
          signal: null,
          stdoutTruncated: true,
          stderr: "spawn ENOENT"
        })
      )
    ).toBe(false);
  });
});
