import { describe, expect, it } from "vitest"

import type { Schedule, ScheduleStep, ValveRow } from "../db/schema"
import {
  buildPlan,
  byDisplayName,
  coversDate,
  displayName,
  getNextOccurrence,
  isDue,
  resolveMoistureTarget,
  shouldSkipForMoisture,
} from "./plan"
import {
  daysBetween,
  formatZonedTime,
  getLocalDateKey,
  getLocalWeekday,
  zonedTimeToUtc,
} from "./time"

const TZ = "Europe/Berlin"

const schedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: 1,
  name: "Morning",
  startTime: "06:00",
  recurrence: "weekly",
  daysOfWeek: 0b1111111,
  intervalDays: 2,
  anchorDate: null,
  enabled: true,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
})

const valve = (id: string, overrides: Partial<ValveRow> = {}): ValveRow => ({
  id,
  apiName: `API ${id}`,
  displayName: null,
  hidden: false,
  moistureTarget: null,
  lastSeenAt: null,
  ...overrides,
})

const step = (
  id: number,
  valveId: string,
  durationMinutes: number,
  position: number
): ScheduleStep => ({
  id,
  scheduleId: 1,
  valveId,
  durationMinutes,
  position,
})

describe("timezone handling", () => {
  it("resolves wall-clock time to the right instant in summer and winter", () => {
    // CEST (UTC+2) in July, CET (UTC+1) in January — the same 06:00 local.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 7, day: 15, hour: 6, minute: 0 },
        TZ
      ).toISOString()
    ).toBe("2026-07-15T04:00:00.000Z")

    expect(
      zonedTimeToUtc(
        { year: 2026, month: 1, day: 15, hour: 6, minute: 0 },
        TZ
      ).toISOString()
    ).toBe("2026-01-15T05:00:00.000Z")
  })

  it("keeps a 06:00 schedule at 06:00 local across the DST switch", () => {
    // 2026-03-29 is the spring-forward night in Europe/Berlin.
    const before = zonedTimeToUtc(
      { year: 2026, month: 3, day: 28, hour: 6, minute: 0 },
      TZ
    )
    const after = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 6, minute: 0 },
      TZ
    )

    expect(formatZonedTime(before, TZ)).toBe("06:00")
    expect(formatZonedTime(after, TZ)).toBe("06:00")

    // Only 23 hours of real time passed, which is exactly the point.
    expect(after.getTime() - before.getTime()).toBe(23 * 60 * 60 * 1000)
  })

  it("resolves a wall-clock time that does not exist on a spring-forward night", () => {
    // 02:30 never happens on 2026-03-29; the clock jumps 02:00 -> 03:00.
    const resolved = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      TZ
    )

    expect(formatZonedTime(resolved, TZ)).toBe("03:30")
  })

  it("derives the local calendar day, not the UTC one", () => {
    // 23:30 UTC is already the next day in Berlin.
    const instant = new Date("2026-07-15T23:30:00Z")

    expect(getLocalDateKey(instant, TZ)).toBe("2026-07-16")
    expect(getLocalDateKey(instant, "UTC")).toBe("2026-07-15")
  })

  it("uses Monday as weekday 0", () => {
    // 2026-08-17 is a Monday.
    expect(getLocalWeekday(new Date("2026-08-17T12:00:00Z"), TZ)).toBe(0)
    expect(getLocalWeekday(new Date("2026-08-23T12:00:00Z"), TZ)).toBe(6)
  })

  it("counts calendar days across a DST boundary exactly", () => {
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2)
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3)
  })
})

describe("buildPlan", () => {
  const valves = new Map([
    ["a:1", valve("a:1", { displayName: "Terrace" })],
    ["a:2", valve("a:2")],
    ["a:3", valve("a:3")],
  ])

  it("derives clock times from order and duration alone", () => {
    const plan = buildPlan(
      schedule(),
      [step(1, "a:1", 15, 0), step(2, "a:2", 20, 1), step(3, "a:3", 10, 2)],
      valves,
      "2026-07-15",
      TZ
    )

    expect(plan.steps.map((s) => formatZonedTime(s.startsAt, TZ))).toEqual([
      "06:00",
      "06:15",
      "06:35",
    ])
    expect(plan.totalMinutes).toBe(45)
    expect(formatZonedTime(plan.endsAt, TZ)).toBe("06:45")
  })

  it("orders by position, not by array order", () => {
    const plan = buildPlan(
      schedule(),
      [step(3, "a:3", 10, 2), step(1, "a:1", 15, 0), step(2, "a:2", 20, 1)],
      valves,
      "2026-07-15",
      TZ
    )

    expect(plan.steps.map((s) => s.valve.id)).toEqual(["a:1", "a:2", "a:3"])
  })

  it("drops steps whose valve has disappeared instead of throwing", () => {
    const plan = buildPlan(
      schedule(),
      [step(1, "a:1", 15, 0), step(2, "gone:9", 20, 1), step(3, "a:3", 10, 2)],
      valves,
      "2026-07-15",
      TZ
    )

    expect(plan.steps.map((s) => s.valve.id)).toEqual(["a:1", "a:3"])
    expect(plan.totalMinutes).toBe(25)
  })
})

