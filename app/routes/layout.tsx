import { useEffect } from "react"
import {
  Form,
  NavLink,
  Outlet,
  href,
  useLocation,
  useRevalidator,
  useSubmit,
} from "react-router"

import { Badge, Toggle, cx } from "../components/ui"
import { db } from "../db"
import { settings as settingsTable } from "../db/schema"
import { getConnectionState } from "../gardena/store"
import { getActiveRun } from "../scheduler/runner"
import type { Route } from "./+types/layout"
import { requirePage } from "./guard"

/**
 * Runs before every loader and action in this subtree, including this route's
 * own. Child loaders can therefore assume a signed-in session and a booted
 * runtime without repeating the check.
 */
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }) => {
    await requirePage(request)
  },
]

export const loader = async () => {
  const settings = db.select().from(settingsTable).get()!
  const connection = getConnectionState()

  return {
    masterEnabled: settings.masterEnabled,
    connected: connection.connected,
    activeRun: getActiveRun(),
  }
}

const NAV = [
  { to: href("/"), label: "Dashboard" },
  { to: href("/schedules"), label: "Schedules" },
  { to: href("/sprinklers"), label: "Sprinklers" },
  { to: href("/settings"), label: "Settings" },
]

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { masterEnabled, connected, activeRun } = loaderData
  const location = useLocation()
  const revalidator = useRevalidator()
  const submit = useSubmit()

  // The socket pushes valve state to the server, not the browser. Polling the
  // loader keeps the UI live; it costs nothing against the Gardena quota because
  // loaders only read the in-memory cache.
  useEffect(() => {
    const interval = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate()
    }, 15_000)

    return () => clearInterval(interval)
  }, [revalidator])

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">Garden</h1>
          {connected ? (
            <Badge tone="good">Connected</Badge>
          ) : (
            <Badge tone="bad">Offline</Badge>
          )}
          {activeRun != null && (
            <Badge tone="active">Watering · {activeRun.scheduleName}</Badge>
          )}
        </div>

        <Form
          method="post"
          action={href("/master")}
          className="flex items-center gap-3"
        >
          <input type="hidden" name="returnTo" value={location.pathname} />
          <span className="text-sm font-medium">All schedules</span>
          <Toggle
            name="enabled"
            checked={masterEnabled}
            onChange={(event) => submit(event.currentTarget.form)}
          />
        </Form>
      </header>

      {!masterEnabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          All schedules are switched off. Nothing will be watered until you turn
          them back on.
        </p>
      )}

      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-stone-200/60 p-1 dark:bg-stone-900">
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === href("/")}
            className={({ isActive }) =>
              cx(
                "flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm font-medium transition-colors",
                isActive
                  ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-100"
                  : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              )
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 space-y-6">
        <Outlet />
      </main>

      <footer className="flex justify-end pt-2">
        <Form method="post" action={href("/logout")}>
          <button
            type="submit"
            className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
          >
            Sign out
          </button>
        </Form>
      </footer>
    </div>
  )
}
