import { and, desc, eq, inArray } from "drizzle-orm"

import { db } from "../db"
import {
  runSteps,
  runs,
  scheduleSteps,
  schedules,
  settings as settingsTable,
  valves as valvesTable,
  type RunStepStatus,
  type Schedule,
} from "../db/schema"
import { startValve, stopValve } from "../gardena/client"
import { readingAgeMinutes, refreshSoilReading } from "../gardena/measure"
import { getSensor, getValves } from "../gardena/store"
import {
  buildPlan,
  decideMoisture,
  displayName,
  isDue,
  resolveMoistureTarget,
} from "./plan"

const TICK_MS = 30_000

/**
 * Hard stop for instances that must never open a valve.
 *
 * A development copy points at the same Gardena account as the real one, so a
 * schedule left enabled in a local database waters a real garden — at the wrong
 * time, in the wrong order, and with nothing in the deployed add-on's history to
 * explain it. Set `SCHEDULER_DISABLED=1` in any instance that is not the one in
 * charge of the garden.
 */
export const schedulerDisabled = () =>
  (process.env.SCHEDULER_DISABLED ?? "") !== ""

/**
 * Watering a valve for N minutes takes N minutes, so the run executor is a
 * long-lived async task rather than something the tick completes. Only one run is
 * ever active — valves share water pressure and must not overlap.
 */
type ActiveRun = {
  runId: number
  scheduleId: number
  scheduleName: string
  abort: AbortController
}

let active: ActiveRun | null = null
let tickTimer: NodeJS.Timeout | null = null
let running = false

export const getActiveRun = () =>
  active == null
    ? null
    : { runId: active.runId, scheduleId: active.scheduleId, scheduleName: active.scheduleName }

const getSettings = () => db.select().from(settingsTable).get()!

/** Resolves after `ms`, or immediately when the run is aborted. */
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()

    const timer = setTimeout(finish, ms)

    function finish() {
      clearTimeout(timer)
      signal.removeEventListener("abort", finish)
      resolve()
    }

    signal.addEventListener("abort", finish, { once: true })
  })

const finishStep = (
  stepId: number,
  status: RunStepStatus,
  detail?: string | null
) => {
  db.update(runSteps)
    .set({ status, detail: detail ?? null, finishedAt: new Date() })
    .where(eq(runSteps.id, stepId))
    .run()
}

/**
 * Runs one schedule end to end.
 *
 * Steps execute sequentially. A skipped step simply advances to the next one
 * immediately, which is what makes the run "shift earlier" — there is no
 * replanning, the remaining valves just start sooner.
 */
