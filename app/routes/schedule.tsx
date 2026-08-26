import { eq, sql } from "drizzle-orm"
import { useMemo, useState } from "react"
import { Form, href, redirect, useFetcher, useSubmit } from "react-router"

import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  SavedFlash,
  Select,
  Toggle,
  cx,
  useIsPending,
} from "../components/ui"
import { useT } from "../i18n"
import { translatorFor } from "../i18n/server"
import { db } from "../db"
import {
  locations as locationsTable,
  scheduleSteps as scheduleStepsTable,
  schedules as schedulesTable,
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { getValves } from "../gardena/store"
import {
  MAX_PARALLEL_PER_CONTROLLER,
  byDisplayName,
  controllerOf,
  displayName,
  groupSteps,
  parallelViolations,
} from "../scheduler/plan"
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
  const valveRows = db.select().from(valvesTable).all().sort(byDisplayName)
  const valvesById = new Map(valveRows.map((row) => [row.id, row]))

  // Two properties can easily both have a "Terrace"; label them only when the
  // ambiguity actually exists.
  const locationNames = new Map(
    db.select().from(locationsTable).all().map((row) => [row.id, row.name])
  )
  const locationOf = (valve: (typeof valveRows)[number]) =>
    locationNames.size > 1 && valve.locationId != null
      ? (locationNames.get(valve.locationId) ?? null)
      : null

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
      startsWithPrevious: step.startsWithPrevious,
      name: valvesById.has(step.valveId)
        ? displayName(valvesById.get(step.valveId)!)
        : "Unknown sprinkler",
      location: valvesById.has(step.valveId)
        ? locationOf(valvesById.get(step.valveId)!)
        : null,
      // Switched-off sprinklers are never watered, but the step stays visible
      // here so it can be found and removed rather than silently doing nothing.
      disabled: valvesById.get(step.valveId)?.hidden ?? false,
      // A sprinkler's own target beats the schedule's, so this is where a
      // schedule-wide goal quietly fails to apply. Surfaced per step rather
      // than left to be discovered in the run history.
      ownMoistureTarget: valvesById.get(step.valveId)?.moistureTarget ?? null,
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
    globalMoistureTarget: settings.globalMoistureTarget,
    sensorGateEnabled: settings.sensorGateEnabled,
    today: getLocalDateKey(new Date(), settings.timezone),
    available: valveRows
      .filter(
        (valve) =>
          !valve.hidden && !used.has(valve.id) && reachable.has(valve.id)
      )
      .map((valve) => ({
        id: valve.id,
        name: displayName(valve),
        location: locationOf(valve),
      })),
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
  const t = translatorFor(request)
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

      // Empty means "inherit the global target", so it has to stay distinct
      // from 0 — which is a legitimate goal meaning "always water".
      const rawTarget = String(formData.get("moistureTarget") ?? "").trim()
      const parsedTarget = Number(rawTarget)

      const moistureTarget =
        rawTarget === "" || Number.isNaN(parsedTarget)
          ? null
          : Math.min(100, Math.max(0, Math.round(parsedTarget)))

      db.update(schedulesTable)
        .set({
          name: name === "" ? "Untitled" : name,
          startTime: formatTimeOfDay(hour, minute),
          recurrence,
          daysOfWeek: recurrence === "weekly" ? days : ALL_DAYS,
          intervalDays,
          anchorDate: /^\d{4}-\d{2}-\d{2}$/.test(anchorDate) ? anchorDate : null,
          moistureTarget,
          enabled: formData.get("enabled") === "on",
        })
        .where(eq(schedulesTable.id, scheduleId))
        .run()
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }

    return { ok: true }
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
      .all()
      .sort(byDisplayName)
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

    if (valveId === "") return { error: t("Pick a sprinkler to add.") }

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

  if (intent === "reorder-steps") {
    const requested = String(formData.get("stepIds") ?? "")
      .split(",")
      .map(Number)
      .filter((id) => Number.isInteger(id))

    const owned = new Set(
      db
        .select({ id: scheduleStepsTable.id })
        .from(scheduleStepsTable)
        .where(eq(scheduleStepsTable.scheduleId, scheduleId))
        .all()
        .map((step) => step.id)
    )

    // Ignore anything that is not a step of this schedule, and refuse a partial
    // list — a dropped id would otherwise silently lose its position.
    const ordered = requested.filter((id) => owned.has(id))

    if (ordered.length !== owned.size) return null

    db.transaction((tx) => {
      ordered.forEach((id, position) => {
        tx.update(scheduleStepsTable)
          .set({ position })
          .where(eq(scheduleStepsTable.id, id))
          .run()
      })
    })

    return null
  }

  if (intent === "toggle-parallel") {
    const stepId = Number(formData.get("stepId"))
    const startsWithPrevious = formData.get("startsWithPrevious") === "on"

    const ordered = db
      .select()
      .from(scheduleStepsTable)
      .where(eq(scheduleStepsTable.scheduleId, scheduleId))
      .orderBy(scheduleStepsTable.position)
      .all()

    const proposed = ordered.map((step) =>
      step.id === stepId ? { ...step, startsWithPrevious } : step
    )

    // A controller can only hold two of its valves open at once, so refuse the
    // change rather than letting the runner discover it at 06:00.
    const violation = parallelViolations(proposed)[0]

    if (violation != null) {
      const valveNames = new Map(
        db
          .select()
          .from(valvesTable)
          .all()
          .map((valve) => [valve.id, displayName(valve).trim()])
      )

      // Name the sprinklers that actually clash — "controller c06e8316" means
      // nothing to anyone standing in a garden.
      const clashing = groupSteps(proposed)
        [violation.group].filter(
          (step) => controllerOf(step.valveId) === violation.controller
        )
        .map((step) => valveNames.get(step.valveId) ?? step.valveId)

      return {
        error: t(
          "{first} and {last} are on the same controller, which can only open {max} valves at once.",
          {
            first: clashing.slice(0, -1).join(", "),
            last: clashing.at(-1) ?? "",
            max: MAX_PARALLEL_PER_CONTROLLER,
          }
        ),
      }
    }

    db.update(scheduleStepsTable)
      .set({ startsWithPrevious })
      .where(eq(scheduleStepsTable.id, stepId))
      .run()

    return { ok: true }
  }

  if (intent === "move-step") {
    const stepId = Number(formData.get("stepId"))
    const direction = formData.get("direction") === "up" ? "up" : "down"

    const ordered = db
      .select()
      .from(scheduleStepsTable)
      .where(eq(scheduleStepsTable.scheduleId, scheduleId))
      .orderBy(scheduleStepsTable.position)
      .all()

    const index = ordered.findIndex((candidate) => candidate.id === stepId)

    if (index === -1) return null

    const step = ordered[index]

    const hidden = new Set(
      db
        .select()
        .from(valvesTable)
        .all()
        .filter((valve) => valve.hidden)
        .map((valve) => valve.id)
    )

    // Swap with the nearest neighbour rather than rewriting the whole list —
    // skipping switched-off sprinklers, which the list does not show. Swapping
    // with one of those would move the step and look like nothing happened.
    const neighbour = (
      direction === "up"
        ? ordered.slice(0, index).reverse()
        : ordered.slice(index + 1)
    ).find((candidate) => !hidden.has(candidate.valveId))

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

/**
 * Remounts the editor whenever the schedule changes.
 *
 * The editor seeds `useState` from the loader and uses uncontrolled inputs for
 * the rest, both of which React carries over when the same route renders a
 * different record — so navigating between schedules, and most visibly landing
 * on a freshly duplicated one, left every field showing the previous schedule's
 * values. Keying by id gives each schedule its own component instance.
 */
export default function ScheduleRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <ScheduleEditor
      key={loaderData.schedule.id}
      loaderData={loaderData}
      actionData={actionData}
    />
  )
}

