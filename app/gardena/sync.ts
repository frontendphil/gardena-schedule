import { eq, isNull, or } from "drizzle-orm"

import { db } from "../db"
import { locations, settings, valves } from "../db/schema"
import { getLocations, getSensor, getValves } from "./store"

/**
 * Gardena names an unused valve port `Valve 1` … `Valve 6` and reports it as
 * `state: OK` exactly like a connected one — the API gives us no way to know
 * whether anything is actually plugged in. A still-default name is the only
 * available signal, so it is used to pick the initial visibility and nothing
 * more: the guess is applied once, when the valve is first discovered, and the
 * Sprinklers page can override it permanently.
 */
const looksUnused = (apiName: string) => /^valve\s*\d+$/i.test(apiName.trim())

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
    for (const valve of reported) {
      if (existing.has(valve.id)) {
        tx.update(valves)
          .set({
            apiName: valve.name,
            locationId: valve.locationId || null,
            lastSeenAt: now,
          })
          .where(eq(valves.id, valve.id))
          .run()
      } else {
        tx.insert(valves)
          .values({
            id: valve.id,
            locationId: valve.locationId || null,
            apiName: valve.name,
            hidden: looksUnused(valve.name),
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

/** Mirrors location names so the UI can label sprinklers without the API. */
export const syncLocations = () => {
  const reported = getLocations()

  if (reported.length === 0) return

  db.transaction((tx) => {
    for (const location of reported) {
      tx.insert(locations)
        .values(location)
        .onConflictDoUpdate({
          target: locations.id,
          set: { name: location.name },
        })
        .run()
    }
  })
}

export const syncFromStore = () => {
  syncLocations()
  syncValves()
  syncSensorSelection()
}
