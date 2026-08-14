import { and, eq, gt, lt, sql } from "drizzle-orm"
import { useMemo, useState } from "react"
import { Form, href, redirect, useSubmit } from "react-router"

import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Toggle,
  cx,
} from "../components/ui"
import { db } from "../db"
import {
  scheduleSteps as scheduleStepsTable,
  schedules as schedulesTable,
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { getValves } from "../gardena/store"
import { displayName } from "../scheduler/plan"
import {
  ALL_DAYS,
  DAY_NAMES,
  formatTimeOfDay,
  getLocalDateKey,
  hasDay,
  parseTimeOfDay,
} from "../scheduler/time"
import type { Route } from "./+types/schedule"

/** Starting duration for a newly added sprinkler, in minutes. */
const DEFAULT_STEP_MINUTES = 10

export const loader = async ({ params }: Route.LoaderArgs) => {
  const scheduleId = Number(params.scheduleId)
  const schedule = db
    .select()
    .from(schedulesTable)
    .where(eq(schedulesTable.id, scheduleId))
    .get()

  if (schedule == null) throw new Response("Not found", { status: 404 })

  const settings = db.select().from(settingsTable).get()!
  const valveRows = db
    .select()
    .from(valvesTable)
    .orderBy(valvesTable.sortOrder)
    .all()
  const valvesById = new Map(valveRows.map((row) => [row.id, row]))

  const steps = db
    .select()
    .from(scheduleStepsTable)
    .where(eq(scheduleStepsTable.scheduleId, scheduleId))
    .orderBy(scheduleStepsTable.position)
    .all()
    .map((step) => ({
      id: step.id,
      valveId: step.valveId,
      durationMinutes: step.durationMinutes,
      name: valvesById.has(step.valveId)
        ? displayName(valvesById.get(step.valveId)!)
        : "Unknown sprinkler",
    }))

  const used = new Set(steps.map((step) => step.valveId))

  // A valve the gateway is not currently reporting cannot be watered, so it has
  // no business in the picker either.
  const reachable = new Set(
    getValves()
      .filter((valve) => valve.connected)
      .map((valve) => valve.id)
  )

  return {
    schedule,
    steps,
    today: getLocalDateKey(new Date(), settings.timezone),
    available: valveRows
      .filter(
        (valve) =>
          !valve.hidden && !used.has(valve.id) && reachable.has(valve.id)
      )
      .map((valve) => ({ id: valve.id, name: displayName(valve) })),
  }
}

/** Renumbers positions to 0..n-1 so reordering never leaves gaps. */
const compactPositions = (scheduleId: number) => {
  const steps = db
    .select()
    .from(scheduleStepsTable)
    .where(eq(scheduleStepsTable.scheduleId, scheduleId))
    .orderBy(scheduleStepsTable.position)
    .all()

  steps.forEach((step, index) => {
    if (step.position === index) return

    db.update(scheduleStepsTable)
      .set({ position: index })
      .where(eq(scheduleStepsTable.id, step.id))
      .run()
  })
}

export const action = async ({ request, params }: Route.ActionArgs) => {
  const scheduleId = Number(params.scheduleId)
  const formData = await request.formData()
  const intent = formData.get("intent")

  if (intent === "delete-schedule") {
    db.delete(schedulesTable).where(eq(schedulesTable.id, scheduleId)).run()
    return redirect(href("/schedules"))
  }

  if (intent === "save-schedule") {
    const name = String(formData.get("name") ?? "").trim()
    const startTime = String(formData.get("startTime") ?? "")
    const recurrence =
      formData.get("recurrence") === "interval" ? "interval" : "weekly"

    try {
      const { hour, minute } = parseTimeOfDay(startTime)

      const days = DAY_NAMES.reduce(
        (mask, _, index) =>
          formData.get(`day-${index}`) === "on" ? mask | (1 << index) : mask,
        0
      )

      const intervalDays = Math.min(
        30,
        Math.max(1, Number(formData.get("intervalDays") ?? 2))
      )

      const anchorDate = String(formData.get("anchorDate") ?? "").trim()

      db.update(schedulesTable)
        .set({
          name: name === "" ? "Untitled" : name,
          startTime: formatTimeOfDay(hour, minute),
          recurrence,
          daysOfWeek: recurrence === "weekly" ? days : ALL_DAYS,
          intervalDays,
          anchorDate: /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) ? anchorDate : null,
          enabled: formData.get("enabled") === "on",
        })
        .where(eq(schedulesTable.id, scheduleId))
        .run()
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }

    return null
  }

  if (intent === "duplicate-schedule") {
    const source = db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.id, scheduleId))
      .get()

    if (source == null) return null

    const copy = db.transaction((tx) => {
      const { id: _id, createdAt: _createdAt, ...rest } = source

      // The copy starts disabled: two identical schedules both firing would
      // double every watering until the user has adjusted the new one.
      const created = tx
        .insert(schedulesTable)
        .values({ ...rest, name: `${source.name} (copy)`, enabled: false })
        .returning()
        .get()

      const steps = tx
        .select()
        .from(scheduleStepsTable)
        .where(eq(scheduleStepsTable.scheduleId, scheduleId))
        .orderBy(scheduleStepsTable.position)
        .all()

      if (steps.length > 0) {
        tx.insert(scheduleStepsTable)
          .values(
            steps.map(({ id: _stepId, ...step }) => ({
              ...step,
              scheduleId: created.id,
            }))
          )
          .run()
      }

      return created
    })

    return redirect(
      href("/schedules/:scheduleId", { scheduleId: String(copy.id) })
    )
  }

  if (intent === "add-all-steps") {
    const used = new Set(
      db
        .select({ valveId: scheduleStepsTable.valveId })
        .from(scheduleStepsTable)
        .where(eq(scheduleStepsTable.scheduleId, scheduleId))
        .all()
        .map((step) => step.valveId)
    )

    const reachable = new Set(
      getValves().filter((valve) => valve.connected).map((valve) => valve.id)
    )

    const toAdd = db
      .select()
      .from(valvesTable)
      .orderBy(valvesTable.sortOrder)
      .all()
      .filter(
        (valve) =>
          !valve.hidden && !used.has(valve.id) && reachable.has(valve.id)
      )

    if (toAdd.length === 0) return null

    const next = db
      .select({ max: sql<number | null>`max(${scheduleStepsTable.position})` })
      .from(scheduleStepsTable)
      .where(eq(scheduleStepsTable.scheduleId, scheduleId))
      .get()

    let position = (next?.max ?? -1) + 1

    db.insert(scheduleStepsTable)
      .values(
        toAdd.map((valve) => ({
          scheduleId,
          valveId: valve.id,
          durationMinutes: DEFAULT_STEP_MINUTES,
          position: position++,
        }))
      )
      .run()

    return null
  }

  if (intent === "add-step") {
    const valveId = String(formData.get("valveId") ?? "")

    if (valveId === "") return { error: "Pick a sprinkler to add." }

    const next = db
      .select({ max: sql<number | null>`max(${scheduleStepsTable.position})` })
      .from(scheduleStepsTable)
      .where(eq(scheduleStepsTable.scheduleId, scheduleId))
      .get()

    db.insert(scheduleStepsTable)
      .values({
        scheduleId,
        valveId,
        durationMinutes: DEFAULT_STEP_MINUTES,
        position: (next?.max ?? -1) + 1,
      })
      .run()

    return null
  }

  if (intent === "remove-step") {
    db.delete(scheduleStepsTable)
      .where(eq(scheduleStepsTable.id, Number(formData.get("stepId"))))
      .run()

    compactPositions(scheduleId)
    return null
  }

  if (intent === "set-duration") {
    const minutes = Math.min(
      600,
      Math.max(1, Math.round(Number(formData.get("durationMinutes") ?? 10)))
    )

    db.update(scheduleStepsTable)
      .set({ durationMinutes: minutes })
      .where(eq(scheduleStepsTable.id, Number(formData.get("stepId"))))
      .run()

    return null
  }

  if (intent === "move-step") {
    const stepId = Number(formData.get("stepId"))
    const direction = formData.get("direction") === "up" ? "up" : "down"

    const step = db
      .select()
      .from(scheduleStepsTable)
      .where(eq(scheduleStepsTable.id, stepId))
      .get()

    if (step == null) return null

    // Swap with the adjacent step rather than rewriting the whole list.
    const neighbour = db
      .select()
      .from(scheduleStepsTable)
      .where(
        and(
          eq(scheduleStepsTable.scheduleId, scheduleId),
          direction === "up"
            ? lt(scheduleStepsTable.position, step.position)
            : gt(scheduleStepsTable.position, step.position)
        )
      )
      .orderBy(
        direction === "up"
          ? sql`${scheduleStepsTable.position} desc`
          : scheduleStepsTable.position
      )
      .get()

    if (neighbour == null) return null

    db.transaction((tx) => {
      tx.update(scheduleStepsTable)
        .set({ position: neighbour.position })
        .where(eq(scheduleStepsTable.id, step.id))
        .run()
      tx.update(scheduleStepsTable)
        .set({ position: step.position })
        .where(eq(scheduleStepsTable.id, neighbour.id))
        .run()
    })

    return null
  }

  return null
}

