import { describe, expect, it } from "vitest";
import {
  resolveTuiColorMode,
  resolveTuiHeight,
  resolveTuiWidth
} from "../src/tui/index.js";

describe("TUI terminal helpers", () => {
  it("uses an explicit color mode before environment defaults", () => {
    expect(
      resolveTuiColorMode({
        explicit: "full",
        env: { NO_COLOR: "1" }
      })
    ).toBe("full");
  });

  it("disables colors when NO_COLOR is present and no explicit mode is set", () => {
    expect(resolveTuiColorMode({ env: { NO_COLOR: "" } })).toBe("none");
  });

  it("uses full color when no explicit mode or NO_COLOR is present", () => {
    expect(resolveTuiColorMode({ env: {} })).toBe("full");
  });

  it("reads NO_COLOR from process.env when called without options", () => {
    const originalNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";

    try {
      expect(resolveTuiColorMode()).toBe("none");
    } finally {
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
  });

  it("keeps positive terminal widths", () => {
    expect(resolveTuiWidth(80)).toBe(80);
  });

  it("falls back to the default width for missing or invalid terminal widths", () => {
    expect(resolveTuiWidth(undefined)).toBe(120);
    expect(resolveTuiWidth(0)).toBe(120);
    expect(resolveTuiWidth(-1)).toBe(120);
  });

  it("keeps positive terminal heights", () => {
    expect(resolveTuiHeight(36)).toBe(36);
  });

  it("falls back to the default height for missing or invalid terminal heights", () => {
    expect(resolveTuiHeight(undefined)).toBe(30);
    expect(resolveTuiHeight(0)).toBe(30);
    expect(resolveTuiHeight(-1)).toBe(30);
  });
});
