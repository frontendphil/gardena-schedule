import { relations, sql } from "drizzle-orm"
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Single-row table holding the global switches. Requirements 4 and 5 live here:
 * `masterEnabled` gates every schedule, `sensorGateEnabled` + `globalMoistureTarget`
 * define the soil-moisture gate that individual valves may override.
 */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),
  masterEnabled: integer("master_enabled", { mode: "boolean" })
    .notNull()
    .default(true),
  sensorGateEnabled: integer("sensor_gate_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Water only while the sensor reads below this percentage. */
  globalMoistureTarget: integer("global_moisture_target").notNull().default(30),
  /** Gardena SENSOR service id used for gating. Null until one is discovered. */
  sensorId: text("sensor_id"),
  /**
   * How old a reading may be and still be trusted by the moisture gate.
   *
   * A sensor that stops reporting — flat battery, out of range — otherwise
   * freezes the gate on its last value. If that value said "wet", watering is
   * skipped indefinitely while every run still looks healthy.
   */
  maxReadingAgeMinutes: integer("max_reading_age_minutes").notNull().default(180),
  timezone: text("timezone").notNull().default("Europe/Berlin"),
  /**
   * UI language. `auto` follows the browser, because Home Assistant does not
   * tell an Ingress add-on which language the user picked.
   */
  language: text("language").notNull().default("auto"),
})

/**
 * Gardena groups devices under locations (usually one per property). Most
 * accounts have a single location and never see this; accounts with several get
 * their sprinklers labelled so two "Terrace" valves stay tellable apart.
 */
export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
})

/**
 * One row per Gardena VALVE service. The Gardena `DEVICE`/`VALVE_SET` layer is
 * deliberately not modelled — requirement 2 is that the UI only ever sees valves.
 *
 * Columns split into two groups: `apiName` mirrors Gardena and is overwritten on
 * every sync, everything else is user-authored and never touched by the sync.
 */
export const valves = sqliteTable("valves", {
  /** Gardena service id, `<deviceId>:<1-6>`. Stable across reboots. */
  id: text("id").primaryKey(),
  /** Null only for rows written before multi-location support existed. */
  locationId: text("location_id"),
  apiName: text("api_name").notNull(),
  /** Local rename. Falls back to `apiName` when null. */
  displayName: text("display_name"),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  /** Requirement 6: null means "inherit `settings.globalMoistureTarget`". */
  moistureTarget: integer("moisture_target"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
})

export const RECURRENCE = ["weekly", "interval"] as const
export type Recurrence = (typeof RECURRENCE)[number]

/** Requirement 3: several independently toggleable schedules. */
export const schedules = sqliteTable("schedules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** Wall-clock `HH:MM` interpreted in `settings.timezone`. */
  startTime: text("start_time").notNull(),
  /**
   * `weekly` picks specific weekdays; `interval` runs every N days regardless of
   * weekday. A 2-day cycle cannot be expressed as a weekday set, which is why
   * these are two modes rather than one.
   */
  recurrence: text("recurrence", { enum: RECURRENCE })
    .notNull()
    .default("weekly"),
  /** `weekly` only: 7-bit mask, bit 0 = Monday. 127 = every day. */
  daysOfWeek: integer("days_of_week").notNull().default(127),
  /** `interval` only: 1 = daily, 2 = every second day, 3 = every third day… */
  intervalDays: integer("interval_days").notNull().default(2),
  /**
   * `interval` only: the local `YYYY-MM-DD` the cycle counts from, so "every
   * second day" has a defined phase. Editing it shifts which days are on.
   */
  anchorDate: text("anchor_date"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  /**
   * A moisture goal shared by every sprinkler in this schedule, so a schedule
   * can stand in for an area — shade, lawn, pots — that wants wetter or drier
   * soil than the rest of the garden.
   *
   * Null means "inherit `settings.globalMoistureTarget`". A sprinkler's own
   * override still wins over this; see `resolveMoistureTarget`.
   */
  moistureTarget: integer("moisture_target"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
})

/**
 * Requirement 1: a schedule is authored purely as an ordered list of
 * (valve, duration) pairs. Absolute clock times are always derived, never stored.
 */
export const scheduleSteps = sqliteTable("schedule_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduleId: integer("schedule_id")
    .notNull()
    .references(() => schedules.id, { onDelete: "cascade" }),
  valveId: text("valve_id")
    .notNull()
    .references(() => valves.id, { onDelete: "cascade" }),
  durationMinutes: integer("duration_minutes").notNull(),
  position: integer("position").notNull(),
  /**
   * Starts at the same moment as the step before it instead of after it,
   * forming a parallel group. A Gardena controller can hold at most two of its
   * valves open at once, which `MAX_PARALLEL_PER_CONTROLLER` enforces.
   */
  startsWithPrevious: integer("starts_with_previous", { mode: "boolean" })
    .notNull()
    .default(false),
})

export const RUN_STATUS = [
  "running",
  "completed",
  "aborted",
  "failed",
] as const
export type RunStatus = (typeof RUN_STATUS)[number]

export const RUN_TRIGGER = ["schedule", "manual"] as const
export type RunTrigger = (typeof RUN_TRIGGER)[number]

/** Execution history — one row per time a schedule actually watered. */
export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheduleId: integer("schedule_id")
    .notNull()
    .references(() => schedules.id, { onDelete: "cascade" }),
  /**
   * Local calendar day `YYYY-MM-DD` the run belongs to. The scheduler fires a
   * schedule at most once per day, so for an automatic run this is also what
   * makes it unique; a run started by hand carries the day it was pressed on
   * and may sit alongside the automatic one.
   */
  scheduledDate: text("scheduled_date").notNull(),
  /**
   * Whether the scheduler started this run or somebody pressed *Run now*. A
   * manual run ignores the schedule's own on/off switch and does not stand in
   * for the day's automatic run — see `hasCoveringRun`.
   */
  trigger: text("trigger", { enum: RUN_TRIGGER }).notNull().default("schedule"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: RUN_STATUS }).notNull(),
})

