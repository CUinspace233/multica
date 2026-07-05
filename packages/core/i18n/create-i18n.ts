import i18next, { type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";
import ICU from "i18next-icu";
import type { LocaleResources, SupportedLocale } from "./types";

// Both server (RSC) and client must call this with the SAME locale + resources
// to avoid hydration mismatch. `initAsync: false` forces synchronous init
// (renamed from `initImmediate` in i18next v25+); `useSuspense: false`
// prevents fallback rendering during hydration.
//
// i18next-icu adds `{count, plural, =0 {} =1 {} other {}}` support on top of
// i18next's native `{{var}}` interpolation. Required for the admin workspaces
// tab (`workspaces.members` / `workspaces.issues`) and any future copy that
// needs CLDR plural rules. Polyfills Intl.PluralRules via
// @formatjs/intl-pluralrules so it works on Node 18 too.
export function createI18n(
  locale: SupportedLocale,
  resources: Record<string, LocaleResources>,
): I18n {
  const instance = i18next.createInstance();
  instance
    .use(ICU)
    .use(initReactI18next)
    .init({
      lng: locale,
      fallbackLng: "en",
      resources,
      interpolation: { escapeValue: false },
      initAsync: false,
      react: { useSuspense: false },
    });
  return instance;
}
