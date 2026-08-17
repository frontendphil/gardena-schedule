/**
 * Reports drift between the German dictionary and the strings the UI actually
 * uses.
 *
 *   node scripts/check-i18n.mjs
 *
 * Dictionaries are keyed by the English source string, so editing English copy
 * silently orphans its translation and the UI quietly falls back to English.
 * This finds both directions: keys nobody asks for any more, and `t(...)` calls
 * with no German.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })

const sources = walk("app").filter(
  (file) => /\.tsx?$/.test(file) && !file.includes("/i18n/")
)

// t("…") / t('…') / t(`…`), single argument or with interpolation vars.
const CALL = /\bt\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g

const used = new Set()

for (const file of sources) {
  const text = readFileSync(file, "utf8")
  for (const match of text.matchAll(CALL)) {
    used.add(match[2].replace(/\\"/g, '"').replace(/\\'/g, "'"))
  }
}

/**
 * The dictionary is imported rather than parsed out of the file. An earlier
 * version fell back to a regex when the import failed, and the two disagreed by
 * one key — a check that can quietly produce the wrong answer is worse than no
 * check, so this fails loudly instead. Node 24 strips the types natively.
 */
let de
try {
  ;({ de } = await import("../app/i18n/de.ts"))
} catch (error) {
  console.error("Could not load app/i18n/de.ts:", error.message)
  console.error("Node must be able to import TypeScript directly (Node 24+).")
  process.exit(1)
}

const translated = new Set(Object.keys(de))

/**
 * Keys reached through a variable — `t(label)` over a nav list, `t(LABELS[code])`
 * — are invisible to a regex over source text. Listing them keeps the report
 * meaningful instead of permanently noisy.
 */
const DYNAMIC_KEYS = new Set([
  "Dashboard",
  "Schedules",
  "Sprinklers",
  "Settings",
  "Match my browser",
  // DAY_NAMES, rendered as t(day)
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
])

/** Endonyms: a language is always named in its own language. */
const NEVER_TRANSLATED = new Set(["English", "Deutsch"])

for (const key of DYNAMIC_KEYS) used.add(key)

const untranslated = [...used]
  .filter((key) => !translated.has(key) && !NEVER_TRANSLATED.has(key))
  .sort()
const orphaned = [...translated].filter((key) => !used.has(key)).sort()

console.log(`strings used in the UI : ${used.size}`)
console.log(`german keys            : ${translated.size}`)

if (untranslated.length > 0) {
  console.log(
    `\nNo German (${untranslated.length}) — these render in English.` +
      " Add them to app/i18n/de.ts:"
  )
  for (const key of untranslated) console.log(`  ${JSON.stringify(key)}`)
}

if (orphaned.length > 0) {
  console.log(
    `\nOrphaned (${orphaned.length}) — translated but never used.` +
      "\nUsually the English text was edited without updating the key, which makes" +
      "\nthat string silently fall back to English. Update or delete these:"
  )
  for (const key of orphaned) console.log(`  ${JSON.stringify(key)}`)
}

if (untranslated.length === 0 && orphaned.length === 0) {
  console.log("\nDictionary and UI agree.")
  process.exit(0)
}

// Drift is a failure. It never breaks the build or shows an error to a user, so
// nothing else would ever catch it.
process.exit(1)
