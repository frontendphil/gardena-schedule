import { db } from "../db"
import { settings as settingsTable } from "../db/schema"
import { hasAccountCredentials } from "../gardena/account"
import { refreshSoilReading } from "../gardena/measure"
import { requirePage } from "./guard"

/**
 * Forces the soil sensor to measure now.
 *
 * Returns data rather than redirecting, and the dashboard posts here with a
 * fetcher. That is not a style preference: under Home Assistant Ingress the app
 * is mounted at `/api/hassio_ingress/<token>`, React Router applies that
 * basename when it builds a redirect, and the client applies it *again* when it
 * follows one — so "go back to the dashboard" landed on
 * `<prefix>/<prefix>` and Home Assistant answered 404. An action that stays put
 * has no redirect to mangle.
 */
export const action = async () => {
  await requirePage()

  if (!hasAccountCredentials()) return { outcome: "not-configured" as const }

  const current = db.select().from(settingsTable).get()!

  const outcome = await refreshSoilReading({
    sensorId: current.sensorId,
    maxAgeMinutes: current.maxReadingAgeMinutes,
    force: true,
  })

  return { outcome }
}
