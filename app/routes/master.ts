import { eq } from "drizzle-orm"
import { href, redirect } from "react-router"

import { db } from "../db"
import { settings } from "../db/schema"
import { abortActiveRun } from "../scheduler/runner"
import type { Route } from "./+types/master"
import { requirePage } from "./guard"

/**
 * Requirement 4: the global on/off switch for every schedule.
 *
 * A resource route rather than a page action so the switch can live in the header
 * on every screen and return the user to where they were.
 */
export const action = async ({ request }: Route.ActionArgs) => {
  await requirePage(request)

  const formData = await request.formData()
  const enabled = formData.get("enabled") === "on"

  db.update(settings)
    .set({ masterEnabled: enabled })
    .where(eq(settings.id, 1))
    .run()

  // Turning everything off should stop water flowing now, not at the end of the
  // current valve's duration.
  if (!enabled) await abortActiveRun()

  const returnTo = formData.get("returnTo")

  return redirect(
    typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : href("/")
  )
}

export const loader = () => redirect(href("/"))
