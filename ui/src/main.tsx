import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import "@fontsource/ibm-plex-sans/latin-ext-400.css";
import "@fontsource/ibm-plex-sans/latin-ext-500.css";
import "@fontsource/ibm-plex-sans/latin-ext-600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./global.css";
import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { useTranslation } from "react-i18next";
import { App as AntApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import itIT from "antd/locale/it_IT";
import esES from "antd/locale/es_ES";
import frFR from "antd/locale/fr_FR";
import ptBR from "antd/locale/pt_BR";
import { App } from "./App";
import { DeckProvider } from "./store";
import { Look, useReducedMotion, useThemeMode } from "./theme";
import { cssVars, themeConfig } from "./palette";
import { initLanguage } from "./i18n";

const ANTD_LOCALES = { en: enUS, it: itIT, es: esES, fr: frFR, pt: ptBR } as const;

function Root() {
  const { mode, setMode, dark } = useThemeMode();
  const { i18n } = useTranslation();
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    for (const [k, v] of Object.entries(cssVars(dark))) document.documentElement.style.setProperty(k, v);
  }, [dark]);
  return (
    <ConfigProvider theme={themeConfig(dark, reducedMotion)} locale={ANTD_LOCALES[i18n.language as keyof typeof ANTD_LOCALES] ?? enUS}>
      <Look.Provider value={{ dark, reducedMotion }}>
        <AntApp style={{ height: "100%" }}>
          <DeckProvider>
            <App themeMode={mode} setThemeMode={setMode} />
          </DeckProvider>
        </AntApp>
      </Look.Provider>
    </ConfigProvider>
  );
}

// The language first (it comes from Rust), so the panel never flashes in another one.
initLanguage().finally(() => createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>));
