import { eq } from "drizzle-orm"
import { Form, Link, href, redirect, useSubmit } from "react-router"

import { Badge, Button, Card, EmptyState, Input, Toggle } from "../components/ui"
import { useT } from "../i18n"
import { translatorFor } from "../i18n/server"
import { db } from "../db"
import {
  scheduleSteps as scheduleStepsTable,
  schedules as schedulesTable,
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { SERIES_COUNT, Timeline } from "../components/timeline"
import {
  buildPlan,
  coversDate,
  displayName,
  formatRecurrence,
  getNextOccurrence,
} from "../scheduler/plan"
import {
  formatZonedTime,
  getLocalDateKey,
  getZonedParts,
  parseTimeOfDay,
} from "../scheduler/time"
import type { Route } from "./+types/schedules"

export const loader = async ({ request }: Route.LoaderArgs) => {
  const t = translatorFor(request)
  const settings = db.select().from(settingsTable).get()!
  const now = new Date()

  const valvesById = new Map(
    db.select().from(valvesTable).all().map((row) => [row.id, row])
  )
  const allSteps = db.select().from(scheduleStepsTable).all()

  const schedules = db
    .select()
    .from(schedulesTable)
    .orderBy(schedulesTable.startTime)
    .all()
    .map((schedule) => {
      const steps = allSteps.filter((step) => step.scheduleId === schedule.id)
      const nextAt = getNextOccurrence(schedule, now, settings.timezone)
      const plan = buildPlan(
        schedule,
        steps,
        valvesById,
        getLocalDateKey(nextAt ?? now, settings.timezone),
        settings.timezone
      )

      return {
        id: schedule.id,
        name: schedule.name,
        startTime: schedule.startTime,
        enabled: schedule.enabled,
        recurrence: formatRecurrence(schedule, t),
        moistureTarget: schedule.moistureTarget,
        stepCount: plan.steps.length,
        totalMinutes: plan.totalMinutes,
        endTime: formatZonedTime(plan.endsAt, settings.timezone),
      }
    })

  const today = getLocalDateKey(now, settings.timezone)
  const nowParts = getZonedParts(now, settings.timezone)

  // Everything that actually runs today, laid out on a shared clock so overlaps
  // are visible. Only enabled schedules whose recurrence covers today qualify.
  const activeToday = db
    .select()
    .from(schedulesTable)
    .where(eq(schedulesTable.enabled, true))
    .all()
    .filter((schedule) => coversDate(schedule, today, settings.timezone))
    .map((schedule) => {
      const plan = buildPlan(
        schedule,
        allSteps.filter((step) => step.scheduleId === schedule.id),
        valvesById,
        today,
        settings.timezone
      )

      const { hour, minute } = parseTimeOfDay(schedule.startTime)
      const startMinutes = hour * 60 + minute

      // Offsets come from the plan's groups, so parallel sprinklers share a
      // start and the row's length reflects elapsed time, not summed duration.
      const steps = plan.steps.map((planned) => ({
        name: displayName(planned.valve),
        startMinutes: startMinutes + planned.offsetMinutes,
        endMinutes:
          startMinutes + planned.offsetMinutes + planned.step.durationMinutes,
        durationMinutes: planned.step.durationMinutes,
        group: planned.group,
        skipped: false,
      }))

      return {
        id: schedule.id,
        name: schedule.name,
        startMinutes,
        endMinutes: startMinutes + plan.totalMinutes,
        totalMinutes: plan.totalMinutes,
        steps,
      }
    })
    .filter((row) => row.steps.length > 0)
    .sort((a, b) => a.startMinutes - b.startMinutes)

  /**
   * Only one run executes at a time, so a schedule that comes due while another
   * is still watering is skipped for the day rather than queued. Flagging the
   * overlap here is the only warning the user would ever get.
   */
  const conflicting = new Set<number>()

  activeToday.forEach((row, index) => {
    for (const other of activeToday.slice(index + 1)) {
      if (other.startMinutes < row.endMinutes) {
        conflicting.add(row.id)
        conflicting.add(other.id)
      }
    }
  })

  const timeline =
    activeToday.length === 0
      ? null
      : {
          rows: activeToday.map((row, index) => ({
            id: row.id,
            name: row.name,
            series: index % SERIES_COUNT,
            startMinutes: row.startMinutes,
            endMinutes: row.endMinutes,
            label: `${row.totalMinutes} min`,
            steps: row.steps,
            conflict: conflicting.has(row.id),
          })),
          // Pad to whole hours so the axis reads cleanly, with a 3h minimum so a
          // single short schedule does not stretch edge to edge.
          ...(() => {
            const first = Math.min(...activeToday.map((r) => r.startMinutes))
            const last = Math.max(...activeToday.map((r) => r.endMinutes))
            let start = Math.floor(first / 60) * 60
            let end = Math.ceil(last / 60) * 60

            while (end - start < 180) {
              if (start > 0) start -= 60
              else end += 60
            }

            return { windowStart: start, windowEnd: end }
          })(),
          nowMinutes: nowParts.hour * 60 + nowParts.minute,
        }

  return {
    schedules,
    timeline,
    conflicts: activeToday
      .filter((row) => conflicting.has(row.id))
      .map((row) => row.name),
  }
}

export const action = async ({ request }: Route.ActionArgs) => {
  const t = translatorFor(request)
  const formData = await request.formData()
  const intent = formData.get("intent")

  if (intent === "toggle") {
    const id = Number(formData.get("scheduleId"))

    db.update(schedulesTable)
      .set({ enabled: formData.get("enabled") === "on" })
      .where(eq(schedulesTable.id, id))
      .run()

    return null
  }

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim()

    if (name === "") return { error: t("Give the schedule a name.") }

    const created = db
      .insert(schedulesTable)
      .values({ name, startTime: "06:00" })
      .returning()
      .get()

    return redirect(
      href("/schedules/:scheduleId", { scheduleId: String(created.id) })
    )
  }

  return null
}

