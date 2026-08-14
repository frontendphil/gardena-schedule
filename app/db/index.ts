import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import * as schema from "./schema"

const databasePath = resolve(process.env.DATABASE_PATH ?? "./data/gardena.db")

mkdirSync(dirname(databasePath), { recursive: true })

const sqlite = new Database(databasePath)

// WAL keeps loaders reading while the scheduler writes; `foreign_keys` is off by
// default in SQLite and our cascades depend on it.
sqlite.pragma("journal_mode = WAL")
sqlite.pragma("foreign_keys = ON")

export const db = drizzle(sqlite, { schema })

let migrated = false

/**
 * Applies pending migrations and guarantees the singleton settings row exists.
 * Called once from the runtime bootstrap before anything reads the database.
 */
export const migrateDatabase = () => {
  if (migrated) return

  migrate(db, { migrationsFolder: resolve("./drizzle") })

  db.insert(schema.settings).values({ id: 1 }).onConflictDoNothing().run()

  migrated = true
}

export { schema }
