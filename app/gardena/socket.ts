import { createWebsocketUrl, getLocation, getLocations } from "./client"
import {
  applyMessage,
  getConnectionState,
  markConnected,
  markDisconnected,
  resetStore,
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

let socket: WebSocket | null = null
let cachedLocationId: string | null = null
let failures = 0
let stopped = false

// Tracked individually rather than in a list: the silence timer is replaced on
// every message, and pushing each replacement onto an array would grow without
// bound over a two-hour connection.
let reconnectTimer: NodeJS.Timeout | null = null
let recycleTimer: NodeJS.Timeout | null = null
let silenceTimer: NodeJS.Timeout | null = null

const clearTimers = () => {
  for (const timer of [reconnectTimer, recycleTimer, silenceTimer]) {
    if (timer != null) clearTimeout(timer)
  }

  reconnectTimer = null
  recycleTimer = null
  silenceTimer = null
}

const resolveLocationId = async () => {
  if (cachedLocationId != null) return cachedLocationId

  const locations = (await getLocations()) as {
    data?: Array<{ id: string }>
  }

  const id = locations?.data?.[0]?.id

  if (id == null) {
    throw new Error("Gardena account has no locations")
  }

  cachedLocationId = id
  return id
}

/**
 * Seeds the store over REST. Only needed on the very first connection — after
 * that the socket itself pushes a full snapshot on connect.
 */
const seedFromRest = async (locationId: string) => {
  const location = (await getLocation(locationId)) as {
    included?: unknown[]
  }

  for (const item of location?.included ?? []) applyMessage(item)
}

const scheduleReconnect = () => {
  if (stopped) return

  const delay = Math.min(
    RECONNECT_BASE_MS * 2 ** failures,
    RECONNECT_MAX_MS
  )

  failures += 1
  reconnectTimer = setTimeout(() => void connect(), delay)
}

const connect = async (): Promise<void> => {
  if (stopped) return

  clearTimers()

  try {
    const locationId = await resolveLocationId()
    const url = await createWebsocketUrl(locationId)
    const ws = new WebSocket(url)

    socket = ws

    const resetSilenceTimer = () => {
      if (silenceTimer != null) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => ws.close(), SILENCE_TIMEOUT_MS)
    }

    ws.onopen = () => {
      failures = 0
      markConnected()
      resetSilenceTimer()

      // Recycle before Gardena drops us, so there is no window without state.
      recycleTimer = setTimeout(() => ws.close(), RECONNECT_AFTER_MS)
    }

    ws.onmessage = (event) => {
      resetSilenceTimer()

      const text = String(event.data).trim()

      // Keep-alive frames are empty.
      if (text === "") return

      try {
        applyMessage(JSON.parse(text))
      } catch {
        // A single malformed frame must not tear down the connection.
      }
    }

    ws.onerror = () => {
      markDisconnected("websocket error")
    }

    ws.onclose = () => {
      if (socket === ws) socket = null
      markDisconnected(null)
      scheduleReconnect()
    }
  } catch (error) {
    markDisconnected(error instanceof Error ? error.message : String(error))
    scheduleReconnect()
  }
}

/** How long the first connection may take before the app serves anyway. */
const FIRST_CONNECT_TIMEOUT_MS = 10_000

/**
 * Starts the single WebSocket that backs the whole app. Costs one REST call per
 * reconnect (~12/day) instead of two per page view.
 *
 * Resolves once the socket is actually open, so the first request after a
 * restart renders live state rather than an empty page. A Gardena outage must
 * not block the app forever, so the wait is capped — reconnection continues in
 * the background either way.
 */
export const startSocket = async () => {
  stopped = false

  await seedFromRest(await resolveLocationId())
  await connect()

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
  clearTimers()
  socket?.close()
  socket = null
  resetStore()
}
