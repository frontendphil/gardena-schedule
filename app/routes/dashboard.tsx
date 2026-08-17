import { Link, href, useFetcher } from "react-router"

import { Badge, Button, Card, EmptyState, cx } from "../components/ui"
import { useLocale, useT, type Translate } from "../i18n"
import { translatorFor } from "../i18n/server"
import { db } from "../db"
import {
  scheduleSteps as scheduleStepsTable,
  schedules as schedulesTable,
  settings as settingsTable,
  valves as valvesTable,
  type RunStepStatus,
} from "../db/schema"
import { hasAccountCredentials } from "../gardena/account"
import { getDevices, getSensor, getValves } from "../gardena/store"
import {
  buildPlan,
  displayName,
  formatRecurrence,
  getNextOccurrence,
  resolveMoistureTarget,
} from "../scheduler/plan"
import { getRecentRuns } from "../scheduler/runner"
import { formatZonedTime, getLocalDateKey } from "../scheduler/time"
import type { Route } from "./+types/dashboard"

export const loader = async ({ request }: Route.LoaderArgs) => {
  const t = translatorFor(request)
  const settings = db.select().from(settingsTable).get()!
  const now = new Date()

  const valveRows = db.select().from(valvesTable).all()
  const valvesById = new Map(valveRows.map((row) => [row.id, row]))
  const apiValves = new Map(getValves().map((valve) => [valve.id, valve]))

  const allSchedules = db.select().from(schedulesTable).all()
  const allSteps = db.select().from(scheduleStepsTable).all()

  const upcoming = allSchedules
    .map((schedule) => {
      const nextAt = getNextOccurrence(schedule, now, settings.timezone)

      if (nextAt == null) return null

      const steps = allSteps.filter((step) => step.scheduleId === schedule.id)
      const plan = buildPlan(
        schedule,
        steps,
        valvesById,
        getLocalDateKey(nextAt, settings.timezone),
        settings.timezone
      )

      return {
        id: schedule.id,
        name: schedule.name,
        recurrence: formatRecurrence(schedule, t),
        nextAt,
        startTime: formatZonedTime(nextAt, settings.timezone),
        endTime: formatZonedTime(plan.endsAt, settings.timezone),
        totalMinutes: plan.totalMinutes,
        stepCount: plan.steps.length,
      }
    })
    .filter((entry) => entry != null)
    .sort((a, b) => a.nextAt.getTime() - b.nextAt.getTime())

  const sensor = getSensor(settings.sensorId)

  // The sensor service and its COMMON service share a device id, so the battery
  // for the sensor we gate on is the one worth showing. The irrigation
  // controllers are mains-powered and report no battery at all.
  const sensorDevice =
    sensor == null
      ? null
      : (getDevices().find((device) => device.id === sensor.id) ?? null)

  const enabledSchedules = allSchedules.filter((schedule) => schedule.enabled)

  /**
   * The targets that apply to one sprinkler — one per enabled schedule holding
   * it, because a schedule can set its own goal and a sprinkler can appear in
   * several. A sprinkler in no schedule still gets a target, so the preview can
   * say something about it.
   */
  const targetsFor = (valve: (typeof valveRows)[number]) => {
    const fromSchedules = enabledSchedules
      .filter((schedule) =>
        allSteps.some(
          (step) => step.scheduleId === schedule.id && step.valveId === valve.id
        )
      )
      .map((schedule) =>
        resolveMoistureTarget({
          valve,
          scheduleTarget: schedule.moistureTarget,
          globalTarget: settings.globalMoistureTarget,
        })
      )

    return fromSchedules.length > 0
      ? fromSchedules
      : [
          resolveMoistureTarget({
            valve,
            scheduleTarget: null,
            globalTarget: settings.globalMoistureTarget,
          }),
        ]
  }

  // Which sprinklers the current reading would currently hold back — the gate is
  // re-evaluated at watering time, so this is a preview, not a promise.
  //
  // Listed only when the reading clears *every* target that applies to it, so
  // the claim is true whenever it is shown. A sprinkler in two schedules with
  // different goals may still water in the drier one, and naming it here would
  // be wrong.
  const gated = settings.sensorGateEnabled && sensor?.soilHumidity != null
    ? valveRows
        .filter((valve) => !valve.hidden)
        .filter((valve) =>
          targetsFor(valve).every((target) => sensor.soilHumidity! >= target)
        )
        .map((valve) => displayName(valve))
    : []

  // Whether a single global number still describes the gate, which decides
  // which of the two "will water" sentences the card can honestly show.
  const hasScheduleTargets = enabledSchedules.some(
    (schedule) => schedule.moistureTarget != null
  )

  return {
    // Rendering must not call Date.now(): the server and the browser would
    // compute it at different instants and the markup would not match, which
    // React reports as a hydration error and recovers from by throwing the
    // server-rendered page away.
    now: now.getTime(),
    timezone: settings.timezone,
    sensorGateEnabled: settings.sensorGateEnabled,
    globalMoistureTarget: settings.globalMoistureTarget,
    hasScheduleTargets,
    soilHumidity: sensor?.soilHumidity ?? null,
    soilTemperature: sensor?.soilTemperature ?? null,
    measuredAt: sensor?.measuredAt ?? null,
    sensorName: sensorDevice?.name ?? null,
    batteryLevel: sensorDevice?.batteryLevel ?? null,
    batteryMeasuredAt: sensorDevice?.batteryMeasuredAt ?? null,
    signalLevel: sensorDevice?.rfLinkLevel ?? null,
    canForceMeasurement: hasAccountCredentials(),
    gated,
    watering: [...apiValves.values()]
      .filter((valve) => valve.watering)
      .map((valve) => ({
        id: valve.id,
        name: valvesById.has(valve.id)
          ? displayName(valvesById.get(valve.id)!)
          : valve.name,
      })),
    upcoming,
    recentRuns: getRecentRuns(5).map((run) => ({
      id: run.id,
      scheduleName: run.scheduleName,
      startedAt: run.startedAt,
      status: run.status,
      steps: run.steps.map((step) => ({
        id: step.id,
        valveName: step.valveName,
        durationMinutes: step.durationMinutes,
        status: step.status,
        detail: step.detail,
      })),
    })),
  }
}

