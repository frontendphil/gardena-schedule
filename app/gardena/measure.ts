import { hasAccountCredentials, requestSoilMeasurement } from "./account"
import { getSensor } from "./store"

/** How long to wait for the device to report back after asking it to measure. */
const MEASUREMENT_TIMEOUT_MS = 30_000
const POLL_MS = 1_000

export type RefreshOutcome =
  | "not-configured"
  | "fresh-enough"
  | "refreshed"
  | "timed-out"
  | "failed"
  | "no-sensor"

export const readingAgeMinutes = (measuredAt: Date | null, now = Date.now()) =>
  measuredAt == null
    ? null
    : Math.max(0, Math.round((now - measuredAt.getTime()) / 60_000))

/**
 * Brings the soil reading up to date before the moisture gate uses it, if that
 * is both possible and necessary.
 *
 * Only fires when the current reading is actually too old, so a run does not
 * poke the sensor it just heard from — which matters for a battery-powered
 * device. Every failure resolves to an outcome rather than an exception: a
 * refresh that does not work must leave the run to the staleness rule, not stop
 * it watering.
 */
export const refreshSoilReading = async ({
  sensorId,
  maxAgeMinutes,
  force = false,
}: {
  sensorId: string | null
  maxAgeMinutes: number
  /**
   * Measure even if the current reading is still within the age limit. Pressing
   * "Measure now" means measure — reporting "fresh enough" would be answering a
   * question the user did not ask.
   */
  force?: boolean
}): Promise<RefreshOutcome> => {
  const sensor = getSensor(sensorId)

  if (sensor == null) return "no-sensor"

  const age = readingAgeMinutes(sensor.measuredAt)

  if (!force && age != null && age <= maxAgeMinutes) return "fresh-enough"
  if (!hasAccountCredentials()) return "not-configured"

  const before = sensor.measuredAt?.getTime() ?? null

  try {
    await requestSoilMeasurement(sensor.deviceId, sensor.locationId)
  } catch (error) {
    console.error("[measure] could not request a soil measurement", error)
    return "failed"
  }

  // The new value arrives over the WebSocket, so wait for the timestamp to move
  // rather than assuming the command implies a reading.
  const deadline = Date.now() + MEASUREMENT_TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))

    const measuredAt = getSensor(sensorId)?.measuredAt?.getTime() ?? null

    if (measuredAt != null && measuredAt !== before) return "refreshed"
  }

  return "timed-out"
}
