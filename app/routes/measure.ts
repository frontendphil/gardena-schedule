import { eq } from "drizzle-orm"
import { href, redirect } from "react-router"

import { db } from "../db"
import { settings as settingsTable } from "../db/schema"
import { hasAccountCredentials } from "../gardena/account"
import { refreshSoilReading } from "../gardena/measure"
import type { Route } from "./+types/measure"
import { requirePage } from "./guard"

/**
 * Forces the soil sensor to measure now.
 *
 * Needs the optional Husqvarna account credentials: this goes through Gardena's
 * own app API, because the public one has no command for it. Doubles as the way
 * to check those credentials actually work — the outcome comes back in the URL
 * so the dashboard can say what happened rather than failing silently at 06:00.
 */
export const action = async ({ request }: Route.ActionArgs) => {
  await requirePage()

  const back = href("/")

  if (!hasAccountCredentials()) {
    return redirect(`${back}?measured=not-configured`)
  }

  const current = db.select().from(settingsTable).get()!

  const outcome = await refreshSoilReading({
    sensorId: current.sensorId,
    maxAgeMinutes: current.maxReadingAgeMinutes,
    force: true,
  })

  return redirect(`${back}?measured=${outcome}`)
}

export const loader = () => redirect(href("/"))