export const RUN_STEP_STATUS = [
  "pending",
  "running",
  "completed",
  "skipped_moisture",
  "skipped_master_off",
  "skipped_schedule_off",
  "skipped_unavailable",
  "failed",
] as const
export type RunStepStatus = (typeof RUN_STEP_STATUS)[number]

/**
 * Per-valve outcome of a run. This is what makes "why didn't the hedge get
 * watered?" answerable after the fact.
 */
export const runSteps = sqliteTable("run_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  valveId: text("valve_id").notNull(),
  /** Snapshotted so history stays readable after a rename. */
  valveName: text("valve_name").notNull(),
  position: integer("position").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: RUN_STEP_STATUS }).notNull(),
  /** Human-readable explanation for a skip or failure. */
  detail: text("detail"),
  /** Sensor reading and threshold used for the gate decision, for debugging. */
  moistureReading: integer("moisture_reading"),
  moistureTarget: integer("moisture_target"),
})

export const schedulesRelations = relations(schedules, ({ many }) => ({
  steps: many(scheduleSteps),
  runs: many(runs),
}))

export const scheduleStepsRelations = relations(scheduleSteps, ({ one }) => ({
  schedule: one(schedules, {
    fields: [scheduleSteps.scheduleId],
    references: [schedules.id],
  }),
  valve: one(valves, {
    fields: [scheduleSteps.valveId],
    references: [valves.id],
  }),
}))

export const runsRelations = relations(runs, ({ one, many }) => ({
  schedule: one(schedules, {
    fields: [runs.scheduleId],
    references: [schedules.id],
  }),
  steps: many(runSteps),
}))

export const runStepsRelations = relations(runSteps, ({ one }) => ({
  run: one(runs, { fields: [runSteps.runId], references: [runs.id] }),
}))

export type Settings = typeof settings.$inferSelect
export type ValveRow = typeof valves.$inferSelect
export type Schedule = typeof schedules.$inferSelect
export type ScheduleStep = typeof scheduleSteps.$inferSelect
export type Run = typeof runs.$inferSelect
export type RunStep = typeof runSteps.$inferSelect
