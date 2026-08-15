import { createWebsocketUrl, getLocation, getLocations } from "./client"
import {
  applyMessage,
  getConnectionState,
  markConnected,
  markDisconnected,
  resetStore,
  setLocationName,
  subscribe,
} from "./store"

/**
 * Gardena closes the connection after roughly two hours. Reconnecting a little
 * early turns an unexpected drop into a scheduled one.
 */
const RECONNECT_AFTER_MS = 100 * 60 * 1000

/** Gardena sends a keep-alive regularly; a longer silence means a dead socket. */
const SILENCE_TIMEOUT_MS = 10 * 60 * 1000

const RECONNECT_BASE_MS = 10 * 1000
const RECONNECT_MAX_MS = 15 * 60 * 1000

/** How long the first connection may take before the app serves anyway. */
const FIRST_CONNECT_TIMEOUT_MS = 10_000

/**
 * A Gardena WebSocket is scoped to one location, so an account covering several
 * properties needs one connection each. Each carries its own timers and backoff
 * so a flaky gateway at one location cannot stall the others.
 */
type Connection = {
  locationId: string
  socket: WebSocket | null
  failures: number
  reconnectTimer: NodeJS.Timeout | null
  recycleTimer: NodeJS.Timeout | null
  silenceTimer: NodeJS.Timeout | null
}

const connections = new Map<string, Connection>()
let cachedLocationIds: string[] | null = null
let stopped = false

const clearTimers = (connection: Connection) => {
  for (const timer of [
    connection.reconnectTimer,
    connection.recycleTimer,
    connection.silenceTimer,
  ]) {
    if (timer != null) clearTimeout(timer)
  }

  connection.reconnectTimer = null
  connection.recycleTimer = null
  connection.silenceTimer = null
}

const resolveLocationIds = async () => {
  if (cachedLocationIds != null) return cachedLocationIds

  const locations = (await getLocations()) as {
    data?: Array<{ id: string; attributes?: { name?: string } }>
  }

  for (const location of locations?.data ?? []) {
    const name = location.attributes?.name

    if (typeof name === "string" && name !== "") {
      setLocationName(location.id, name, { authoritative: true })
    }
  }

  const ids = (locations?.data ?? []).map((location) => location.id)

  if (ids.length === 0) {
    throw new Error("Gardena account has no locations")
  }

  cachedLocationIds = ids
  return ids
}

/**
 * Seeds the store over REST. Only needed on the very first connection — after
 * that the socket itself pushes a full snapshot on connect.
 */
const seedFromRest = async (locationId: string) => {
  const location = (await getLocation(locationId)) as {
    data?: unknown
    included?: unknown[]
  }

  // The `data` member is the LOCATION itself, which is where its name lives.
  if (location?.data != null) applyMessage(location.data, locationId)

  for (const item of location?.included ?? []) applyMessage(item, locationId)
}

const scheduleReconnect = (connection: Connection) => {
  if (stopped) return

  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** connection.failures,
    RECONNECT_MAX_MS
  )

  connection.failures += 1
  connection.reconnectTimer = setTimeout(() => void connect(connection), delay)
}

const connect = async (connection: Connection): Promise<void> => {
  if (stopped) return

  clearTimers(connection)

  try {
    const url = await createWebsocketUrl(connection.locationId)
    const ws = new WebSocket(url)

    connection.socket = ws

    const resetSilenceTimer = () => {
      if (connection.silenceTimer != null) clearTimeout(connection.silenceTimer)
      connection.silenceTimer = setTimeout(() => ws.close(), SILENCE_TIMEOUT_MS)
    }

    ws.onopen = () => {
      connection.failures = 0
      markConnected()
      resetSilenceTimer()

      // Recycle before Gardena drops us, so there is no window without state.
      connection.recycleTimer = setTimeout(() => ws.close(), RECONNECT_AFTER_MS)
    }

    ws.onmessage = (event) => {
      resetSilenceTimer()

      const text = String(event.data).trim()

      // Keep-alive frames are empty.
      if (text === "") return

      try {
        applyMessage(JSON.parse(text), connection.locationId)
      } catch {
        // A single malformed frame must not tear down the connection.
      }
    }

    ws.onerror = () => {
      markDisconnected("websocket error")
    }

    ws.onclose = () => {
      if (connection.socket === ws) connection.socket = null
      markDisconnected(null)
      scheduleReconnect(connection)
    }
  } catch (error) {
    markDisconnected(error instanceof Error ? error.message : String(error))
    scheduleReconnect(connection)
  }
}

/**
 * Pulls every location over REST and folds it into the store.
 *
 * The WebSocket already pushes every change, so this exists for the case where
 * the socket has silently stopped delivering. It costs one API request per
 * location, which is why it is user-initiated rather than polled.
 */
export const resyncFromRest = async () => {
  for (const locationId of await resolveLocationIds()) {
    await seedFromRest(locationId)
  }
}

/**
 * Starts one WebSocket per location. Costs one REST call per location per
 * reconnect (~12/day each) instead of two per page view.
 */
export const startSocket = async () => {
  stopped = false

  const locationIds = await resolveLocationIds()

  for (const locationId of locationIds) {
    await seedFromRest(locationId)
  }

  for (const locationId of locationIds) {
    const connection: Connection = {
      locationId,
      socket: null,
      failures: 0,
      reconnectTimer: null,
      recycleTimer: null,
      silenceTimer: null,
    }

    connections.set(locationId, connection)
    await connect(connection)
  }

  // Resolve once anything is live rather than waiting for every location, so one
  // unreachable gateway cannot hold up the whole app. Reconnection continues in
  // the background either way.
  await new Promise<void>((resolve) => {
    if (getConnectionState().connected) return resolve()

    const timer = setTimeout(finish, FIRST_CONNECT_TIMEOUT_MS)
    const unsubscribe = subscribe(() => {
      if (getConnectionState().connected) finish()
    })

    function finish() {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
  })
}

export const stopSocket = () => {
  stopped = true

  for (const connection of connections.values()) {
    clearTimers(connection)
    connection.socket?.close()
    connection.socket = null
  }

  connections.clear()
  cachedLocationIds = null
  resetStore()
}
