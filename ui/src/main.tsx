import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./global.css";
import "./i18n";
import { StrictMode, useEffect } from "react";
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
import { useThemeMode } from "./theme";
import { themeConfig } from "./palette";

const ANTD_LOCALES = { en: enUS, it: itIT, es: esES, fr: frFR, pt: ptBR } as const;

function Root() {
  const { mode, setMode, dark } = useThemeMode();
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <ConfigProvider theme={themeConfig(dark)} locale={ANTD_LOCALES[i18n.language as keyof typeof ANTD_LOCALES] ?? enUS}>
      <AntApp style={{ height: "100%" }}>
        <DeckProvider>
          <App themeMode={mode} setThemeMode={setMode} />
        </DeckProvider>
      </AntApp>
    </ConfigProvider>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);
