/**
 * Wall-clock helpers built on `Intl` so no timezone dependency is needed.
 *
 * Schedules are authored as local wall-clock times ("06:30") and the server runs
 * in UTC, so every comparison has to go through the configured timezone or a DST
 * switch would move watering by an hour.
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>()

const getFormatter = (timeZone: string) => {
  let formatter = partsFormatter.get(timeZone)

  if (formatter == null) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsFormatter.set(timeZone, formatter)
  }

  return formatter
}

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export const getZonedParts = (date: Date, timeZone: string): ZonedParts => {
  const parts = getFormatter(timeZone).formatToParts(date)
  const lookup = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0")

  return {
    year: lookup("year"),
    month: lookup("month"),
    day: lookup("day"),
    hour: lookup("hour"),
    minute: lookup("minute"),
    second: lookup("second"),
  }
}

/** Offset in milliseconds that must be subtracted from a wall-clock reading. */
const getOffset = (date: Date, timeZone: string) => {
  const { year, month, day, hour, minute, second } = getZonedParts(
    date,
    timeZone
  )

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)

  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

/**
 * Converts a wall-clock time in `timeZone` to an absolute instant.
 *
 * The offset is resolved twice because the first guess uses the offset at the
 * wrong instant near a DST boundary. Times that do not exist (02:30 on a
 * spring-forward night) resolve to the instant the clock jumps to.
 */
export const zonedTimeToUtc = (
  { year, month, day, hour, minute }: Omit<ZonedParts, "second">,
  timeZone: string
): Date => {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0)

  const firstOffset = getOffset(new Date(asUtc), timeZone)
  const firstGuess = new Date(asUtc - firstOffset)

  const secondOffset = getOffset(firstGuess, timeZone)

  if (secondOffset === firstOffset) return firstGuess

  return new Date(asUtc - secondOffset)
}

/** Local calendar day as `YYYY-MM-DD`. Used as the per-run uniqueness key. */
export const getLocalDateKey = (date: Date, timeZone: string) => {
  const { year, month, day } = getZonedParts(date, timeZone)

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-")
}

/** Day of week with Monday = 0, matching the `daysOfWeek` bitmask. */
export const getLocalWeekday = (date: Date, timeZone: string) => {
  const { year, month, day } = getZonedParts(date, timeZone)

  // Noon UTC is far enough from either boundary that the calendar day is stable.
  const jsDay = new Date(Date.UTC(year, month - 1, day, 12)).getUTCDay()

  return (jsDay + 6) % 7
}

export const parseTimeOfDay = (value: string) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())

  if (match == null) {
    throw new Error(`Invalid time of day: ${value}`)
  }

  const hour = Number(match[1])
  const minute = Number(match[2])

  if (hour > 23 || minute > 59) {
    throw new Error(`Invalid time of day: ${value}`)
  }

  return { hour, minute }
}

export const formatTimeOfDay = (hour: number, minute: number) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`

/** Renders an instant as `HH:MM` in the configured zone, for the UI. */
export const formatZonedTime = (date: Date, timeZone: string) => {
  const { hour, minute } = getZonedParts(date, timeZone)

  return formatTimeOfDay(hour, minute)
}

/** Whole days between two `YYYY-MM-DD` keys. Exact: both sides are UTC midnights. */
export const daysBetween = (from: string, to: string) => {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number)
  const [toYear, toMonth, toDay] = to.split("-").map(Number)

  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay)
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay)

  return Math.round((toUtc - fromUtc) / 86_400_000)
}

export const addDays = (dateKey: string, days: number) => {
  const [year, month, day] = dateKey.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))

  return [
    String(shifted.getUTCFullYear()).padStart(4, "0"),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

export const DAY_NAMES = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const

export const ALL_DAYS = 0b1111111

export const hasDay = (daysOfWeek: number, weekday: number) =>
  (daysOfWeek & (1 << weekday)) !== 0

export const toggleDay = (daysOfWeek: number, weekday: number) =>
  daysOfWeek ^ (1 << weekday)

export const formatDays = (daysOfWeek: number) => {
  if ((daysOfWeek & ALL_DAYS) === ALL_DAYS) return "Every day"
  if (daysOfWeek === 0) return "Never"

  return DAY_NAMES.filter((_, index) => hasDay(daysOfWeek, index)).join(", ")
}
