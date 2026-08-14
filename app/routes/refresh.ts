import { href, redirect } from "react-router"

import { resyncFromRest } from "../gardena/socket"
import { syncFromStore } from "../gardena/sync"
import type { Route } from "./+types/refresh"
import { requirePage } from "./guard"

/**
 * Re-reads device state from Gardena on demand.
 *
 * This cannot make the soil sensor take a new measurement — the API has no
 * command for that, so readings arrive whenever the sensor decides to report.
 * What it does do is re-pull whatever Gardena currently holds, which recovers
 * the display if the WebSocket has gone quiet without closing.
 *
 * Costs one API request per press, so it is a button rather than a poll.
 */
export const action = async ({ request }: Route.ActionArgs) => {
  await requirePage()

  try {
    await resyncFromRest()
    syncFromStore()
  } catch (error) {
    console.error("[refresh] could not re-read from Gardena", error)
  }

  const returnTo = (await request.formData()).get("returnTo")

  return redirect(
    typeof returnTo === "string" &&
      returnTo.startsWith("/") &&
      !returnTo.startsWith("//")
      ? returnTo
      : href("/")
  )
}

export const loader = () => redirect(href("/"))
