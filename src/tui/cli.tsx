import { render } from "ink";
import { createElement } from "react";
import type { ApiClient } from "../api/index.js";
import type { PermissionMode } from "../permissions/index.js";
import { TuiRuntimeApp } from "./components/index.js";
import type { ColorMode } from "./model/index.js";
import {
  resolveTuiColorMode,
  resolveTuiHeight,
  resolveTuiWidth
} from "./terminal.js";

export interface RunTuiCliOptions {
  readonly apiClient: ApiClient;
  readonly model: string;
  readonly cwd?: string | URL;
  readonly homeDir?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly permissionMode?: PermissionMode;
  readonly colorMode?: ColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly maxTurns?: number;
}

export async function runTuiCli(options: RunTuiCliOptions): Promise<void> {
  const colorMode = resolveTuiColorMode({
    ...(options.colorMode === undefined ? {} : { explicit: options.colorMode }),
    ...(options.env === undefined ? {} : { env: options.env })
  });
  const width = resolveTuiWidth(options.width ?? process.stdout.columns);
  const height = resolveTuiHeight(options.height ?? process.stdout.rows);
  let app: ReturnType<typeof render>;

  app = render(
    createElement(TuiRuntimeApp, {
      apiClient: options.apiClient,
      model: options.model,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.homeDir === undefined ? {} : { homeDir: options.homeDir }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.permissionMode === undefined
        ? {}
        : { permissionMode: options.permissionMode }),
      colorMode,
      width,
      height,
      ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
      onExitRequested() {
        app.unmount();
      }
    })
  );

  await app.waitUntilExit();
}
