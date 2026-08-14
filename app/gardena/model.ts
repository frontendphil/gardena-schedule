import z from "zod"

/**
 * The WebSocket sends *partial* service updates — a valve opening arrives as a
 * message carrying only `activity`. So every attribute is optional here and the
 * store merges attribute bags across messages before anything is parsed.
 */
const attribute = <T extends z.ZodType>(value: T) =>
  z.object({ value, timestamp: z.string().optional() })

/**
 * Gardena adds values over time (and returns `WARNING` where the docs only list
 * `OK`). Parsing these as open strings keeps an unknown value from throwing in a
 * loader; the booleans derived below are what the app actually uses.
 */
const valveAttributes = z.object({
  name: attribute(z.string()).optional(),
  activity: attribute(z.string()).optional(),
  state: attribute(z.string()).optional(),
  lastErrorCode: attribute(z.string()).optional(),
})

const sensorAttributes = z.object({
  soilHumidity: attribute(z.number()).optional(),
  soilTemperature: attribute(z.number()).optional(),
})

const commonAttributes = z.object({
  name: attribute(z.string()).optional(),
  batteryLevel: attribute(z.number()).optional(),
  batteryState: attribute(z.string()).optional(),
  rfLinkLevel: attribute(z.number()).optional(),
  rfLinkState: attribute(z.string()).optional(),
  serial: attribute(z.string()).optional(),
  modelType: attribute(z.string()).optional(),
})

export const VALVE_ACTIVITY = {
  closed: "CLOSED",
  manualWatering: "MANUAL_WATERING",
  scheduledWatering: "SCHEDULED_WATERING",
} as const

/** A Gardena valve as reported by the API, with the raw shape already resolved. */
export class Valve {
  readonly id: string
  readonly name: string
  readonly activity: string
  readonly state: string
  readonly lastErrorCode: string | null

  constructor(id: string, attributes: unknown) {
    const parsed = valveAttributes.parse(attributes)

    this.id = id
    this.name = parsed.name?.value ?? "Unnamed valve"
    this.activity = parsed.activity?.value ?? VALVE_ACTIVITY.closed
    this.state = parsed.state?.value ?? "UNAVAILABLE"
    this.lastErrorCode = parsed.lastErrorCode?.value ?? null
  }

  /** The controller this valve is attached to — used only for diagnostics. */
  get deviceId() {
    return this.id.split(":")[0]
  }

  get connected() {
    return this.state === "OK" || this.state === "WARNING"
  }

  get watering() {
    return this.activity !== VALVE_ACTIVITY.closed
  }
}

export class Sensor {
  readonly id: string
  readonly soilHumidity: number | null
  readonly soilTemperature: number | null
  readonly measuredAt: Date | null

  constructor(id: string, attributes: unknown) {
    const parsed = sensorAttributes.parse(attributes)

    this.id = id
    this.soilHumidity = parsed.soilHumidity?.value ?? null
    this.soilTemperature = parsed.soilTemperature?.value ?? null

    const timestamp = parsed.soilHumidity?.timestamp
    this.measuredAt = timestamp ? new Date(timestamp) : null
  }
}

export class Device {
  readonly id: string
  readonly name: string
  readonly modelType: string
  readonly online: boolean
  /** Percentage, or null for a mains-powered device. */
  readonly batteryLevel: number | null
  readonly batteryState: string | null
  readonly batteryMeasuredAt: Date | null
  /** Radio link quality, percentage. */
  readonly rfLinkLevel: number | null

  constructor(id: string, attributes: unknown) {
    const parsed = commonAttributes.parse(attributes)

    this.id = id
    this.name = parsed.name?.value ?? "Unnamed device"
    this.modelType = parsed.modelType?.value ?? "Unknown"
    this.online = parsed.rfLinkState?.value === "ONLINE"
    this.batteryState = parsed.batteryState?.value ?? null
    this.rfLinkLevel = parsed.rfLinkLevel?.value ?? null

    // Mains-powered devices report NO_BATTERY and no level at all.
    this.batteryLevel =
      this.batteryState === "NO_BATTERY"
        ? null
        : (parsed.batteryLevel?.value ?? null)

    const timestamp = parsed.batteryLevel?.timestamp
    this.batteryMeasuredAt = timestamp ? new Date(timestamp) : null
  }

  /** True when the device runs on batteries at all. */
  get hasBattery() {
    return this.batteryLevel != null
  }
}

/**
 * Every message the WebSocket and the `/locations/{id}` payload share: an id, a
 * service type and (except for the relationship-only entries) an attribute bag.
 */
export const serviceMessage = z.object({
  id: z.string(),
  type: z.string(),
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export type ServiceMessage = z.infer<typeof serviceMessage>
