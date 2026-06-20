import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { DeepSeekApiClient } from "../src/index.js";
import { TuiRuntimeApp } from "../src/tui/index.js";

const hasDeepSeekKey =
  (process.env["DEEPSEEK_API_KEY"]?.trim() ?? "").length > 0;

describe.skipIf(!hasDeepSeekKey)("DeepSeek-backed TUI smoke", () => {
  it(
    "submits a real prompt and shows saved session feedback",
    { timeout: 45_000 },
    async () => {
      const root = await mkdtemp(join(tmpdir(), "openharness-tui-deepseek-"));
      const apiKey = process.env["DEEPSEEK_API_KEY"]?.trim();

      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error("DEEPSEEK_API_KEY is required for this gated suite.");
      }

      const client = new DeepSeekApiClient({
        apiKey,
        ...(process.env["DEEPSEEK_BASE_URL"] !== undefined
          ? { baseURL: process.env["DEEPSEEK_BASE_URL"] }
          : {}),
        ...(process.env["DEEPSEEK_MODEL"] !== undefined
          ? { model: process.env["DEEPSEEK_MODEL"] }
          : {}),
        maxTokens: 64,
        thinking: { type: "disabled" }
      });

      try {
        const { stdin, lastFrame } = render(
          <TuiRuntimeApp
            apiClient={client}
            model={client.model}
            cwd={join(root, "project")}
            homeDir={join(root, "home")}
            env={{}}
            sessionId="sess_tui_deepseek_smoke"
            maxTurns={1}
            colorMode="none"
            width={72}
          />
        );

        stdin.write("Reply with one short sentence about OpenHarness.");
        stdin.write("\r");

        await waitUntil(() => {
          const output = lastFrame() ?? "";
          expect(output).toContain("OpenHarness");
          expect(output).toContain("Session saved: sess_tui_deepseek_smoke");
          expect(output).not.toContain("\u001B[");
        }, 30_000);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );
});

async function waitUntil(
  assertion: () => void,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw lastError;
}