const executeRun = async (
  schedule: Schedule,
  scheduledDate: string,
  signal: AbortSignal
) => {
  const settings = getSettings()

  const steps = db
    .select()
    .from(scheduleSteps)
    .where(eq(scheduleSteps.scheduleId, schedule.id))
    .all()

  const valveRows = db.select().from(valvesTable).all()
  const valvesById = new Map(valveRows.map((row) => [row.id, row]))

  const plan = buildPlan(schedule, steps, valvesById, scheduledDate, settings.timezone)

  if (plan.steps.length === 0) return

  const run = db
    .insert(runs)
    .values({
      scheduleId: schedule.id,
      scheduledDate,
      startedAt: new Date(),
      status: "running",
    })
    .returning()
    .get()

  // `tick` created the active record before we had a run id; fill it in so
  // `abortActiveRun` can find this run's open steps.
  if (active != null) active.runId = run.id

  // Record the whole plan up front so the UI can show what is still to come.
  const createdSteps = db
    .insert(runSteps)
    .values(
      plan.steps.map((planned) => ({
        runId: run.id,
        valveId: planned.valve.id,
        valveName: displayName(planned.valve),
        position: planned.step.position,
        durationMinutes: planned.step.durationMinutes,
        status: "pending" as const,
      }))
    )
    .returning()
    .all()

  // Run-step rows are keyed by the planned step they came from, so a group can
  // find its own rows without relying on array positions lining up.
  const runStepByPlan = new Map(
    plan.steps.map((planned, index) => [planned.step.id, createdSteps[index]])
  )

  let aborted = false

  /**
   * Groups execute one after another; the valves *within* a group open together
   * and the group lasts as long as its longest member. A group of one is the
   * ordinary sequential case, so there is only this one path.
   */
  for (const group of plan.groups) {
    const rows = group.steps.map((planned) => ({
      planned,
      runStep: runStepByPlan.get(planned.step.id)!,
    }))

    if (signal.aborted) {
      for (const { runStep } of rows) {
        finishStep(runStep.id, "skipped_master_off", "Run stopped")
      }
      aborted = true
      continue
    }

    // Re-read for every group: the master switch or the schedule may have been
    // toggled while an earlier group was watering.
    const current = getSettings()

    if (!current.masterEnabled) {
      for (const { runStep } of rows) {
        finishStep(runStep.id, "skipped_master_off", "All schedules are off")
      }
      aborted = true
      continue
    }

    const freshSchedule = db
      .select()
      .from(schedules)
      .where(eq(schedules.id, schedule.id))
      .get()

    if (freshSchedule == null || !freshSchedule.enabled) {
      for (const { runStep } of rows) {
        finishStep(runStep.id, "skipped_schedule_off", "Schedule was disabled")
      }
      aborted = true
      continue
    }

    // A fresh reading per group, so a long run reacts to the soil as it goes.
    // When account credentials are configured the sensor is asked to measure
    // now if its last reading has aged out; otherwise the gate falls back to
    // treating a stale reading as unknown, which waters.
    if (current.sensorGateEnabled) {
      await refreshSoilReading({
        sensorId: current.sensorId,
        maxAgeMinutes: current.maxReadingAgeMinutes,
      })
    }

    const sensor = getSensor(current.sensorId)
    const reading = sensor?.soilHumidity ?? null
    const readingAge = readingAgeMinutes(sensor?.measuredAt ?? null)

    const started = (
      await Promise.all(
        rows.map(async ({ planned, runStep }) => {
          const valveRow =
            db
              .select()
              .from(valvesTable)
              .where(eq(valvesTable.id, planned.valve.id))
              .get() ?? planned.valve

          const apiValve = getValves().find(
            (valve) => valve.id === planned.valve.id
          )

          if (apiValve == null || !apiValve.connected) {
            finishStep(runStep.id, "skipped_unavailable", "Valve is not reachable")
            return null
          }

          // Re-read with the schedule, so editing its goal mid-run takes effect
          // from the next group — the same way the master switch does.
          const target = resolveMoistureTarget({
            valve: valveRow,
            scheduleTarget: freshSchedule.moistureTarget,
            globalTarget: current.globalMoistureTarget,
          })

          const decision = decideMoisture({
            valve: valveRow,
            scheduleTarget: freshSchedule.moistureTarget,
            globalTarget: current.globalMoistureTarget,
            sensorGateEnabled: current.sensorGateEnabled,
            reading,
            readingAgeMinutes: readingAge,
            maxReadingAgeMinutes: current.maxReadingAgeMinutes,
          })

          if (decision.skip) {
            db.update(runSteps)
              .set({
                status: "skipped_moisture",
                detail: `Soil at ${reading}%, target ${target}%${
                  readingAge == null ? "" : ` (measured ${readingAge} min ago)`
                }`,
                moistureReading: reading,
                moistureTarget: target,
                finishedAt: new Date(),
              })
              .where(eq(runSteps.id, runStep.id))
              .run()

            return null
          }

          db.update(runSteps)
            .set({
              status: "running",
              startedAt: new Date(),
              moistureReading: reading,
              moistureTarget: target,
              detail:
                decision.reason === "stale-reading"
                  ? `Watered anyway: sensor reading was ${readingAge} min old`
                  : null,
            })
            .where(eq(runSteps.id, runStep.id))
            .run()

          try {
            await startValve(planned.valve.id, planned.step.durationMinutes)
          } catch (error) {
            finishStep(
              runStep.id,
              "failed",
              error instanceof Error ? error.message : String(error)
            )
            return null
          }

          return { planned, runStep }
        })
      )
    ).filter((entry) => entry != null)

    // Nothing opened — hand straight over to the next group rather than idling
    // through the gap. This is what makes a skip shift the rest of the run
    // earlier.
    if (started.length === 0) continue

    const groupMinutes = Math.max(
      ...started.map(({ planned }) => planned.step.durationMinutes)
    )

    await sleep(groupMinutes * 60_000, signal)

    if (signal.aborted) {
      // The devices would close on their own, but an explicit stop makes "off"
      // immediate.
      await Promise.all(
        started.map(({ planned }) => stopValve(planned.valve.id).catch(() => {}))
      )

      for (const { runStep } of started) {
        finishStep(runStep.id, "completed", "Stopped early")
      }

      aborted = true
      continue
    }

    for (const { runStep } of started) finishStep(runStep.id, "completed")
  }

  db.update(runs)
    .set({ finishedAt: new Date(), status: aborted ? "aborted" : "completed" })
    .where(eq(runs.id, run.id))
    .run()
}

