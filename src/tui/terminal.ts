import type { ColorMode } from "./model/index.js";

export interface ResolveTuiColorModeOptions {
  readonly explicit?: ColorMode;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const defaultTuiWidth = 120;
const defaultTuiHeight = 30;

export function resolveTuiColorMode(
  options: ResolveTuiColorModeOptions = {}
): ColorMode {
  const { explicit, env = process.env } = options;

  if (explicit !== undefined) {
    return explicit;
  }

  return Object.hasOwn(env, "NO_COLOR") ? "none" : "full";
}

export function resolveTuiWidth(columns: number | undefined): number {
  return columns === undefined || columns < 1 ? defaultTuiWidth : columns;
}

export function resolveTuiHeight(rows: number | undefined): number {
  return rows === undefined || rows < 1 ? defaultTuiHeight : rows;
}
