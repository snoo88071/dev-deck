/**
 * Five languages. The default follows Windows (the webview's languages); a choice
 * in the menu pins it and is remembered. English fills any missing string.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import it from "./locales/it.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";

export const LANGUAGES = [
  { code: "en", label: "English", intl: "en-US" },
  { code: "it", label: "Italiano", intl: "it-IT" },
  { code: "es", label: "Español", intl: "es-ES" },
  { code: "fr", label: "Français", intl: "fr-FR" },
  { code: "pt", label: "Português (Brasil)", intl: "pt-BR" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

const KEY = "devdeck.lang";
const known = (x: string | null | undefined): x is Lang => LANGUAGES.some((l) => l.code === x);

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (known(saved)) return saved;
  } catch { /* no storage: follow the system */ }
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.slice(0, 2).toLowerCase();
    if (known(code)) return code;
  }
  return "en";
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it }, es: { translation: es }, fr: { translation: fr }, pt: { translation: pt } },
  lng: detect(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
document.documentElement.lang = i18n.language;

export function setLanguage(code: Lang) {
  i18n.changeLanguage(code);
  document.documentElement.lang = code;
  try { localStorage.setItem(KEY, code); } catch { /* remembered for this run only */ }
}

/** The BCP 47 tag for Intl (numbers, plurals) in the current language. */
export const intlTag = () => LANGUAGES.find((l) => l.code === i18n.language)?.intl ?? "en-US";

export default i18n;
