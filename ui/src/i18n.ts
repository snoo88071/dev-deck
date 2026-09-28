/**
 * Five languages, and one rule for the whole app: the Windows display language
 * when the panel has it, English otherwise. In Tauri, Rust decides (locale.rs),
 * so the panel and the session descriptions always agree; in a plain browser
 * (demo) the browser's language plays that part.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { api, DEMO } from "./api";
import en from "./locales/en.json";
import it from "./locales/it.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pt from "./locales/pt.json";

export const LANGUAGES = [
  { code: "en", intl: "en-US" },
  { code: "it", intl: "it-IT" },
  { code: "es", intl: "es-ES" },
  { code: "fr", intl: "fr-FR" },
  { code: "pt", intl: "pt-BR" },
] as const;
export type Lang = (typeof LANGUAGES)[number]["code"];

/** The primary language only, like Rust: "de-DE" is English, not a fall-through to a second choice. */
export function resolve(tag: string | null | undefined): Lang {
  const code = (tag ?? "").split(/[-_]/)[0].toLowerCase();
  return LANGUAGES.find((l) => l.code === code)?.code ?? "en";
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, it: { translation: it }, es: { translation: es }, fr: { translation: fr }, pt: { translation: pt } },
  lng: resolve(navigator.language),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** Before the first render: the app's language from Rust (or the browser's, in the demo). */
export async function initLanguage(): Promise<void> {
  let lang = resolve(navigator.language);
  if (!DEMO) {
    try { lang = resolve(await api.appLanguage()); } catch { /* keep the browser's */ }
  }
  await i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
}

/** The BCP 47 tag for Intl (numbers, plurals) in the current language. */
export const intlTag = () => LANGUAGES.find((l) => l.code === i18n.language)?.intl ?? "en-US";

export default i18n;
