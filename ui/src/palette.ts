/**
 * A canvas, panels of paper on it, ink, and three colors that only ever mean a state:
 * green is free or alive, amber is still (nobody working), red is danger.
 * What you can press is ink, never a color, so a color on screen always says something.
 * antd derives secondary text from the main one with transparency (45% fails WCAG AA),
 * so the text greys are set here; `npm run contrast` measures every text on every page in both themes.
 */
import type { ThemeConfig } from "antd";
import { theme } from "antd";
import { MONO, SANS } from "./components/bits";

/** The colors the pages draw with themselves (weight.tsx, the rows, global.css). */
export interface Ink {
  /** The page under the panels. */
  canvas: string;
  /** A panel: the lists and tables sit on it. */
  paper: string;
  /** A panel's header band (column titles) and an opened row. */
  head: string;
  /** A panel's edge. */
  edge: string;
  side: string;
  hover: string;
  line: string;
  border: string;
  ink: string;
  ink2: string;
  ink3: string;
  focus: string;
  green: string;
  greenFill: string;
  greenTint: string;
  amber: string;
  amberFill: string;
  amberTint: string;
  red: string;
  redTint: string;
}

const LIGHT: Ink = {
  canvas: "#f3f4f6", paper: "#ffffff", head: "#f9fafb", edge: "#e1e4e9",
  side: "#eceef1", hover: "#f5f6f8", line: "#eceef1", border: "#d3d7de",
  ink: "#161a21", ink2: "#454c59", ink3: "#5b6371", focus: "#161a21",
  green: "#13773a", greenFill: "#2e9a5c", greenTint: "#e5f3ea",
  amber: "#965507", amberFill: "#c97a1a", amberTint: "#fbf0e1",
  red: "#c22f33", redTint: "#fbeaea",
};

const DARK: Ink = {
  canvas: "#0f1115", paper: "#171a20", head: "#1d2128", edge: "#2a2f39",
  side: "#0b0c0f", hover: "#1e222a", line: "#242830", border: "#383e4a",
  ink: "#e8eaee", ink2: "#b7bdc8", ink3: "#9aa2b0", focus: "#e8eaee",
  green: "#4cc584", greenFill: "#3aa86c", greenTint: "#15291e",
  amber: "#f0a64a", amberFill: "#d08a34", amberTint: "#2b2012",
  red: "#f2777b", redTint: "#2e1618",
};

export const inkOf = (dark: boolean): Ink => (dark ? DARK : LIGHT);

/** The same colors as CSS variables, for global.css (focus ring, row hover, revealed actions). */
export function cssVars(dark: boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(inkOf(dark)).map(([k, v]) => [`--dd-${k}`, v]));
}

/**
 * The colors of weight: what the processes hold, drawn in proportion.
 * Amber means one thing, "still here, nobody working"; green is what is free.
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
  /** The meter under a memory figure, and its track. */
  meter: string;
  meterTrack: string;
  /** Text. */
  dormantText: string;
  freeText: string;
  /** The CPU line and its area. */
  line: string;
  area: string;
  lineStill: string;
  /** "Close" on an idle session: the one filled button of the row. */
  closeBg: string;
  closeFg: string;
}

export function weightColors(dark: boolean): Weight {
  const k = inkOf(dark);
  return dark
    ? {
        active: "#8f98aa", dormant: k.amberFill, process: "#566072", system: "#2b313c", free: "#1c3a2a", freeEdge: "#2f6b4a",
        meter: "#8f98aa", meterTrack: "#23272f",
        dormantText: k.amber, freeText: k.green, line: "#c3c9d3", area: "rgba(195,201,211,.14)", lineStill: "#3a4150",
        closeBg: k.amber, closeFg: "#1a1206",
      }
    : {
        active: "#363e4c", dormant: k.amberFill, process: "#8a93a3", system: "#d5d9e0", free: "#d3ecdc", freeEdge: "#9fd0b1",
        meter: "#363e4c", meterTrack: "#eceef1",
        dormantText: k.amber, freeText: k.green, line: "#3c4452", area: "rgba(60,68,82,.10)", lineStill: "#c3c8d0",
        closeBg: k.amber, closeFg: "#ffffff",
      };
}

/** Free RAM under this share of the total is tight (amber), under the second one short (red). */
export const TIGHT = 0.2;
export const SHORT = 0.08;
export function freeTone(available: number, total: number, dark: boolean): string {
  const k = inkOf(dark);
  const share = available / Math.max(1, total);
  return share < SHORT ? k.red : share < TIGHT ? k.amber : k.green;
}

