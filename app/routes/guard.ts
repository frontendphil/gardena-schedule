import { ensureRuntime } from "../gardena/runtime"
import { requireSession } from "./session"

/**
 * The entry condition for anything that touches app state.
 *
 * Both halves matter. `requireSession` keeps the app closed to the internet, and
 * `ensureRuntime` guarantees migrations have run and the Gardena socket is up
 * before anything reads.
 *
 * Beneath the app layout this runs as route middleware, which is what makes the
 * ordering reliable — sibling loaders run in parallel, so a child route cannot
 * depend on the layout's own loader having booted the runtime first. Routes
 * outside the layout call it directly.
 *
 * Both operations are memoised, so this costs nothing after the first request.
 */
export const requirePage = async (request: Request) => {
  const session = await requireSession(request)

  await ensureRuntime()

  return session
}
