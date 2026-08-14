import { ensureRuntime } from "../gardena/runtime"

/**
 * The entry condition for anything that touches app state: migrations have run,
 * the Gardena socket is up and the valve table is populated.
 *
 * Beneath the app layout this runs as route middleware, which is what makes the
 * ordering reliable — sibling loaders run in parallel, so a child route cannot
 * depend on the layout's own loader having booted the runtime first. Routes
 * outside the layout call it directly.
 *
 * Memoised, so it costs nothing after the first request.
 */
export const requirePage = async () => {
  await ensureRuntime()
}
