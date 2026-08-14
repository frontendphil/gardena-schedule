import { eq, isNull, or } from "drizzle-orm"

import { db } from "../db"
import { settings, valves } from "../db/schema"
import { getSensor, getValves } from "./store"

/**
 * Mirrors the valves the API reports into the `valves` table.
 *
 * Only `apiName` and `lastSeenAt` are ever overwritten — renames, moisture
 * overrides, ordering and visibility belong to the user. Valves that stop being
 * reported are deliberately left in place so a gateway blip cannot cascade-delete
 * the schedule steps that reference them.
 */
export const syncValves = () => {
  const reported = getValves()

  if (reported.length === 0) return

  const existing = new Set(
    db
      .select({ id: valves.id })
      .from(valves)
      .all()
      .map((row) => row.id)
  )

  const now = new Date()

  db.transaction((tx) => {
    let nextSortOrder = existing.size

    for (const valve of reported) {
      if (existing.has(valve.id)) {
        tx.update(valves)
          .set({ apiName: valve.name, lastSeenAt: now })
          .where(eq(valves.id, valve.id))
          .run()
      } else {
        tx.insert(valves)
          .values({
            id: valve.id,
            apiName: valve.name,
            sortOrder: nextSortOrder++,
            lastSeenAt: now,
          })
          .run()
      }
    }
  })
}

/**
 * Points the moisture gate at a discovered sensor the first time one shows up, so
 * requirement 5 works without the user having to pick an id out of a list.
 */
export const syncSensorSelection = () => {
  const sensor = getSensor()

  if (sensor == null) return

  db.update(settings)
    .set({ sensorId: sensor.id })
    .where(or(isNull(settings.sensorId), eq(settings.sensorId, "")))
    .run()
}

export const syncFromStore = () => {
  syncValves()
  syncSensorSelection()
}
