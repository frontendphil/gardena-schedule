import { Device, Sensor, Valve, serviceMessage } from "./model"

type ServiceRecord = {
  type: string
  attributes: Record<string, unknown>
}

/**
 * In-memory mirror of the Gardena location, fed by the WebSocket.
 *
 * Route loaders read from here instead of calling the API, which is what keeps
 * the app inside the ~3000 requests/month budget. Because the socket sends
 * partial updates, attributes are merged per service rather than replaced.
 */
const services = new Map<string, ServiceRecord>()

let connectedAt: Date | null = null
let lastMessageAt: Date | null = null
let lastError: string | null = null

const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

/** Subscribe to state changes; returns an unsubscribe function. */
export const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const applyMessage = (raw: unknown) => {
  const parsed = serviceMessage.safeParse(raw)

  if (!parsed.success) return

  const { id, type, attributes } = parsed.data

  // Relationship-only messages (DEVICE, LOCATION) carry no attributes.
  if (attributes == null) return

  const key = `${type}:${id}`
  const existing = services.get(key)

  services.set(key, {
    type,
    attributes: { ...existing?.attributes, ...attributes },
  })

  lastMessageAt = new Date()
  notify()
}

export const markConnected = () => {
  connectedAt = new Date()
  lastError = null
  notify()
}

export const markDisconnected = (error: string | null) => {
  connectedAt = null
  lastError = error
  notify()
}

const recordsOfType = (type: string) =>
  [...services.entries()]
    .filter(([, record]) => record.type === type)
    .map(([key, record]) => ({
      id: key.slice(type.length + 1),
      attributes: record.attributes,
    }))

export const getValves = (): Valve[] =>
  recordsOfType("VALVE")
    .map(({ id, attributes }) => new Valve(id, attributes))
    .sort((a, b) => a.id.localeCompare(b.id))

export const getSensors = (): Sensor[] =>
  recordsOfType("SENSOR").map(({ id, attributes }) => new Sensor(id, attributes))

/**
 * The sensor used for moisture gating. `sensorId` comes from settings; when it is
 * unset (or points at a sensor that has gone away) the first sensor reporting
 * soil humidity is used, which is the right answer for a single-sensor garden.
 */
export const getSensor = (sensorId?: string | null): Sensor | null => {
  const sensors = getSensors()

  if (sensorId != null) {
    const match = sensors.find((sensor) => sensor.id === sensorId)
    if (match != null) return match
  }

  return sensors.find((sensor) => sensor.soilHumidity != null) ?? null
}

export const getDevices = (): Device[] =>
  recordsOfType("COMMON").map(({ id, attributes }) => new Device(id, attributes))

export const getConnectionState = () => ({
  connected: connectedAt != null,
  connectedAt,
  lastMessageAt,
  lastError,
  serviceCount: services.size,
})

/** Test seam — lets unit tests populate the store without a socket. */
export const resetStore = () => {
  services.clear()
  connectedAt = null
  lastMessageAt = null
  lastError = null
}