describe("byDisplayName", () => {
  const sorted = (valves: ValveRow[]) =>
    [...valves].sort(byDisplayName).map((v) => displayName(v))

  it("sorts alphabetically, using the local rename when there is one", () => {
    expect(
      sorted([
        valve("a:1", { apiName: "Vorgarten" }),
        valve("a:2", { apiName: "Hochbeete" }),
        valve("a:3", { apiName: "Zzz", displayName: "Beet" }),
      ])
    ).toEqual(["Beet", "Hochbeete", "Vorgarten"])
  })

  it("ignores the trailing spaces Gardena stores in names", () => {
    expect(
      sorted([
        valve("a:1", { apiName: "Hecke Einfahrt " }),
        valve("a:2", { apiName: "Hafen" }),
      ])
    ).toEqual(["Hafen", "Hecke Einfahrt "])
  })

  it("orders numbered valves naturally rather than lexically", () => {
    expect(
      sorted([
        valve("a:1", { apiName: "Valve 10" }),
        valve("a:2", { apiName: "Valve 2" }),
      ])
    ).toEqual(["Valve 2", "Valve 10"])
  })

  it("sorts umlauts next to their base letter", () => {
    expect(
      sorted([
        valve("a:1", { apiName: "Zaun" }),
        valve("a:2", { apiName: "Über" }),
        valve("a:3", { apiName: "Apfel" }),
      ])
    ).toEqual(["Apfel", "Über", "Zaun"])
  })
})

describe("moisture gate", () => {
  it("falls back to the global target and lets a valve override it", () => {
    expect(resolveMoistureTarget(valve("a:1"), 20)).toBe(20)
    expect(
      resolveMoistureTarget(valve("a:1", { moistureTarget: 30 }), 20)
    ).toBe(30)
  })

  it("skips only when the reading has reached the applicable target", () => {
    const gate = (moistureTarget: number | null, reading: number | null) =>
      shouldSkipForMoisture({
        valve: { moistureTarget },
        globalTarget: 20,
        sensorGateEnabled: true,
        reading,
      })

    // Global target 20, reading 20 -> soil is wet enough, skip.
    expect(gate(null, 20)).toBe(true)
    expect(gate(null, 19)).toBe(false)

    // Raising this valve's target to 30 makes it water at a reading of 20.
    expect(gate(30, 20)).toBe(false)
    expect(gate(30, 30)).toBe(true)
  })

  it("waters when the gate is off or the sensor has no reading", () => {
    expect(
      shouldSkipForMoisture({
        valve: { moistureTarget: null },
        globalTarget: 20,
        sensorGateEnabled: false,
        reading: 90,
      })
    ).toBe(false)

    expect(
      shouldSkipForMoisture({
        valve: { moistureTarget: null },
        globalTarget: 20,
        sensorGateEnabled: true,
        reading: null,
      })
    ).toBe(false)
  })
})

describe("coversDate", () => {
  it("matches the selected weekdays in weekly mode", () => {
    // Mondays and Fridays.
    const weekly = schedule({ daysOfWeek: 0b0010001 })

    expect(coversDate(weekly, "2026-08-17", TZ)).toBe(true) // Monday
    expect(coversDate(weekly, "2026-08-18", TZ)).toBe(false) // Tuesday
    expect(coversDate(weekly, "2026-08-21", TZ)).toBe(true) // Friday
  })

  it("runs every second day from the anchor, ignoring weekdays", () => {
    const everySecondDay = schedule({
      recurrence: "interval",
      intervalDays: 2,
      anchorDate: "2026-08-17",
    })

    expect(coversDate(everySecondDay, "2026-08-17", TZ)).toBe(true)
    expect(coversDate(everySecondDay, "2026-08-18", TZ)).toBe(false)
    expect(coversDate(everySecondDay, "2026-08-19", TZ)).toBe(true)
    expect(coversDate(everySecondDay, "2026-08-20", TZ)).toBe(false)
  })

  it("keeps its phase across month, year and DST boundaries", () => {
    const everyThirdDay = schedule({
      recurrence: "interval",
      intervalDays: 3,
      anchorDate: "2026-03-28",
    })

    // 2026-03-29 is the spring-forward day; the cycle must not drift.
    expect(coversDate(everyThirdDay, "2026-03-31", TZ)).toBe(true)
    expect(coversDate(everyThirdDay, "2026-04-03", TZ)).toBe(true)
    expect(coversDate(everyThirdDay, "2026-04-04", TZ)).toBe(false)

    const acrossNewYear = schedule({
      recurrence: "interval",
      intervalDays: 2,
      anchorDate: "2026-12-30",
    })

    expect(coversDate(acrossNewYear, "2027-01-01", TZ)).toBe(true)
    expect(coversDate(acrossNewYear, "2027-01-02", TZ)).toBe(false)
  })

  it("never matches before the anchor date", () => {
    const future = schedule({
      recurrence: "interval",
      intervalDays: 2,
      anchorDate: "2026-08-17",
    })

    expect(coversDate(future, "2026-08-15", TZ)).toBe(false)
  })

  it("treats an interval of 1 as daily", () => {
    const daily = schedule({
      recurrence: "interval",
      intervalDays: 1,
      anchorDate: "2026-08-17",
    })

    expect(coversDate(daily, "2026-08-18", TZ)).toBe(true)
    expect(coversDate(daily, "2026-08-19", TZ)).toBe(true)
  })
})

