import type { Schedule, ScheduleStep, ValveRow } from "../db/schema"
import {
  ALL_DAYS,
  daysBetween,
  formatDays,
  getLocalDateKey,
  getLocalWeekday,
  getZonedParts,
  hasDay,
  parseTimeOfDay,
  zonedTimeToUtc,
} from "./time"

export type PlannedStep = {
  step: ScheduleStep
  valve: ValveRow
  /** Minutes after the schedule's start time, assuming nothing gets skipped. */
  offsetMinutes: number
  startsAt: Date
  endsAt: Date
}

export type Plan = {
  schedule: Schedule
  scheduledDate: string
  startsAt: Date
  endsAt: Date
  totalMinutes: number
  steps: PlannedStep[]
}

export const displayName = (valve: ValveRow) => valve.displayName ?? valve.apiName

/**
 * Whether a schedule covers a given local calendar day.
 *
 * `weekly` tests the weekday bitmask. `interval` counts whole days from
 * `anchorDate`, so "every second day" keeps its phase across month and year
 * boundaries and is unaffected by DST (the arithmetic is on calendar days, not
 * elapsed hours). Days before the anchor never match.
 */
export const coversDate = (schedule: Schedule, dateKey: string, timeZone: string) => {
  if (schedule.recurrence === "interval") {
    const interval = Math.max(1, schedule.intervalDays)

    // An interval schedule with no anchor has no defined phase; treat the day it
    // was created as the anchor so it still runs rather than silently never firing.
    const anchor =
      schedule.anchorDate ?? getLocalDateKey(schedule.createdAt, timeZone)

    const elapsed = daysBetween(anchor, dateKey)

    return elapsed >= 0 && elapsed % interval === 0
  }

  const [year, month, day] = dateKey.split("-").map(Number)
  const weekday = getLocalWeekday(new Date(Date.UTC(year, month - 1, day, 12)), timeZone)

  return hasDay(schedule.daysOfWeek, weekday)
}

/**
 * Resolves the absolute start of a schedule on a given local calendar day.
 */
export const getStartInstant = (
  schedule: Schedule,
  scheduledDate: string,
  timeZone: string
) => {
  const [year, month, day] = scheduledDate.split("-").map(Number)
  const { hour, minute } = parseTimeOfDay(schedule.startTime)

  return zonedTimeToUtc({ year, month, day, hour, minute }, timeZone)
}

/**
 * Turns the authored order-and-duration list into concrete times.
 *
 * This is requirement 1: the user only ever edits which valve comes next and for
 * how long, and every clock time in the UI is derived from that. Nothing here is
 * persisted — it is recomputed whenever the schedule is displayed or run.
 */
export const buildPlan = (
  schedule: Schedule,
  steps: ScheduleStep[],
  valvesById: Map<string, ValveRow>,
  scheduledDate: string,
  timeZone: string
): Plan => {
  const startsAt = getStartInstant(schedule, scheduledDate, timeZone)

  const ordered = [...steps].sort((a, b) => a.position - b.position)

  let offsetMinutes = 0
  const planned: PlannedStep[] = []

  for (const step of ordered) {
    const valve = valvesById.get(step.valveId)

    // A step whose valve vanished from the account is dropped from the plan
    // rather than throwing — the schedule as a whole must stay runnable.
    if (valve == null) continue

    const stepStart = new Date(startsAt.getTime() + offsetMinutes * 60_000)
    const stepEnd = new Date(
      stepStart.getTime() + step.durationMinutes * 60_000
    )

    planned.push({
      step,
      valve,
      offsetMinutes,
      startsAt: stepStart,
      endsAt: stepEnd,
    })

    offsetMinutes += step.durationMinutes
  }

  return {
    schedule,
    scheduledDate,
    startsAt,
    endsAt: new Date(startsAt.getTime() + offsetMinutes * 60_000),
    totalMinutes: offsetMinutes,
    steps: planned,
  }
}

