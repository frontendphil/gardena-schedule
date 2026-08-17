import { createContext, useContext } from "react"

import { de } from "./de"

export const LANGUAGES = ["auto", "en", "de"] as const
export type LanguageSetting = (typeof LANGUAGES)[number]

/** Languages the UI actually has strings for. */
export type Language = "en" | "de"

export const LANGUAGE_LABELS: Record<LanguageSetting, string> = {
  auto: "Match my browser",
  en: "English",
  de: "Deutsch",
}

/**
 * Dictionaries are keyed by the English source string rather than by invented
 * ids. Two reasons: English needs no dictionary at all, and a key that has not
 * been translated yet renders as readable English instead of `settings.title`.
 * The cost is that editing English copy orphans its translation — acceptable at
 * this size, and `pnpm i18n:check` reports the orphans.
 */
const DICTIONARIES: Record<Language, Record<string, string>> = {
  en: {},
  de,
}

/**
 * Picks the language for a request.
 *
 * Home Assistant does not tell an Ingress add-on which language the user has
 * chosen, so "auto" falls back to what the browser asks for.
 */
export const resolveLanguage = (
  setting: string | null | undefined,
  acceptLanguage: string | null | undefined
): Language => {
  if (setting === "en" || setting === "de") return setting

  const preferred = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .find((tag) => tag != null && tag !== "")

  return preferred?.startsWith("de") ? "de" : "en"
}

export type Translate = (
  text: string,
  vars?: Record<string, string | number>
) => string

const interpolate = (
  text: string,
  vars?: Record<string, string | number>
) =>
  vars == null
    ? text
    : text.replace(/\{(\w+)\}/g, (whole, name) =>
        name in vars ? String(vars[name]) : whole
      )

export const createTranslate =
  (language: Language): Translate =>
  (text, vars) =>
    interpolate(DICTIONARIES[language][text] ?? text, vars)

const LanguageContext = createContext<Language>("en")

export const LanguageProvider = LanguageContext.Provider

/**
 * `t("Schedule enabled")` — the argument is the English text, so a component
 * reads the same whether or not you speak the other language.
 */
export const useT = (): Translate => createTranslate(useContext(LanguageContext))

export const useLanguage = () => useContext(LanguageContext)

/** BCP-47 tag for `Intl`, so dates read the way the language expects. */
export const localeFor = (language: Language) =>
  language === "de" ? "de-DE" : "en-GB"

export const useLocale = () => localeFor(useLanguage())
