import type { PermissionOption } from "./types.js";

export const defaultPermissionOptions = [
  { label: "Allow once", decision: "allowed_once", tone: "success" },
  {
    label: "Always allow in this project",
    decision: "allowed_always",
    tone: "normal"
  },
  { label: "Deny", decision: "denied", tone: "danger" }
] as const satisfies readonly PermissionOption[];

export function clampPermissionSelection(index: number): number {
  return Math.min(Math.max(index, 0), defaultPermissionOptions.length - 1);
}