const addMinutes = (time: string, minutes: number) => {
  const { hour, minute } = parseTimeOfDay(time)
  const total = hour * 60 + minute + minutes

  return formatTimeOfDay(Math.floor(total / 60) % 24, total % 60)
}

export default function ScheduleEditor({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { schedule, steps, available, today } = loaderData
  const submit = useSubmit()

  const [startTime, setStartTime] = useState(schedule.startTime)
  const [recurrence, setRecurrence] = useState(schedule.recurrence)
  const [durations, setDurations] = useState<Record<number, number>>(() =>
    Object.fromEntries(steps.map((step) => [step.id, step.durationMinutes]))
  )

  // Requirement 1: the user authors order and duration; every clock time below is
  // derived, and derived live so the effect of a change is immediately visible.
  const timeline = useMemo(() => {
    let offset = 0

    return steps.map((step) => {
      const minutes = durations[step.id] ?? step.durationMinutes
      const startsAt = addMinutes(startTime, offset)
      offset += minutes

      return { ...step, minutes, startsAt, endsAt: addMinutes(startTime, offset) }
    })
  }, [steps, durations, startTime])

  const totalMinutes = timeline.reduce((sum, step) => sum + step.minutes, 0)

  return (
    <>
      <Card
        title="Schedule"
        actions={
          <div className="flex items-center gap-2">
            <Form method="post">
              <input type="hidden" name="intent" value="duplicate-schedule" />
              <Button type="submit">Duplicate</Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="delete-schedule" />
              <Button
                type="submit"
                variant="danger"
                onClick={(event) => {
                  if (!confirm(`Delete "${schedule.name}"?`)) {
                    event.preventDefault()
                  }
                }}
              >
                Delete
              </Button>
            </Form>
          </div>
        }
      >
        <Form method="post" className="space-y-5">
          <input type="hidden" name="intent" value="save-schedule" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input name="name" defaultValue={schedule.name} className="mt-1" />
            </Field>
            <Field label="Start time" hint="Local time in your configured timezone.">
              <Input
                type="time"
                name="startTime"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="mt-1"
              />
            </Field>
          </div>

          <Field label="Repeat">
            <Select
              name="recurrence"
              value={recurrence}
              onChange={(event) =>
                setRecurrence(event.target.value as typeof recurrence)
              }
              className="mt-1"
            >
              <option value="weekly">On certain weekdays</option>
              <option value="interval">Every N days</option>
            </Select>
          </Field>

          {recurrence === "weekly" ? (
            <div className="flex flex-wrap gap-2">
              {DAY_NAMES.map((day, index) => (
                <label
                  key={day}
                  className={cx(
                    "cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    "border-stone-300 has-checked:border-emerald-600 has-checked:bg-emerald-600 has-checked:text-white dark:border-stone-700"
                  )}
                >
                  <input
                    type="checkbox"
                    name={`day-${index}`}
                    defaultChecked={hasDay(schedule.daysOfWeek, index)}
                    className="sr-only"
                  />
                  {day}
                </label>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Run every" hint="2 = every second day.">
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    name="intervalDays"
                    min={1}
                    max={30}
                    defaultValue={schedule.intervalDays}
                  />
                  <span className="text-sm text-stone-500 dark:text-stone-400">
                    days
                  </span>
                </div>
              </Field>
              <Field
                label="Starting from"
                hint="Sets which days the cycle lands on."
              >
                <Input
                  type="date"
                  name="anchorDate"
                  defaultValue={schedule.anchorDate ?? today}
                  className="mt-1"
                />
              </Field>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 border-t border-stone-200 pt-4 dark:border-stone-800">
            <label className="flex items-center gap-3">
              <Toggle name="enabled" defaultChecked={schedule.enabled} />
              <span className="text-sm font-medium">Schedule enabled</span>
            </label>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>

          {actionData?.error != null && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </p>
          )}
        </Form>
      </Card>

      <Card
        title="Sprinklers"
        description={
          timeline.length === 0
            ? "Add sprinklers in the order they should run."
            : `${startTime}–${addMinutes(startTime, totalMinutes)} · ${totalMinutes} min total`
        }
      >
        {timeline.length === 0 ? (
          <EmptyState title="No sprinklers in this schedule" />
        ) : (
          <ol className="space-y-2">
            {timeline.map((step, index) => (
              <li
                key={step.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800"
              >
                <span className="w-24 shrink-0 font-mono text-sm tabular-nums text-stone-500 dark:text-stone-400">
                  {step.startsAt}–{step.endsAt}
                </span>

                <span className="min-w-0 flex-1 truncate font-medium">
                  {step.name}
                </span>

                <Form method="post" className="flex items-center gap-1">
                  <input type="hidden" name="intent" value="set-duration" />
                  <input type="hidden" name="stepId" value={step.id} />
                  <Input
                    type="number"
                    name="durationMinutes"
                    min={1}
                    max={600}
                    value={step.minutes}
                    onChange={(event) =>
                      setDurations((current) => ({
                        ...current,
                        [step.id]: Number(event.target.value),
                      }))
                    }
                    onBlur={(event) => submit(event.currentTarget.form)}
                    className="w-20"
                    aria-label={`Duration for ${step.name} in minutes`}
                  />
                  <span className="text-sm text-stone-500 dark:text-stone-400">
                    min
                  </span>
                </Form>

                <div className="flex items-center gap-1">
                  <Form method="post">
                    <input type="hidden" name="intent" value="move-step" />
                    <input type="hidden" name="stepId" value={step.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button
                      type="submit"
                      variant="ghost"
                      disabled={index === 0}
                      aria-label={`Move ${step.name} earlier`}
                    >
                      ↑
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="move-step" />
                    <input type="hidden" name="stepId" value={step.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button
                      type="submit"
                      variant="ghost"
                      disabled={index === timeline.length - 1}
                      aria-label={`Move ${step.name} later`}
                    >
                      ↓
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-step" />
                    <input type="hidden" name="stepId" value={step.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Remove ${step.name}`}
                    >
                      ✕
                    </Button>
                  </Form>
                </div>
              </li>
            ))}
          </ol>
        )}

        {available.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Form
              method="post"
              className="flex min-w-48 flex-1 flex-wrap items-end gap-3"
            >
              <input type="hidden" name="intent" value="add-step" />
              <div className="min-w-40 flex-1">
                <Field label="Add sprinkler">
                  <Select name="valveId" className="mt-1">
                    {available.map((valve) => (
                      <option key={valve.id} value={valve.id}>
                        {valve.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit">Add</Button>
            </Form>

            <Form method="post">
              <input type="hidden" name="intent" value="add-all-steps" />
              <Button type="submit">
                Add all {available.length > 1 && `(${available.length})`}
              </Button>
            </Form>
          </div>
        )}
      </Card>
    </>
  )
}