export function themeConfig(dark: boolean, reducedMotion = false): ThemeConfig {
  const k = inkOf(dark);
  const token = {
    motion: !reducedMotion,
    fontFamily: SANS,
    fontFamilyCode: MONO,
    fontSize: 14,
    borderRadius: 6,
    borderRadiusLG: 10,
    borderRadiusSM: 4,
    // Ink is what you press: buttons, the selected page, links, focus.
    colorPrimary: k.ink,
    colorInfo: k.ink,
    colorLink: k.ink,
    colorLinkHover: k.ink2,
    colorPrimaryText: k.ink,
    colorPrimaryBg: k.hover,
    colorPrimaryBgHover: k.line,
    colorPrimaryBorder: k.border,
    colorPrimaryBorderHover: k.ink3,
    colorPrimaryHover: dark ? "#ffffff" : "#2e3542",
    colorPrimaryActive: dark ? "#cfd3da" : "#000000",
    colorSuccess: k.green,
    colorSuccessBg: k.greenTint,
    colorSuccessBorder: dark ? "#2a5a3f" : "#a9d6ba",
    colorWarning: k.amber,
    colorWarningBg: k.amberTint,
    colorWarningBorder: dark ? "#5a4223" : "#efd2a8",
    colorError: k.red,
    colorErrorBg: k.redTint,
    colorErrorBorder: dark ? "#5a2a2c" : "#f0c2c3",
    colorInfoBg: k.hover,
    colorInfoBorder: k.line,
    colorTextBase: k.ink,
    colorTextSecondary: k.ink2,
    colorTextTertiary: k.ink3,
    colorTextDescription: k.ink3,
    // antd's placeholder grey reads 2:1; a placeholder is still text someone has to read.
    colorTextPlaceholder: k.ink3,
    colorBgBase: k.paper,
    colorBgLayout: k.canvas,
    colorBgContainer: k.paper,
    colorBgElevated: dark ? "#1b1e25" : "#ffffff",
    colorBorder: k.border,
    colorBorderSecondary: k.line,
    colorFillTertiary: k.hover,
    colorFillQuaternary: k.hover,
    controlItemBgHover: k.hover,
    controlItemBgActive: k.hover,
    controlItemBgActiveHover: k.line,
    // On an ink button the text is the paper: white in light, near-black in dark.
    colorTextLightSolid: k.paper,
    boxShadow: dark ? "0 8px 28px rgba(0,0,0,.5), 0 0 0 1px #2a2f38" : "0 8px 28px rgba(22,26,33,.12), 0 0 0 1px #e3e6ea",
    boxShadowSecondary: dark ? "0 8px 28px rgba(0,0,0,.5), 0 0 0 1px #2a2f38" : "0 8px 28px rgba(22,26,33,.12), 0 0 0 1px #e3e6ea",
  };
  return {
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token,
    components: {
      Layout: { siderBg: k.side, lightSiderBg: k.side, bodyBg: k.canvas, headerBg: k.canvas },
      Menu: {
        itemBg: "transparent", subMenuItemBg: "transparent",
        itemColor: k.ink2, itemHoverColor: k.ink, itemHoverBg: dark ? "#14171c" : "#e3e6ea",
        // The page you are on is a sheet of paper, like the panels it shows.
        itemSelectedColor: k.ink, itemSelectedBg: k.paper,
        itemActiveBg: k.paper,
        itemHeight: 34, itemMarginInline: 8, itemBorderRadius: 6, iconSize: 15, collapsedIconSize: 16,
      },
      Table: {
        headerBg: k.head, headerColor: k.ink3, headerSplitColor: "transparent", headerBorderRadius: 0,
        rowHoverBg: k.hover, borderColor: k.line, cellPaddingBlockSM: 10, cellPaddingInlineSM: 12,
        rowExpandedBg: "transparent", expandIconBg: "transparent",
      },
      // White text on these: they keep white whatever the theme (the paper is dark in dark mode).
      // A running task is alive: its dot is green, rippling.
      Badge: { colorTextLightSolid: "#ffffff", colorError: dark ? "#d2393d" : k.red, colorInfo: k.greenFill, colorInfoTextHover: k.greenFill },
      Tooltip: { colorBgSpotlight: dark ? "#e8eaee" : "#1d2129", colorTextLightSolid: dark ? "#121419" : "#ffffff" },
      // On is alive: green, in both themes.
      Switch: { colorPrimary: k.greenFill, colorPrimaryHover: k.green, colorTextLightSolid: "#ffffff" },
      Tag: { defaultBg: k.hover, defaultColor: k.ink2 },
      Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none", fontWeight: 500 },
      Input: { activeShadow: "none" },
      Select: { activeOutlineColor: "transparent" },
      Modal: { titleFontSize: 16 },
      Message: { contentBg: dark ? "#1b1e25" : "#ffffff" },
    },
  };
}
