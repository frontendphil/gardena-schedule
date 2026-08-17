import { db } from "../db"
import { settings as settingsTable } from "../db/schema"
import { createTranslate, resolveLanguage, type Translate } from "./index"

/**
 * A translator for server-side code — actions returning error messages, mainly.
 *
 * Kept out of `./index` on purpose: that module is imported by client
 * components, and this one reaches into the database.
 */
export const translatorFor = (request: Request): Translate => {
  const current = db.select().from(settingsTable).get()

  return createTranslate(
    resolveLanguage(current?.language, request.headers.get("Accept-Language"))
  )
}
