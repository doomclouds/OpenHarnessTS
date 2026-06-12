import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  join,
  resolve,
  sep
} from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ensureOpenHarnessPaths,
  ensureProjectPaths,
  getProjectSessionDir,
  resolveOpenHarnessPaths,
  resolveProjectPaths
} from "../src/index.js";
import {
  resolveOpenHarnessPaths as resolveOpenHarnessPathsFromConfig,
  resolveProjectPaths as resolveProjectPathsFromConfig
} from "../src/config/index.js";

function digestPath(path: string): string {
  return createHash("sha1").update(path).digest("hex").slice(0, 12);
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("OpenHarness path resolution", () => {
  it("resolves default global paths from an injected home directory", () => {
    const homeDir = resolve("C:/Users/example");

    const paths = resolveOpenHarnessPaths({
      env: {},
      homeDir
    });

    expect(paths).toEqual({
      configDir: resolve(homeDir, ".openharness"),
      configFile: resolve(homeDir, ".openharness", "settings.json"),
      dataDir: resolve(homeDir, ".openharness", "data"),
      logsDir: resolve(homeDir, ".openharness", "logs"),
      sessionsDir: resolve(homeDir, ".openharness", "data", "sessions")
    });
  });

  it("honors config, data, and logs directory environment overrides", () => {
    const homeDir = resolve("C:/Users/example");
    const configDir = resolve("D:/openharness/config");
    const dataDir = resolve("D:/openharness/data");
    const logsDir = resolve("D:/openharness/logs");

    const paths = resolveOpenHarnessPaths({
      env: {
        OPENHARNESS_CONFIG_DIR: configDir,
        OPENHARNESS_DATA_DIR: dataDir,
        OPENHARNESS_LOGS_DIR: logsDir
      },
      homeDir
    });

    expect(paths.configDir).toBe(configDir);
    expect(paths.configFile).toBe(resolve(configDir, "settings.json"));
    expect(paths.dataDir).toBe(dataDir);
    expect(paths.logsDir).toBe(logsDir);
    expect(paths.sessionsDir).toBe(resolve(dataDir, "sessions"));
  });

  it("expands home-directory shorthand in overrides", () => {
    const homeDir = resolve("C:/Users/example");

    const paths = resolveOpenHarnessPaths({
      env: {
        OPENHARNESS_CONFIG_DIR: "~/.config-openharness",
        OPENHARNESS_DATA_DIR: "~\\data-openharness",
        OPENHARNESS_LOGS_DIR: "~/logs-openharness"
      },
      homeDir
    });

    expect(paths.configDir).toBe(resolve(homeDir, ".config-openharness"));
    expect(paths.dataDir).toBe(resolve(homeDir, "data-openharness"));
    expect(paths.logsDir).toBe(resolve(homeDir, "logs-openharness"));
  });
});

describe("Project path resolution", () => {
  it("resolves project-local paths and session storage paths", () => {
    const homeDir = resolve("C:/Users/example");
    const cwd = resolve("C:/Work/OpenHarnessTS");
    const sessionDir = resolve(
      homeDir,
      ".openharness",
      "data",
      "sessions",
      `${basename(cwd)}-${digestPath(cwd)}`
    );

    const paths = resolveProjectPaths(cwd, {
      env: {},
      homeDir
    });

    expect(paths).toEqual({
      cwd,
      projectConfigDir: resolve(cwd, ".openharness"),
      issueFile: resolve(cwd, ".openharness", "issue.md"),
      prCommentsFile: resolve(cwd, ".openharness", "pr_comments.md"),
      activeRepoContextFile: resolve(
        cwd,
        ".openharness",
        "autopilot",
        "active_repo_context.md"
      ),
      sessionDir
    });
    expect(getProjectSessionDir(cwd, { env: {}, homeDir })).toBe(sessionDir);
  });

  it("resolves relative cwd and file URL cwd inputs", () => {
    const homeDir = resolve("C:/Users/example");
    const relative = "relative-project";
    const resolvedRelative = resolve(relative);
    const fileUrlProject = resolve("C:/Work/file-url-project");

    expect(
      resolveProjectPaths(relative, {
        env: {},
        homeDir
      }).cwd
    ).toBe(resolvedRelative);

    expect(
      resolveProjectPaths(pathToFileURL(fileUrlProject), {
        env: {},
        homeDir
      }).cwd
    ).toBe(fileUrlProject);
  });

  it("uses different session directories for same-name projects in different parents", () => {
    const homeDir = resolve("C:/Users/example");
    const first = resolve("C:/Work/one/service");
    const second = resolve("C:/Work/two/service");

    const firstSession = resolveProjectPaths(first, { env: {}, homeDir }).sessionDir;
    const secondSession = resolveProjectPaths(second, { env: {}, homeDir }).sessionDir;

    expect(basename(firstSession)).toBe(`service-${digestPath(first)}`);
    expect(basename(secondSession)).toBe(`service-${digestPath(second)}`);
    expect(firstSession).not.toBe(secondSession);
  });
});

describe("Directory creation", () => {
  it("does not create directories from resolver functions", () => {
    const root = makeTempDir("openharness-paths-resolve-");
    const homeDir = join(root, "home");
    const cwd = join(root, "workspace", "project");

    try {
      const globalPaths = resolveOpenHarnessPaths({
        env: {},
        homeDir
      });
      const projectPaths = resolveProjectPaths(cwd, {
        env: {},
        homeDir
      });

      expect(existsSync(globalPaths.configDir)).toBe(false);
      expect(existsSync(globalPaths.dataDir)).toBe(false);
      expect(existsSync(globalPaths.logsDir)).toBe(false);
      expect(existsSync(globalPaths.sessionsDir)).toBe(false);
      expect(existsSync(projectPaths.projectConfigDir)).toBe(false);
      expect(existsSync(projectPaths.sessionDir)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates only directories through ensureOpenHarnessPaths", () => {
    const root = makeTempDir("openharness-paths-global-");
    const homeDir = join(root, "home");

    try {
      const paths = ensureOpenHarnessPaths({
        env: {},
        homeDir
      });

      expect(existsSync(paths.configDir)).toBe(true);
      expect(existsSync(paths.configFile)).toBe(false);
      expect(existsSync(paths.dataDir)).toBe(true);
      expect(existsSync(paths.logsDir)).toBe(true);
      expect(existsSync(paths.sessionsDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates project directories through ensureProjectPaths", () => {
    const root = makeTempDir("openharness-paths-project-");
    const homeDir = join(root, "home");
    const cwd = join(root, "workspace", "project");

    try {
      const paths = ensureProjectPaths(cwd, {
        env: {},
        homeDir
      });

      expect(existsSync(paths.projectConfigDir)).toBe(true);
      expect(existsSync(paths.issueFile)).toBe(false);
      expect(existsSync(paths.prCommentsFile)).toBe(false);
      expect(existsSync(paths.activeRepoContextFile)).toBe(false);
      expect(existsSync(paths.sessionDir)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Path validation", () => {
  it.each([
    ["empty cwd", ""],
    ["blank cwd", "   "]
  ])("rejects %s", (_label, cwd) => {
    expect(() =>
      resolveProjectPaths(cwd, {
        env: {},
        homeDir: resolve("C:/Users/example")
      })
    ).toThrow("cwd must be a non-empty path.");
  });

  it("rejects non-file URL cwd inputs", () => {
    expect(() =>
      resolveProjectPaths(new URL("https://example.com/project"), {
        env: {},
        homeDir: resolve("C:/Users/example")
      })
    ).toThrow("cwd URL must use the file: protocol.");
  });

  it.each([
    ["empty homeDir", ""],
    ["blank homeDir", "   "]
  ])("rejects %s", (_label, homeDir) => {
    expect(() =>
      resolveOpenHarnessPaths({
        env: {},
        homeDir
      })
    ).toThrow("homeDir must be a non-empty path.");
  });

  it("rejects empty environment override values", () => {
    expect(() =>
      resolveOpenHarnessPaths({
        env: {
          OPENHARNESS_CONFIG_DIR: " "
        },
        homeDir: resolve("C:/Users/example")
      })
    ).toThrow("OPENHARNESS_CONFIG_DIR must be a non-empty path when set.");
  });
});

describe("config root exports", () => {
  it("exports path foundation APIs from config and package roots", () => {
    const homeDir = resolve("C:/Users/example");
    const cwd = resolve("C:/Work/OpenHarnessTS");

    expect(resolveOpenHarnessPathsFromConfig({ env: {}, homeDir })).toEqual(
      resolveOpenHarnessPaths({ env: {}, homeDir })
    );
    expect(resolveProjectPathsFromConfig(cwd, { env: {}, homeDir })).toEqual(
      resolveProjectPaths(cwd, { env: {}, homeDir })
    );
  });

  it("uses platform separators in returned absolute path strings", () => {
    const homeDir = resolve("C:/Users/example");
    const paths = resolveOpenHarnessPaths({ env: {}, homeDir });

    expect(paths.configDir).toContain(sep);
  });
});
