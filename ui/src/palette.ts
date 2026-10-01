/**
 * Cool greys, near-black text, one green. antd derives secondary text from the
 * main one with transparency (45% fails WCAG AA), so the text greys are set here;
 * `npm run contrast` measures every text on every page in both themes.
 */
import type { ThemeConfig } from "antd";
import { theme } from "antd";
import { MONO } from "./components/bits";

/** White on it is 5.6:1, and it is 5.0:1 on its own light tint. */
const GREEN = "#13773a";
/** The same green as text on the dark ground, where the green above is too dark to read. */
const GREEN_ON_DARK = "#4cc584";

const shared = {
  colorPrimary: GREEN,
  colorInfo: GREEN,
  /** antd red (#ff4d4f) gives white text 3.3:1; this one 5.0:1. */
  colorError: "#cf3337",
  borderRadius: 8,
  borderRadiusLG: 14,
  fontFamilyCode: MONO,
};

/**
 * The colors of weight (direction A): what the processes hold, drawn in proportion.
 * Amber is the one accent and means one thing, "still here, nobody working":
 * green is what is free. `npm run contrast` measures the text ones.
 */
export interface Weight {
  /** Strip segments. */
  active: string;
  dormant: string;
  /** Development processes outside the sessions. */
  process: string;
  system: string;
  free: string;
  freeEdge: string;
  /** The bar behind a row. */
  barActive: string;
  barDormant: string;
  /** Text. */
  dormantText: string;
  freeText: string;
  /** The CPU line. */
  line: string;
  lineStill: string;
  /** "Close" on an idle session: the one filled button of the row. */
  closeBg: string;
  closeFg: string;
}

export function weightColors(dark: boolean): Weight {
  return dark
    ? {
        active: "#8a93a5", dormant: "#d08a34", process: "#555e70", system: "#2e3440", free: "#1f4a33", freeEdge: "#2f6b4a",
        barActive: "rgba(232,234,238,.055)", barDormant: "rgba(240,166,74,.14)",
        dormantText: "#f0a64a", freeText: GREEN_ON_DARK, line: "#b7bdc8", lineStill: "#3a4150",
        closeBg: "#f0a64a", closeFg: "#1a1206",
      }
    : {
        active: "#3b4454", dormant: "#b86a0e", process: "#8a93a3", system: "#d3d8e0", free: "#cfe9d8", freeEdge: "#9ccfae",
        barActive: "rgba(59,68,84,.055)", barDormant: "rgba(184,106,14,.13)",
        dormantText: "#9a5708", freeText: GREEN, line: "#4a5363", lineStill: "#c3c8d0",
        closeBg: "#9a5708", closeFg: "#ffffff",
      };
}

export function themeConfig(dark: boolean, reducedMotion = false): ThemeConfig {
  return dark
    ? {
        algorithm: theme.darkAlgorithm,
        token: {
          ...shared,
          motion: !reducedMotion,
          colorSuccess: GREEN_ON_DARK,
          colorLink: GREEN_ON_DARK,
          colorPrimaryText: GREEN_ON_DARK,
          colorTextBase: "#e8eaee",
          colorTextSecondary: "#b7bdc8",
          colorTextTertiary: "#9aa3b2",
          colorTextDescription: "#9aa3b2",
          colorBgBase: "#0d1015",
          colorBgLayout: "#0d1015",
          colorBgContainer: "#161a21",
          colorBgElevated: "#1c212a",
          colorBorder: "#2e3440",
          colorBorderSecondary: "#232833",
        },
        components: {
          Menu: { itemSelectedColor: GREEN_ON_DARK },
          // Red tags write in colorError, which the danger buttons need dark (white on it):
          // on the tag's dark red ground it read 2.8:1, so tags get a lighter red of their own.
          Tag: { colorError: "#ff8a8c" },
        },
      }
    : {
        algorithm: theme.defaultAlgorithm,
        token: {
          ...shared,
          motion: !reducedMotion,
          colorSuccess: GREEN,
          colorLink: GREEN,
          colorWarning: "#b45309",
          colorWarningBg: "#fdf6ea",
          colorWarningBorder: "#f3d9b1",
          colorTextBase: "#151821",
          colorTextSecondary: "#454c59",
          colorTextTertiary: "#5b6473",
          colorTextDescription: "#5b6473",
          colorBgLayout: "#eef0f4",
          colorBgContainer: "#ffffff",
          colorBorder: "#d5d9e0",
          colorBorderSecondary: "#e4e7ec",
          // antd derives tints from the seed, and a dark green only reaches greyish ones: set them.
          colorPrimaryBg: "#e8f5ed",
          colorPrimaryBgHover: "#d4ecdd",
          colorPrimaryBorder: "#a9d6ba",
          colorSuccessBg: "#e8f5ed",
          colorSuccessBorder: "#a9d6ba",
          colorInfoBg: "#eef7f1",
          colorInfoBorder: "#bfe0cb",
        },
      };
}
