import { useEffect, useState } from "react";

/** Follows Windows by default; a choice in the menu pins it, and is remembered. */
export type ThemeMode = "system" | "light" | "dark";

const KEY = "devdeck.theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function saved(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* no storage: follow the system */ }
  return "system";
}

export function useThemeMode() {
  const [mode, setModeState] = useState<ThemeMode>(saved);
  const [systemDark, setSystemDark] = useState(() => media().matches);
  useEffect(() => {
    const mq = media();
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const setMode = (m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem(KEY, m); } catch { /* remembered for this run only */ }
  };
  const dark = mode === "dark" || (mode === "system" && systemDark);
  return { mode, setMode, dark };
}