describe("isDue", () => {
  const never = () => false
  const at = (local: string) => new Date(local)

  it("fires inside the grace window and not before the start", () => {
    expect(isDue(schedule(), at("2026-07-15T03:59:00Z"), TZ, never).due).toBe(
      false
    )
    expect(isDue(schedule(), at("2026-07-15T04:00:00Z"), TZ, never).due).toBe(
      true
    )
    expect(isDue(schedule(), at("2026-07-15T04:20:00Z"), TZ, never).due).toBe(
      true
    )
  })

  it("does not water hours late after a long outage", () => {
    const result = isDue(schedule(), at("2026-07-15T07:00:00Z"), TZ, never)

    expect(result.due).toBe(false)
    expect(result.reason).toBe("start window missed")
  })

  it("respects the enabled flag and the once-per-day guard", () => {
    expect(
      isDue(schedule({ enabled: false }), at("2026-07-15T04:00:00Z"), TZ, never)
        .reason
    ).toBe("schedule disabled")

    const ranToday = isDue(
      schedule(),
      at("2026-07-15T04:00:00Z"),
      TZ,
      (date) => date === "2026-07-15"
    )

    expect(ranToday.due).toBe(false)
    expect(ranToday.reason).toBe("already ran today")
  })

  it("uses the local calendar day for a schedule just after midnight", () => {
    // 23:30 UTC on the 15th is 01:30 on the 16th in Berlin.
    const nightly = schedule({ startTime: "01:30" })
    const result = isDue(nightly, at("2026-07-15T23:30:00Z"), TZ, never)

    expect(result.due).toBe(true)
    expect(result.scheduledDate).toBe("2026-07-16")
  })

  it("honours an interval recurrence", () => {
    const everySecondDay = schedule({
      recurrence: "interval",
      intervalDays: 2,
      anchorDate: "2026-07-15",
    })

    expect(isDue(everySecondDay, at("2026-07-15T04:00:00Z"), TZ, never).due).toBe(
      true
    )
    expect(isDue(everySecondDay, at("2026-07-16T04:00:00Z"), TZ, never).due).toBe(
      false
    )
    expect(isDue(everySecondDay, at("2026-07-17T04:00:00Z"), TZ, never).due).toBe(
      true
    )
  })
})

describe("getNextOccurrence", () => {
  it("finds the next matching day for a weekly schedule", () => {
    // Sunday 2026-08-16; next Monday-only run is the 17th.
    const mondayOnly = schedule({ daysOfWeek: 0b0000001 })
    const next = getNextOccurrence(
      mondayOnly,
      new Date("2026-08-16T12:00:00Z"),
      TZ
    )

    expect(getLocalDateKey(next!, TZ)).toBe("2026-08-17")
    expect(formatZonedTime(next!, TZ)).toBe("06:00")
  })

  it("looks past the end of the week for a long interval", () => {
    const everyTenDays = schedule({
      recurrence: "interval",
      intervalDays: 10,
      anchorDate: "2026-08-17",
    })

    const next = getNextOccurrence(
      everyTenDays,
      new Date("2026-08-18T12:00:00Z"),
      TZ
    )

    expect(getLocalDateKey(next!, TZ)).toBe("2026-08-27")
  })

  it("returns nothing for a disabled or empty schedule", () => {
    expect(
      getNextOccurrence(
        schedule({ enabled: false }),
        new Date("2026-08-16T12:00:00Z"),
        TZ
      )
    ).toBeNull()

    expect(
      getNextOccurrence(
        schedule({ daysOfWeek: 0 }),
        new Date("2026-08-16T12:00:00Z"),
        TZ
      )
    ).toBeNull()
  })
})
