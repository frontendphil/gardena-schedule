import { Device, Sensor, Valve, serviceMessage } from "./model"

type ServiceRecord = {
  type: string
  /** Which Gardena location this service belongs to. */
  locationId: string
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

/** id -> display name, for labelling sprinklers when there is more than one. */
const locations = new Map<string, string>()

/**
 * The `/locations` list and `/locations/{id}` detail can disagree about a
 * location's name; the list carries the one the user set, so it wins.
 */
export const setLocationName = (
  id: string,
  name: string,
  { authoritative = false } = {}
) => {
  if (!authoritative && locations.has(id)) return

  locations.set(id, name)
  notify()
}

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

export const applyMessage = (raw: unknown, locationId: string) => {
  const parsed = serviceMessage.safeParse(raw)

  if (!parsed.success) return

  const { id, type, attributes } = parsed.data

  // Relationship-only messages (DEVICE, LOCATION) carry no attributes.
  if (attributes == null) return

  // A LOCATION names itself — and uniquely among the services, its `name` is a
  // bare string rather than the usual `{ value, timestamp }` wrapper.
  if (type === "LOCATION") {
    const raw = (attributes as { name?: unknown }).name
    const name =
      typeof raw === "string"
        ? raw
        : ((raw as { value?: unknown })?.value ?? null)

    if (typeof name === "string" && name !== "") setLocationName(id, name)

    notify()
    return
  }

  const key = `${type}:${id}`
  const existing = services.get(key)

  services.set(key, {
    type,
    locationId,
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
      locationId: record.locationId,
      attributes: record.attributes,
    }))

export const getValves = (): Valve[] =>
  recordsOfType("VALVE")
    .map(({ id, locationId, attributes }) => new Valve(id, attributes, locationId))
    .sort((a, b) => a.id.localeCompare(b.id))

export const getSensors = (): Sensor[] =>
  recordsOfType("SENSOR").map(({ id, attributes }) => new Sensor(id, attributes))

export const getLocations = () =>
  [...locations.entries()].map(([id, name]) => ({ id, name }))

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
  recordsOfType("COMMON").map(
    ({ id, locationId, attributes }) => new Device(id, attributes, locationId)
  )

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
  locations.clear()
  connectedAt = null
  lastMessageAt = null
  lastError = null
}