type Tone = "neutral" | "active" | "good" | "warn" | "bad"

const stepLabels = (
  t: Translate
): Record<RunStepStatus, { label: string; tone: Tone }> => ({
  pending: { label: t("Pending"), tone: "neutral" },
  running: { label: t("Watering"), tone: "active" },
  completed: { label: t("Watered"), tone: "good" },
  skipped_moisture: { label: t("Skipped — soil wet"), tone: "warn" },
  skipped_master_off: { label: t("Skipped — all off"), tone: "warn" },
  skipped_schedule_off: { label: t("Skipped — schedule off"), tone: "warn" },
  skipped_unavailable: { label: t("Skipped — unreachable"), tone: "bad" },
  failed: { label: t("Failed"), tone: "bad" },
})

/** Result of pressing "Measure now", reported rather than failing silently. */
const measureOutcomes = (t: Translate): Record<string, string> => ({
  refreshed: t("The sensor took a new reading."),
  "timed-out": t(
    "Gardena accepted the request, but no new reading arrived within 30 seconds. The sensor declines to measure again straight after a previous reading — wait a minute and try again."
  ),
  failed: t(
    "Could not reach Gardena's app API — check the account email and password on Settings."
  ),
  "not-configured": t(
    "No Husqvarna account is configured, so the sensor cannot be asked to measure."
  ),
  "no-sensor": t("No soil sensor is reporting."),
  "fresh-enough": t("The reading was already current."),
})