/**
 * The moisture gate. A valve's own target wins over the global one, which is
 * requirements 5 and 6 in a single expression.
 */
export const resolveMoistureTarget = (
  valve: Pick<ValveRow, "moistureTarget">,
  globalTarget: number
) => valve.moistureTarget ?? globalTarget

export const shouldSkipForMoisture = ({
  valve,
  globalTarget,
  sensorGateEnabled,
  reading,
}: {
  valve: Pick<ValveRow, "moistureTarget">
  globalTarget: number
  sensorGateEnabled: boolean
  reading: number | null
}) => {
  if (!sensorGateEnabled) return false

  // No reading means no evidence the soil is wet; watering is the safe default.
  if (reading == null) return false

  return reading >= resolveMoistureTarget(valve, globalTarget)
}

/**
 * How late a schedule may still start. A restart at 06:02 should still run the
 * 06:00 schedule; a restart at 09:00 should not suddenly water at breakfast.
 */
export const START_GRACE_MINUTES = 30

export type DueCheck = {
  due: boolean
  scheduledDate: string
  startsAt: Date
  reason?: string
}

/**
 * Decides whether `schedule` should start right now.
 *
 * Deliberately does not look at the database — the caller supplies whether a run
 * already exists for the day, which keeps this function pure and testable.
 */
export const isDue = (
  schedule: Schedule,
  now: Date,
  timeZone: string,
  hasRunToday: (scheduledDate: string) => boolean,
  graceMinutes: number = START_GRACE_MINUTES
): DueCheck => {
  const scheduledDate = getLocalDateKey(now, timeZone)
  const startsAt = getStartInstant(schedule, scheduledDate, timeZone)

  const result = { scheduledDate, startsAt }

  if (!schedule.enabled) {
    return { ...result, due: false, reason: "schedule disabled" }
  }

  if (!coversDate(schedule, scheduledDate, timeZone)) {
    return { ...result, due: false, reason: "not scheduled today" }
  }

  const elapsedMinutes = (now.getTime() - startsAt.getTime()) / 60_000

  if (elapsedMinutes < 0) {
    return { ...result, due: false, reason: "not yet due" }
  }

  if (elapsedMinutes > graceMinutes) {
    return { ...result, due: false, reason: "start window missed" }
  }

  if (hasRunToday(scheduledDate)) {
    return { ...result, due: false, reason: "already ran today" }
  }

  return { ...result, due: true }
}

/**
 * The next instant a schedule will fire, used for the "next run" panel.
 *
 * Searches far enough ahead to cover a long interval as well as a weekday set
 * that only matches once a week.
 */
export const getNextOccurrence = (
  schedule: Schedule,
  now: Date,
  timeZone: string
): Date | null => {
  if (!schedule.enabled) return null

  if (schedule.recurrence === "weekly" && (schedule.daysOfWeek & ALL_DAYS) === 0) {
    return null
  }

  const horizon =
    schedule.recurrence === "interval"
      ? Math.max(1, schedule.intervalDays) + 1
      : 7

  const { year, month, day } = getZonedParts(now, timeZone)

  for (let offset = 0; offset <= horizon; offset += 1) {
    const candidate = new Date(Date.UTC(year, month - 1, day + offset, 12))
    const candidateDate = getLocalDateKey(candidate, timeZone)

    if (!coversDate(schedule, candidateDate, timeZone)) continue

    const startsAt = getStartInstant(schedule, candidateDate, timeZone)

    if (startsAt.getTime() > now.getTime()) return startsAt
  }

  return null
}

/** Human-readable recurrence, e.g. "Every second day" or "Mon, Wed, Fri". */
export const formatRecurrence = (schedule: Schedule) => {
  if (schedule.recurrence === "weekly") return formatDays(schedule.daysOfWeek)

  const interval = Math.max(1, schedule.intervalDays)

  if (interval === 1) return "Every day"
  if (interval === 2) return "Every second day"
  if (interval === 3) return "Every third day"

  return `Every ${interval} days`
}
