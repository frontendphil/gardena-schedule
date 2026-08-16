import { Form, Link, href, useLocation, useSearchParams } from "react-router"

import {
  Badge,
  Button,
  Card,
  EmptyState,
  cx,
  useIsPending,
} from "../components/ui"
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

export const loader = async () => {
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
        recurrence: formatRecurrence(schedule),
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

  // Which sprinklers the current reading would currently hold back — the gate is
  // re-evaluated at watering time, so this is a preview, not a promise.
  const gated = settings.sensorGateEnabled && sensor?.soilHumidity != null
    ? valveRows
        .filter((valve) => !valve.hidden)
        .filter(
          (valve) =>
            sensor.soilHumidity! >=
            resolveMoistureTarget(valve, settings.globalMoistureTarget)
        )
        .map((valve) => displayName(valve))
    : []

  return {
    // Rendering must not call Date.now(): the server and the browser would
    // compute it at different instants and the markup would not match, which
    // React reports as a hydration error and recovers from by throwing the
    // server-rendered page away.
    now: now.getTime(),
    timezone: settings.timezone,
    sensorGateEnabled: settings.sensorGateEnabled,
    globalMoistureTarget: settings.globalMoistureTarget,
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

const STEP_LABELS: Record<RunStepStatus, { label: string; tone: "neutral" | "active" | "good" | "warn" | "bad" }> = {
  pending: { label: "Pending", tone: "neutral" },
  running: { label: "Watering", tone: "active" },
  completed: { label: "Watered", tone: "good" },
  skipped_moisture: { label: "Skipped — soil wet", tone: "warn" },
  skipped_master_off: { label: "Skipped — all off", tone: "warn" },
  skipped_schedule_off: { label: "Skipped — schedule off", tone: "warn" },
  skipped_unavailable: { label: "Skipped — unreachable", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
}

/** Result of pressing "Measure now", reported rather than failing silently. */
const MEASURE_OUTCOMES: Record<string, string> = {
  refreshed: "The sensor took a new reading.",
  "timed-out":
    "Gardena accepted the request but no new reading arrived within 30 seconds.",
  failed:
    "Could not reach Gardena's app API — check the account email and password on Settings.",
  "not-configured":
    "No Husqvarna account is configured, so the sensor cannot be asked to measure.",
  "no-sensor": "No soil sensor is reporting.",
  "fresh-enough": "The reading was already current.",
}

/** "just now" / "12 min ago" / "3 h ago" — how stale the reading is. */
const formatAge = (measuredAt: Date | string | null, now: number) => {
  if (measuredAt == null) return null

  const minutes = Math.max(
    0,
    Math.round((now - new Date(measuredAt).getTime()) / 60_000)
  )

  if (minutes < 2) return "just now"
  if (minutes < 60) return `${minutes} min ago`

  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    now,
    timezone,
    sensorGateEnabled,
    globalMoistureTarget,
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

  const location = useLocation()
  const refreshing = useIsPending("refresh")
  const measuring = useIsPending("measure")
  const [searchParams] = useSearchParams()
  const measured = searchParams.get("measured")

  const dateFormat = new Intl.DateTimeFormat("en-GB", {
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
              Watering now: {watering.map((valve) => valve.name).join(", ")}
            </p>
          </div>
        </Card>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Card
          title="Soil"
          description={
            measuredAt == null
              ? "Sensor reading"
              : `Measured ${formatAge(measuredAt, now)} · ${dateFormat.format(new Date(measuredAt))}`
          }
          actions={
            <div className="flex items-center gap-1">
              {canForceMeasurement && (
                <Form method="post" action={href("/measure")}>
                  <input type="hidden" name="intent" value="measure" />
                  <Button
                    type="submit"
                    variant="ghost"
                    busy={measuring}
                    className="whitespace-nowrap"
                    title="Ask the sensor to take a reading now, via Gardena's app API."
                  >
                    Measure
                  </Button>
                </Form>
              )}
              <Form method="post" action={href("/refresh")}>
              {/* Named so `useIsPending` can light up this button alone. */}
              <input type="hidden" name="intent" value="refresh" />
              <input type="hidden" name="returnTo" value={location.pathname} />
              <Button
                type="submit"
                variant="ghost"
                busy={refreshing}
                className="whitespace-nowrap"
                title="Re-read what Gardena already holds. Does not ask the sensor to measure."
              >
                Refresh
              </Button>
              </Form>
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
              No sensor reading yet.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-4">
                <div>
                  <dt className="text-xs text-stone-500 dark:text-stone-400">
                    Moisture
                  </dt>
                  <dd className="mt-0.5 text-3xl font-semibold tabular-nums">
                    {soilHumidity}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500 dark:text-stone-400">
                    Soil temp
                  </dt>
                  <dd className="mt-0.5 text-3xl font-semibold tabular-nums">
                    {soilTemperature == null ? "—" : `${soilTemperature}°`}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500 dark:text-stone-400">
                    Battery
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
                  {sensorName ?? "The sensor"} is down to {batteryLevel}%
                  {batteryMeasuredAt != null &&
                    ` (as of ${formatAge(batteryMeasuredAt, now)})`}
                  . A flat sensor stops reporting, and moisture gating then
                  waters on a stale reading.
                </p>
              )}
              <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
                Gardena decides when the sensor measures; refreshing re-reads
                what it has already reported.
                {signalLevel != null && ` Signal ${signalLevel}%.`}
              </p>
              <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
                {!sensorGateEnabled
                  ? "Moisture gating is off — schedules run regardless of the reading."
                  : gated.length === 0
                    ? `Below the ${globalMoistureTarget}% target, so schedules will water.`
                    : `Currently holding back: ${gated.join(", ")}.`}
              </p>
            </>
          )}
        </Card>

        <Card title="Next run">
          {upcoming.length === 0 ? (
            <EmptyState title="Nothing scheduled">
              <Link className="underline" to={href("/schedules")}>
                Create a schedule
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
                      {entry.recurrence} · {entry.stepCount} sprinklers ·{" "}
                      {entry.totalMinutes} min
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

      <Card title="Recent runs" description="What actually happened, and why.">
        {recentRuns.length === 0 ? (
          <EmptyState title="No runs yet">
            Runs will appear here once a schedule fires.
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
                          · {step.durationMinutes} min
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
