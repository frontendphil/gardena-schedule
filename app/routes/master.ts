import { eq } from "drizzle-orm"

import { db } from "../db"
import { settings } from "../db/schema"
import { abortActiveRun } from "../scheduler/runner"
import type { Route } from "./+types/master"
import { requirePage } from "./guard"

/**
 * Requirement 4: the global on/off switch for every schedule.
 *
 * A resource route rather than a page action so the switch can live in the header
 * on every screen. Posted with a fetcher and returns data rather than
 * redirecting — see the note in `measure.ts`.
 */
export const action = async ({ request }: Route.ActionArgs) => {
  await requirePage()

  const formData = await request.formData()
  const enabled = formData.get("enabled") === "on"

  db.update(settings)
    .set({ masterEnabled: enabled })
    .where(eq(settings.id, 1))
    .run()

  // Turning everything off should stop water flowing now, not at the end of the
  // current valve's duration.
  if (!enabled) await abortActiveRun()

  return { ok: true as const }
}
