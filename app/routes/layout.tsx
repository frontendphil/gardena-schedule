import { useEffect } from "react"
import {
  NavLink,
  Outlet,
  href,
  useFetcher,
  useLocation,
  useNavigation,
  useRevalidator,
} from "react-router"

import { Badge, Toggle, cx } from "../components/ui"
import { LanguageProvider, createTranslate, resolveLanguage } from "../i18n"
import { db } from "../db"
import { settings as settingsTable } from "../db/schema"
import { getConnectionState } from "../gardena/store"
import { getActiveRun, schedulerDisabled } from "../scheduler/runner"
import type { Route } from "./+types/layout"
import { requirePage } from "./guard"

/**
 * Runs before every loader and action in this subtree, including this route's
 * own. Child loaders can therefore assume a booted runtime without repeating
 * the check.
 */
export const middleware: Route.MiddlewareFunction[] = [
  async () => {
    await requirePage()
  },
]

export const loader = async ({ request }: Route.LoaderArgs) => {
  const settings = db.select().from(settingsTable).get()!
  const connection = getConnectionState()

  return {
    // Resolved on the server and passed down, so the client hydrates with the
    // same language rather than re-deciding and mismatching the markup.
    language: resolveLanguage(
      settings.language,
      request.headers.get("Accept-Language")
    ),
    masterEnabled: settings.masterEnabled,
    connected: connection.connected,
    activeRun: getActiveRun(),
    schedulerOff: schedulerDisabled(),
  }
}

const NAV = [
  { to: href("/dashboard"), label: "Dashboard" },
  { to: href("/schedules"), label: "Schedules" },
  { to: href("/sprinklers"), label: "Sprinklers" },
  { to: href("/settings"), label: "Settings" },
]

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { masterEnabled, connected, activeRun, schedulerOff, language } =
    loaderData
  const t = createTranslate(language)
  const location = useLocation()
  const revalidator = useRevalidator()
  // A fetcher keeps the switch on whatever page it was pressed from; a
  // redirecting action would be re-prefixed under Ingress.
  const masterFetcher = useFetcher()
  const navigation = useNavigation()

  // Background revalidation must not flash the bar — only real user actions.
  const busy = navigation.state !== "idle"

  /**
   * Under Home Assistant Ingress the app is mounted at `/api/hassio_ingress/
   * <token>`, and navigating to the dashboard leaves the URL sitting on exactly
   * that with no trailing slash. Home Assistant routes
   * `/api/hassio_ingress/{token}/{path}`, which does not match without the
   * slash — so the page works until you reload it, and then 404s. Putting the
   * slash back costs nothing and only ever applies when a basename is set.
   */
  useEffect(() => {
    const basename = window.__reactRouterContext?.basename

    if (basename == null || basename === "/") return
    if (window.location.pathname !== basename) return

    window.history.replaceState(
      window.history.state,
      "",
      `${basename}/${window.location.search}${window.location.hash}`
    )
  }, [location.pathname])

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
    <LanguageProvider value={language}>
    <div className="mx-auto flex min-h-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      {/* Every navigation and form post is covered by this, so no action can
          look like it did nothing while the server works. */}
      {busy && (
        <div
          role="progressbar"
          aria-label={t("Working")}
          className="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-emerald-600/20"
        >
          <div className="h-full w-1/3 animate-[tl-progress_1.1s_ease-in-out_infinite] bg-emerald-600" />
        </div>
      )}
      <style>{`@keyframes tl-progress{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold tracking-tight">
            {t("Gardena Scheduler")}
          </h1>
          {connected ? (
            <Badge tone="good">{t("Connected")}</Badge>
          ) : (
            <Badge tone="bad">{t("Offline")}</Badge>
          )}
          {activeRun != null && (
            <Badge tone="active">
              {t("Watering · {name}", { name: activeRun.scheduleName })}
            </Badge>
          )}
        </div>

        <masterFetcher.Form
          method="post"
          action={href("/master")}
          className="flex items-center gap-3"
        >
          <span className="text-sm font-medium">{t("All schedules")}</span>
          <Toggle
            name="enabled"
            checked={masterEnabled}
            onChange={(event) =>
              masterFetcher.submit(event.currentTarget.form)
            }
          />
        </masterFetcher.Form>
      </header>

      {schedulerOff && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <strong>{t("Scheduler disabled on this instance.")}</strong>{" "}
          {t(
            "It will not run schedules or open any valve — {flag} is set. Only the instance actually in charge of the garden should run without it.",
            { flag: "SCHEDULER_DISABLED" }
          )}
        </p>
      )}

      {!masterEnabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {t(
            "All schedules are switched off. Nothing will be watered until you turn them back on."
          )}
        </p>
      )}

      <nav className="flex gap-1 overflow-x-auto rounded-lg bg-stone-200/60 p-1 dark:bg-stone-900">
        {NAV.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            // No `end`: prefix matching is what keeps "Schedules" highlighted
            // while editing one at /schedules/:scheduleId. It was previously
            // needed only to stop the root path matching everything, and the
            // root is no longer a tab.
            className={({ isActive }) =>
              cx(
                "flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-center text-sm font-medium transition-colors sm:px-3",
                isActive
                  ? "bg-white text-stone-900 shadow-sm dark:bg-stone-800 dark:text-stone-100"
                  : "text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
              )
            }
          >
            {t(label)}
          </NavLink>
        ))}
      </nav>

      <main className="flex-1 space-y-6">
        <Outlet />
      </main>
    </div>
    </LanguageProvider>
  )
}
