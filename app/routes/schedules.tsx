import { eq } from "drizzle-orm"
import { Form, Link, href, redirect, useSubmit } from "react-router"

import { Badge, Button, Card, EmptyState, Input, Toggle } from "../components/ui"
import { db } from "../db"
import {
  scheduleSteps as scheduleStepsTable,
  schedules as schedulesTable,
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { buildPlan, formatRecurrence, getNextOccurrence } from "../scheduler/plan"
import { formatZonedTime, getLocalDateKey } from "../scheduler/time"
import type { Route } from "./+types/schedules"

export const loader = async () => {
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
        recurrence: formatRecurrence(schedule),
        stepCount: plan.steps.length,
        totalMinutes: plan.totalMinutes,
        endTime: formatZonedTime(plan.endsAt, settings.timezone),
      }
    })

  return { schedules }
}

export const action = async ({ request }: Route.ActionArgs) => {
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

    if (name === "") return { error: "Give the schedule a name." }

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
  const { schedules } = loaderData
  const submit = useSubmit()

  return (
    <>
      <Card
        title="Schedules"
        description="Each schedule waters its sprinklers one after another, starting at its start time."
      >
        {schedules.length === 0 ? (
          <EmptyState title="No schedules yet">
            Create one below to get started.
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
                      ? "No sprinklers yet"
                      : `${schedule.stepCount} sprinklers · ${schedule.totalMinutes} min total`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {!schedule.enabled && <Badge>Off</Badge>}
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

      <Card title="New schedule">
        <Form method="post" className="flex flex-wrap items-start gap-3">
          <input type="hidden" name="intent" value="create" />
          <div className="min-w-48 flex-1">
            <Input name="name" placeholder="Evening watering" required />
            {actionData?.error != null && (
              <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                {actionData.error}
              </p>
            )}
          </div>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </Form>
      </Card>
    </>
  )
}
