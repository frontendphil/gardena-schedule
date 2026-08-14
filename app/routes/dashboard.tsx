import { Link, href } from "react-router"

import { Badge, Card, EmptyState } from "../components/ui"
import { db } from "../db"
import {
  scheduleSteps as scheduleStepsTable,
  schedules as schedulesTable,
  settings as settingsTable,
  valves as valvesTable,
  type RunStepStatus,
} from "../db/schema"
import { getSensor, getValves } from "../gardena/store"
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
    timezone: settings.timezone,
    sensorGateEnabled: settings.sensorGateEnabled,
    globalMoistureTarget: settings.globalMoistureTarget,
    soilHumidity: sensor?.soilHumidity ?? null,
    soilTemperature: sensor?.soilTemperature ?? null,
    measuredAt: sensor?.measuredAt ?? null,
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

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const {
    timezone,
    sensorGateEnabled,
    globalMoistureTarget,
    soilHumidity,
    soilTemperature,
    measuredAt,
    gated,
    watering,
    upcoming,
    recentRuns,
  } = loaderData

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
        <Card title="Soil" description={`Sensor reading${measuredAt == null ? "" : ` · ${dateFormat.format(new Date(measuredAt))}`}`}>
          {soilHumidity == null ? (
            <p className="text-sm text-stone-500 dark:text-stone-400">
              No sensor reading yet.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums">
                  {soilHumidity}%
                </span>
                {soilTemperature != null && (
                  <span className="text-sm text-stone-500 dark:text-stone-400">
                    {soilTemperature}°C
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
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