export default function Schedules({ loaderData, actionData }: Route.ComponentProps) {
  const { schedules, timeline, conflicts } = loaderData
  const submit = useSubmit()
  const t = useT()

  return (
    <>
      <Card
        title={t("Today")}
        description={
          timeline == null
            ? undefined
            : t("Every schedule running today, on a shared clock.")
        }
      >
        {timeline == null ? (
          <EmptyState title={t("Nothing runs today")}>
            {t("No enabled schedule covers today, or none has sprinklers yet.")}
          </EmptyState>
        ) : (
          <>
            <Timeline data={timeline} />

            {conflicts.length > 0 && (
              <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                {t(
                  "{names} overlap. Only one schedule runs at a time, so whichever comes second will be skipped today rather than waiting its turn. Move its start time past the end of the first.",
                  { names: conflicts.join(" & ") }
                )}
              </p>
            )}
          </>
        )}
      </Card>

      <Card
        title={t("Schedules")}
        description={t(
          "Each schedule waters its sprinklers one after another, starting at its start time."
        )}
      >
        {schedules.length === 0 ? (
          <EmptyState title={t("No schedules yet")}>
            {t("Create one below to get started.")}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {schedules.map((schedule) => (
              <li
                key={schedule.id}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <Link
                    to={href("/schedules/:scheduleId", {
                      scheduleId: String(schedule.id),
                    })}
                    className="font-medium hover:underline"
                  >
                    {schedule.name}
                  </Link>
                  <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">
                    {schedule.startTime}–{schedule.endTime} · {schedule.recurrence}
                  </p>
                  <p className="text-xs text-stone-500 dark:text-stone-400">
                    {schedule.stepCount === 0
                      ? t("No sprinklers yet")
                      : t("{count} sprinklers · {minutes} min total", {
                          count: schedule.stepCount,
                          minutes: schedule.totalMinutes,
                        })}
                    {schedule.moistureTarget != null &&
                      t(" · waters below {target}%", {
                        target: schedule.moistureTarget,
                      })}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {!schedule.enabled && <Badge>{t("Off")}</Badge>}
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input
                      type="hidden"
                      name="scheduleId"
                      value={schedule.id}
                    />
                    <Toggle
                      name="enabled"
                      checked={schedule.enabled}
                      onChange={(event) => submit(event.currentTarget.form)}
                    />
                  </Form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t("New schedule")}>
        <Form method="post" className="flex flex-wrap items-start gap-3">
          <input type="hidden" name="intent" value="create" />
          <div className="min-w-48 flex-1">
            <Input name="name" placeholder={t("Evening watering")} required />
            {actionData?.error != null && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {actionData.error}
              </p>
            )}
          </div>
          <Button type="submit" variant="primary">
            {t("Create")}
          </Button>
        </Form>
      </Card>
    </>
  )
}