/** "just now" / "12 min ago" / "3 h ago" — how stale the reading is. */
const formatAge = (
  measuredAt: Date | string | null,
  now: number,
  t: Translate
) => {
  if (measuredAt == null) return null

  const minutes = Math.max(
    0,
    Math.round((now - new Date(measuredAt).getTime()) / 60_000)
  )

  if (minutes < 2) return t("just now")
  if (minutes < 60) return t("{minutes} min ago", { minutes })

  const hours = Math.round(minutes / 60)

  return hours < 24
    ? t("{hours} h ago", { hours })
    : t("{days} d ago", { days: Math.round(hours / 24) })
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    now,
    timezone,
    sensorGateEnabled,
    globalMoistureTarget,
    hasScheduleTargets,
    soilHumidity,
    soilTemperature,
    measuredAt,
    sensorName,
    batteryLevel,
    batteryMeasuredAt,
    signalLevel,
    canForceMeasurement,
    gated,
    watering,
    upcoming,
    recentRuns,
  } = loaderData

  // Fetchers rather than navigations: these actions stay on this page, and a
  // redirect would be re-prefixed by Ingress. Both revalidate the loader on
  // completion, so the reading updates without any extra plumbing.
  const t = useT()
  const STEP_LABELS = stepLabels(t)
  const MEASURE_OUTCOMES = measureOutcomes(t)

  const measureFetcher = useFetcher<{ outcome: string }>()
  const refreshFetcher = useFetcher()

  const measuring = measureFetcher.state !== "idle"
  const refreshing = refreshFetcher.state !== "idle"
  const measured = measureFetcher.data?.outcome ?? null

  const dateFormat = new Intl.DateTimeFormat(useLocale(), {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <>
      {watering.length > 0 && (
        <Card>
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-sky-500" />
            </span>
            <p className="font-medium">
              {t("Watering now: {names}", {
                names: watering.map((valve) => valve.name).join(", "),
              })}
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card
          title={t("Soil")}
          description={
            measuredAt == null
              ? t("Sensor reading")
              : t("Measured {age} · {date}", {
                  age: formatAge(measuredAt, now, t) ?? "",
                  date: dateFormat.format(new Date(measuredAt)),
                })
          }
          actions={
            <div className="flex items-center gap-1">
              {canForceMeasurement && (
                <measureFetcher.Form method="post" action={href("/measure")}>
                  <Button
                    type="submit"
                    variant="ghost"
                    busy={measuring}
                    className="whitespace-nowrap"
                    title={t("Ask the sensor to take a reading now, via Gardena's app API.")}
                  >
                    {t("Measure")}
                  </Button>
                </measureFetcher.Form>
              )}
              <refreshFetcher.Form method="post" action={href("/refresh")}>
              <Button
                type="submit"
                variant="ghost"
                busy={refreshing}
                className="whitespace-nowrap"
                title={t("Re-read what Gardena already holds. Does not ask the sensor to measure.")}
              >
                {t("Refresh")}
              </Button>
              </refreshFetcher.Form>
            </div>
          }
        >
          {measured != null && (
            <p
              className={cx(
                "mb-3 rounded-lg px-3 py-2 text-sm",
                measured === "refreshed"
                  ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
              )}
            >
              {MEASURE_OUTCOMES[measured] ?? `Measurement: ${measured}`}
            </p>
          )}

          {soilHumidity == null ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">
              {t("No sensor reading yet.")}
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-xs text-stone-500 dark:text-stone-400">
                    {t("Moisture")}
                  </dt>
                  <dd className="mt-0.5 text-3xl font-semibold tabular-nums">
                    {soilHumidity}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500 dark:text-stone-400">
                    {t("Soil temp")}
                  </dt>
                  <dd className="mt-0.5 text-3xl font-semibold tabular-nums">
                    {soilTemperature == null ? "—" : `${soilTemperature}°`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500 dark:text-stone-400">
                    {t("Battery")}
                  </dt>
                  <dd
                    className={cx(
                      "mt-0.5 text-3xl font-semibold tabular-nums",
                      batteryLevel != null &&
                        batteryLevel <= 15 &&
                        "text-red-600 dark:text-red-400",
                      batteryLevel != null &&
                        batteryLevel > 15 &&
                        batteryLevel <= 30 &&
                        "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {batteryLevel == null ? "—" : `${batteryLevel}%`}
                  </dd>
                </div>
              </dl>

              {batteryLevel != null && batteryLevel <= 30 && (
                <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  {t("{name} is down to {level}%", {
                    name: sensorName ?? t("The sensor"),
                    level: batteryLevel,
                  })}
                  {batteryMeasuredAt != null &&
                    t(" (as of {age})", {
                      age: formatAge(batteryMeasuredAt, now, t) ?? "",
                    })}
                  {t(
                    ". A flat sensor stops reporting, and moisture gating then waters on a stale reading."
                  )}
                </p>
              )}
              <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
                {t(
                  "Gardena decides when the sensor measures; refreshing re-reads what it has already reported."
                )}
                {signalLevel != null &&
                  t(" Signal {level}%.", { level: signalLevel })}
              </p>
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                {!sensorGateEnabled
                  ? t(
                      "Moisture gating is off — schedules run regardless of the reading."
                    )
                  : gated.length === 0
                    ? hasScheduleTargets
                      ? t("Below every schedule's target, so schedules will water.")
                      : t("Below the {target}% target, so schedules will water.", {
                          target: globalMoistureTarget,
                        })
                    : t("Currently holding back: {names}.", {
                        names: gated.join(", "),
                      })}
              </p>
            </>
          )}
        </Card>

        <Card title={t("Next run")}>
          {upcoming.length === 0 ? (
            <EmptyState title={t("Nothing scheduled")}>
              <Link className="underline" to={href("/schedules")}>
                {t("Create a schedule")}
              </Link>
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {upcoming.slice(0, 3).map((entry) => (
                <li key={entry.id} className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={href("/schedules/:scheduleId", {
                        scheduleId: String(entry.id),
                      })}
                      className="truncate font-medium hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {entry.recurrence} ·{" "}
                      {t("{count} sprinklers · {minutes} min", {
                        count: entry.stepCount,
                        minutes: entry.totalMinutes,
                      })}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-medium tabular-nums">
                      {entry.startTime}–{entry.endTime}
                    </p>
                    <p className="text-xs text-stone-500 dark:text-stone-400">
                      {dateFormat.format(new Date(entry.nextAt))}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title={t("Recent runs")}
        description={t("What actually happened, and why.")}
      >
        {recentRuns.length === 0 ? (
          <EmptyState title={t("No runs yet")}>
            {t("Runs will appear here once a schedule fires.")}
          </EmptyState>
        ) : (
          <ul className="space-y-5">
            {recentRuns.map((run) => (
              <li key={run.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-medium">{run.scheduleName}</p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {dateFormat.format(new Date(run.startedAt))}
                  </p>
                </div>
                <ul className="mt-2 space-y-1">
                  {run.steps.map((step) => (
                    <li
                      key={step.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 py-1 text-sm last:border-0 dark:border-stone-800"
                    >
                      <span className="truncate">
                        {step.valveName}{" "}
                        <span className="text-stone-500 dark:text-stone-400">
                          · {t("{minutes} min", { minutes: step.durationMinutes })}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {step.detail != null && (
                          <span className="text-xs text-stone-500 dark:text-stone-400">
                            {step.detail}
                          </span>
                        )}
                        <Badge tone={STEP_LABELS[step.status].tone}>
                          {STEP_LABELS[step.status].label}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
