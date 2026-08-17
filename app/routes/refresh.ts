import { resyncFromRest } from "../gardena/socket"
import { syncFromStore } from "../gardena/sync"
import { requirePage } from "./guard"

/**
 * Re-reads device state from Gardena on demand.
 *
 * This cannot make the soil sensor take a new measurement — the API has no
 * command for that, so readings arrive whenever the sensor decides to report.
 * What it does do is re-pull whatever Gardena currently holds, which recovers
 * the display if the WebSocket has gone quiet without closing.
 *
 * Costs one API request per location, so it is a button rather than a poll.
 * Returns data rather than redirecting — see the note in `measure.ts`.
 */
export const action = async () => {
  await requirePage()

  try {
    await resyncFromRest()
    syncFromStore()
    return { ok: true as const }
  } catch (error) {
    console.error("[refresh] could not re-read from Gardena", error)
    return { ok: false as const }
  }
}