const hasRunOn = (scheduleId: number, scheduledDate: string) =>
  db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(eq(runs.scheduleId, scheduleId), eq(runs.scheduledDate, scheduledDate))
    )
    .get() != null

/**
 * One scheduler tick. Purely local — it never calls the Gardena API, so running
 * every 30 seconds costs nothing against the monthly request budget.
 */
export const tick = async (now = new Date()) => {
  if (schedulerDisabled()) return
  if (active != null) return

  const settings = getSettings()

  if (!settings.masterEnabled) return

  const candidates = db
    .select()
    .from(schedules)
    .where(eq(schedules.enabled, true))
    .all()

  for (const schedule of candidates) {
    const check = isDue(schedule, now, settings.timezone, (date) =>
      hasRunOn(schedule.id, date)
    )

    if (!check.due) continue

    const abort = new AbortController()

    active = {
      runId: -1,
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      abort,
    }

    try {
      await executeRun(schedule, check.scheduledDate, abort.signal)
    } catch (error) {
      console.error(`[scheduler] run of "${schedule.name}" failed`, error)
    } finally {
      active = null
    }

    return
  }
}

/**
 * Stops whatever is watering right now. Used by the master switch so turning
 * everything off takes effect immediately rather than at the end of the step.
 */
export const abortActiveRun = async () => {
  const current = active

  if (current == null) return

  current.abort.abort()

  const openSteps = db
    .select()
    .from(runSteps)
    .where(
      and(eq(runSteps.runId, current.runId), eq(runSteps.status, "running"))
    )
    .all()

  await Promise.all(openSteps.map((step) => stopValve(step.valveId).catch(() => {})))
}

/**
 * Marks runs left behind by a crash or redeploy as aborted.
 *
 * An interrupted run is never resumed: the valve's own duration already closed
 * it, and picking a run back up an unknown amount of time later would water at
 * the wrong hour.
 */
export const reconcileInterruptedRuns = () => {
  const stale = db
    .select()
    .from(runs)
    .where(eq(runs.status, "running"))
    .all()

  if (stale.length === 0) return

  const ids = stale.map((run) => run.id)

  db.update(runSteps)
    .set({
      status: "failed",
      detail: "Interrupted — the app restarted mid-run",
      finishedAt: new Date(),
    })
    .where(
      and(
        inArray(runSteps.runId, ids),
        inArray(runSteps.status, ["pending", "running"])
      )
    )
    .run()

  db.update(runs)
    .set({ status: "aborted", finishedAt: new Date() })
    .where(inArray(runs.id, ids))
    .run()

  console.warn(`[scheduler] marked ${stale.length} interrupted run(s) as aborted`)
}

export const startScheduler = () => {
  if (running) return

  if (schedulerDisabled()) {
    console.warn(
      "[scheduler] SCHEDULER_DISABLED is set — this instance will not run schedules or open any valve."
    )
    return
  }

  running = true
  reconcileInterruptedRuns()

  const loop = () => {
    void tick().catch((error) => console.error("[scheduler] tick failed", error))
    tickTimer = setTimeout(loop, TICK_MS)
  }

  loop()
}

export const stopScheduler = () => {
  running = false
  if (tickTimer != null) clearTimeout(tickTimer)
  tickTimer = null
}

/** Most recent runs with their steps, for the dashboard and history views. */
export const getRecentRuns = (limit = 10) => {
  const recent = db
    .select()
    .from(runs)
    .orderBy(desc(runs.startedAt))
    .limit(limit)
    .all()

  if (recent.length === 0) return []

  const steps = db
    .select()
    .from(runSteps)
    .where(inArray(runSteps.runId, recent.map((run) => run.id)))
    .all()

  const scheduleNames = new Map(
    db.select({ id: schedules.id, name: schedules.name }).from(schedules).all()
      .map((row) => [row.id, row.name])
  )

  return recent.map((run) => ({
    ...run,
    scheduleName: scheduleNames.get(run.scheduleId) ?? "Deleted schedule",
    steps: steps
      .filter((step) => step.runId === run.id)
      .sort((a, b) => a.position - b.position),
  }))
}