function ScheduleEditor({
  loaderData,
  actionData,
}: Pick<Route.ComponentProps, "loaderData" | "actionData">) {
  const {
    schedule,
    steps,
    available,
    today,
    globalMoistureTarget,
    sensorGateEnabled,
  } = loaderData

  // Named from the steps rather than the valve table so the order matches the
  // list below it.
  const overridingSteps = steps
    .filter((step) => step.ownMoistureTarget != null && !step.disabled)
    .map((step) => step.name)
  const submit = useSubmit()
  const reorderFetcher = useFetcher()
  const t = useT()

  // Hoisted: these are hooks, and two of the buttons below live inside
  // conditional JSX where calling them inline would change the hook order.
  const savingSchedule = useIsPending("save-schedule")
  const duplicating = useIsPending("duplicate-schedule")
  const deleting = useIsPending("delete-schedule")
  const addingStep = useIsPending("add-step")
  const addingAll = useIsPending("add-all-steps")


  const [startTime, setStartTime] = useState(schedule.startTime)
  const [recurrence, setRecurrence] = useState(schedule.recurrence)
  const [durations, setDurations] = useState<Record<number, number>>(() =>
    Object.fromEntries(steps.map((step) => [step.id, step.durationMinutes]))
  )

  // Dragging reorders this list immediately and persists on drop, so the
  // timeline updates under the cursor instead of after a round trip.
  const [order, setOrder] = useState(() => steps.map((step) => step.id))
  const [draggingId, setDraggingId] = useState<number | null>(null)

  // Adopt the server's order whenever the set or sequence of steps changes —
  // adding, removing or a completed drag. Comparing during render (rather than
  // in an effect) avoids rendering one frame of stale order.
  const serverOrder = steps.map((step) => step.id).join(",")
  const [seenOrder, setSeenOrder] = useState(serverOrder)

  if (serverOrder !== seenOrder && reorderFetcher.state === "idle") {
    setSeenOrder(serverOrder)
    setOrder(steps.map((step) => step.id))
  }

  const stepsById = new Map(steps.map((step) => [step.id, step]))
  const orderedSteps = order
    .map((id) => stepsById.get(id))
    .filter((step) => step != null)

  const moveStep = (fromId: number, toId: number) => {
    setOrder((current) => {
      const from = current.indexOf(fromId)
      const to = current.indexOf(toId)

      if (from === -1 || to === -1 || from === to) return current

      const next = [...current]
      next.splice(to, 0, ...next.splice(from, 1))

      return next
    })
  }

  const persistOrder = () => {
    setDraggingId(null)

    if (order.join(",") === serverOrder) return

    reorderFetcher.submit(
      { intent: "reorder-steps", stepIds: order.join(",") },
      { method: "post" }
    )
  }

  // The user authors order, duration and grouping; every clock time below is
  // derived, and derived live so the effect of a change is immediately visible.
  // Mirrors `buildPlan`: a group starts once and lasts as long as its longest
  // member, so parallel steps must not advance the offset individually.
  const timeline = useMemo(() => {
    const minutesOf = (step: (typeof orderedSteps)[number]) =>
      durations[step.id] ?? step.durationMinutes

    let offset = 0

    // Mirrors `buildPlan`, which drops switched-off sprinklers — otherwise the
    // times shown here would not be the times that actually run.
    const running = orderedSteps.filter((step) => !step.disabled)

    return groupSteps(running).flatMap((group, groupIndex) => {
      const startsAt = addMinutes(startTime, offset)
      const groupMinutes = Math.max(...group.map(minutesOf))

      const rows = group.map((step) => ({
        ...step,
        minutes: minutesOf(step),
        group: groupIndex,
        groupSize: group.length,
        startsAt,
        endsAt: addMinutes(startTime, offset + minutesOf(step)),
      }))

      offset += groupMinutes
      return rows
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedSteps.map((step) => step.id).join(","), steps, durations, startTime])

  const disabledSteps = orderedSteps.filter((step) => step.disabled)

  // Only one member of each parallel group contributes to the elapsed time.
  const totalMinutes = [
    ...new Map(timeline.map((step) => [step.group, step])).keys(),
  ].reduce(
    (sum, group) =>
      sum +
      Math.max(
        ...timeline.filter((step) => step.group === group).map((s) => s.minutes)
      ),
    0
  )

  return (
    <>
      <Card
        title={t("Schedule")}
        actions={
          <div className="flex items-center gap-2">
            <Form method="post">
              <input type="hidden" name="intent" value="duplicate-schedule" />
              <Button type="submit" busy={duplicating}>
                {t("Duplicate")}
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="delete-schedule" />
              <Button
                type="submit"
                variant="danger"
                busy={deleting}
                onClick={(event) => {
                  if (!confirm(t("Delete “{name}”?", { name: schedule.name }))) {
                    event.preventDefault()
                  }
                }}
              >
                {t("Delete")}
              </Button>
            </Form>
          </div>
        }
      >
        <Form method="post" className="space-y-5">
          <input type="hidden" name="intent" value="save-schedule" />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Name")}>
              <Input name="name" defaultValue={schedule.name} className="mt-1" />
            </Field>
            <Field
              label={t("Start time")}
              hint={t("Local time in your configured timezone.")}
            >
              <Input
                type="time"
                name="startTime"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="mt-1"
              />
            </Field>
          </div>

          <Field label={t("Repeat")}>
            <Select
              name="recurrence"
              value={recurrence}
              onChange={(event) =>
                setRecurrence(event.target.value as typeof recurrence)
              }
              className="mt-1"
            >
              <option value="weekly">{t("On certain weekdays")}</option>
              <option value="interval">{t("Every N days")}</option>
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
                  {t(day)}
                </label>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("Run every")} hint={t("2 = every second day.")}>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="number"
                    name="intervalDays"
                    min={1}
                    max={30}
                    defaultValue={schedule.intervalDays}
                  />
                  <span className="text-sm text-stone-500 dark:text-stone-400">
                    {t("days")}
                  </span>
                </div>
              </Field>
              <Field
                label={t("Starting from")}
                hint={t("Sets which days the cycle lands on.")}
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

          <Field
            label={t("Moisture goal for this schedule")}
            hint={
              sensorGateEnabled
                ? t(
                    "Everything in this schedule waters only below this. Leave empty to follow the global target."
                  )
                : t(
                    "Moisture gating is off in Settings, so this has no effect yet."
                  )
            }
          >
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                name="moistureTarget"
                min={0}
                max={100}
                className="w-32"
                defaultValue={schedule.moistureTarget ?? ""}
                placeholder={t("{target} (global)", {
                  target: globalMoistureTarget,
                })}
              />
              <span className="text-sm text-stone-500 dark:text-stone-400">
                %
              </span>
            </div>
          </Field>

          {/*
            The one way this feature disappoints: a sprinkler with its own
            target ignores the schedule's goal. Naming them is cheaper than
            letting someone infer it from a run that skipped.
          */}
          {schedule.moistureTarget != null && overridingSteps.length > 0 && (
            <p className="text-sm text-amber-700 dark:text-amber-500">
              {t(
                "{names} keep their own target and ignore this goal. Clear it on the Sprinklers page to bring them in line.",
                { names: overridingSteps.join(", ") }
              )}
            </p>
          )}

          <div className="flex items-center justify-between gap-4 border-t border-stone-200 pt-4 dark:border-stone-800">
            <label className="flex items-center gap-3">
              <Toggle name="enabled" defaultChecked={schedule.enabled} />
              <span className="text-sm font-medium">
                {t("Schedule enabled")}
              </span>
            </label>
            <div className="flex items-center gap-3">
              <SavedFlash token={actionData}>{t("Saved")}</SavedFlash>
              <Button
                type="submit"
                variant="primary"
                busy={savingSchedule}
              >
                {t("Save")}
              </Button>
            </div>
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
            ? t("Add sprinklers in the order they should run.")
            : t("{start}–{end} · {minutes} min total", {
                start: startTime,
                end: addMinutes(startTime, totalMinutes),
                minutes: totalMinutes,
              })
        }
      >
        {timeline.length === 0 ? (
          <EmptyState title={t("No sprinklers in this schedule")} />
        ) : (
          <ol className="space-y-2">
            {timeline.map((step, index) => {
              const grouped = step.groupSize > 1
              const firstOfGroup = !step.startsWithPrevious
              const lastOfGroup = timeline[index + 1]?.group !== step.group

              return (
              <li
                key={step.id}
                onDragOver={(event) => {
                  if (draggingId == null) return
                  event.preventDefault()
                  moveStep(draggingId, step.id)
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  persistOrder()
                }}
                className={cx(
                  // Fixed columns rather than flex: the trailing control differs
                  // between the first row and the rest, and with flex that pushed
                  // every duration box to a different x.
                  //
                  // A phone gets two columns and stacks instead. The six-column
                  // layout used to apply at every width, which put the duration
                  // box in the 1.25rem drag-handle column — a number input a few
                  // millimetres wide. Every child below is placed explicitly so
                  // the stack cannot be re-flowed by accident.
                  "grid grid-cols-[auto_1fr] items-center gap-y-2 border p-3 transition-colors sm:gap-x-3",
                  "sm:grid-cols-[1.25rem_8rem_1fr_7rem_10rem_2rem]",
                  // A parallel group reads as one block: tinted, joined, and
                  // carrying a solid accent rail down its left edge.
                  grouped && "border-l-4 border-l-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30",
                  grouped && !firstOfGroup && "-mt-2 border-t-0",
                  grouped && firstOfGroup && "rounded-t-lg",
                  grouped && lastOfGroup && "rounded-b-lg",
                  !grouped && "rounded-lg",
                  draggingId === step.id
                    ? "border-emerald-500 bg-emerald-100 dark:bg-emerald-900/50"
                    : "border-stone-200 dark:border-stone-800"
                )}
              >
                <span
                  draggable
                  onDragStart={(event) => {
                    setDraggingId(step.id)
                    event.dataTransfer.effectAllowed = "move"
                    // Firefox ignores a drag that carries no data.
                    event.dataTransfer.setData("text/plain", String(step.id))
                  }}
                  onDragEnd={persistOrder}
                  aria-hidden
                  title="Drag to reorder"
                  // Hidden on touch widths: HTML5 drag-and-drop does not fire on
                  // a touchscreen at all, so the handle was an invitation to an
                  // interaction that could not happen. The arrows below replace
                  // it there.
                  className="hidden cursor-grab select-none px-1 text-stone-400 active:cursor-grabbing sm:block dark:text-stone-500"
                >
                  ⠿
                </span>

                <span className="col-start-2 row-start-2 whitespace-nowrap font-mono text-sm tabular-nums text-stone-500 sm:col-start-auto sm:row-start-auto dark:text-stone-400">
                  {step.startsAt}–{step.endsAt}
                </span>

                <span className="col-start-2 row-start-1 flex min-w-0 items-center gap-2 sm:col-start-auto sm:row-start-auto">
                  <span className="truncate font-medium">{step.name}</span>
                  {step.location != null && (
                    <span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                      {step.location}
                    </span>
                  )}
                  {grouped && firstOfGroup && (
                    <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">
                      {t("{count} at once", { count: step.groupSize })}
                    </span>
                  )}
                </span>

                {/*
                  One control row on a phone; `sm:contents` dissolves this back
                  into the six-column grid on a wider screen, so the desktop
                  layout is unchanged.
                */}
                <div className="col-start-2 row-start-3 flex flex-wrap items-center gap-x-3 gap-y-2 sm:contents">
                  <Form method="post" className="flex items-center gap-1 justify-self-start">
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
                      className="w-24 sm:w-20"
                      inputMode="numeric"
                      aria-label={`Duration for ${step.name} in minutes`}
                    />
                    <span className="text-sm text-stone-500 dark:text-stone-400">
                      {t("min")}
                    </span>
                  </Form>

                  <div className="flex items-center justify-end gap-2">
                    {index === 0 ? (
                      <span className="text-xs text-stone-400 dark:text-stone-500">
                        {t("starts the run")}
                      </span>
                    ) : (
                      <Form method="post" className="flex items-center gap-2">
                        <input
                          type="hidden"
                          name="intent"
                          value="toggle-parallel"
                        />
                        <input type="hidden" name="stepId" value={step.id} />
                        <span className="text-xs text-stone-500 dark:text-stone-400">
                          {t("With previous")}
                        </span>
                        <Toggle
                          name="startsWithPrevious"
                          checked={step.startsWithPrevious}
                          onChange={(event) => submit(event.currentTarget.form!)}
                          aria-label={`Run ${step.name} at the same time as the sprinkler above`}
                        />
                      </Form>
                    )}

                  </div>

                  {/*
                    Reordering for touch, where dragging cannot work. Plain form
                    posts of the `move-step` intent rather than a touch version of
                    the drag: one tap moves one place, which on a phone beats
                    dragging a row through a scrolling list.
                  */}
                  <div className="ml-auto flex items-center gap-1 sm:hidden">
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
                  </div>

                  <Form method="post" className="justify-self-end">
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
              )
            })}
          </ol>
        )}

        {disabledSteps.length > 0 && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">
              {t("Switched off, so never watered")}
            </p>
            <p className="mt-1">
              {t(
                "These sprinklers are off on the Sprinklers page. They are skipped entirely — no command is sent to the valve — and the times above already exclude them."
              )}
            </p>
            <ul className="mt-3 space-y-2">
              {disabledSteps.map((step) => (
                <li
                  key={step.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300/60 bg-white/40 px-3 py-2 dark:border-amber-900/60 dark:bg-black/20"
                >
                  <span className="font-medium">{step.name}</span>
                  <Form method="post">
                    <input type="hidden" name="intent" value="remove-step" />
                    <input type="hidden" name="stepId" value={step.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Remove ${step.name}`}
                    >
                      {t("Remove")}
                    </Button>
                  </Form>
                </li>
              ))}
            </ul>
          </div>
        )}

        {available.length > 0 && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Form
              method="post"
              className="flex min-w-48 flex-1 flex-wrap items-end gap-3"
            >
              <input type="hidden" name="intent" value="add-step" />
              <div className="min-w-40 flex-1">
                <Field label={t("Add sprinkler")}>
                  <Select name="valveId" className="mt-1">
                    {available.map((valve) => (
                      <option key={valve.id} value={valve.id}>
                        {valve.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Button type="submit" busy={addingStep}>
                {t("Add")}
              </Button>
            </Form>

            <Form method="post">
              <input type="hidden" name="intent" value="add-all-steps" />
              <Button type="submit" busy={addingAll}>
                {t("Add all")} {available.length > 1 && `(${available.length})`}
              </Button>
            </Form>
          </div>
        )}
      </Card>
    </>
  )
}
