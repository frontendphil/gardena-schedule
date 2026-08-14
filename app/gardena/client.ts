import { getAppKey, getToken, invalidateToken } from "./auth"

const BASE_URL = "https://api.smart.gardena.dev/v1"

/**
 * Gardena allows roughly 3000 requests per month. Every call goes through here so
 * the dashboard can show the real number and a regression that puts an API call
 * back into a route loader is immediately visible.
 */
const requestCount = { total: 0, byPath: new Map<string, number>() }

export const getRequestStats = () => ({
  total: requestCount.total,
  byPath: Object.fromEntries(requestCount.byPath),
})

type RequestOptions = {
  method?: string
  body?: unknown
  /** Internal: prevents infinite recursion when retrying after a 401. */
  retryOnUnauthorized?: boolean
}

const request = async (
  path: string,
  { method = "GET", body, retryOnUnauthorized = true }: RequestOptions = {}
): Promise<unknown> => {
  const token = await getToken()

  requestCount.total += 1
  const key = `${method} ${path.replace(/[0-9a-f-]{36}(:\d+)?/gi, ":id")}`
  requestCount.byPath.set(key, (requestCount.byPath.get(key) ?? 0) + 1)

  const response = await fetch(new URL(`${BASE_URL}${path}`), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Api-Key": getAppKey(),
      ...(body == null
        ? {}
        : { "Content-Type": "application/vnd.api+json" }),
    },
    body: body == null ? undefined : JSON.stringify(body),
  })

  if (response.status === 401 && retryOnUnauthorized) {
    invalidateToken()
    return request(path, { method, body, retryOnUnauthorized: false })
  }

  if (!response.ok) {
    throw new Error(
      `Gardena ${method} ${path} failed: ${response.status} ${await response.text()}`
    )
  }

  // Commands answer 202 with an empty body.
  if (response.status === 202 || response.status === 204) return null

  return response.json()
}

export const getLocations = () => request("/locations")

export const getLocation = (locationId: string) =>
  request(`/locations/${locationId}`)

/**
 * Returns a short-lived WebSocket URL (valid ~10s to connect; the resulting
 * connection then lives around two hours).
 */
export const createWebsocketUrl = async (locationId: string) => {
  const result = (await request("/websocket", {
    method: "POST",
    body: {
      data: {
        type: "WEBSOCKET",
        id: crypto.randomUUID(),
        attributes: { locationId },
      },
    },
  })) as { data?: { attributes?: { url?: string } } }

  const url = result?.data?.attributes?.url

  if (url == null) {
    throw new Error("Gardena did not return a websocket url")
  }

  return url
}

/**
 * Opens a valve for a fixed duration. The duration is enforced by the device, so
 * the valve closes itself even if this process dies mid-run — that timeout is the
 * safety net and the reason the runner never depends on sending a stop.
 *
 * Gardena requires a positive multiple of 60 seconds.
 */
export const startValve = (valveId: string, minutes: number) => {
  const seconds = Math.max(1, Math.round(minutes)) * 60

  return request(`/command/${valveId}`, {
    method: "PUT",
    body: {
      data: {
        type: "VALVE_CONTROL",
        id: crypto.randomUUID(),
        attributes: { command: "START_SECONDS_TO_OVERRIDE", seconds },
      },
    },
  })
}

/** Cancels watering on a valve and lets the schedule continue. */
export const stopValve = (valveId: string) =>
  request(`/command/${valveId}`, {
    method: "PUT",
    body: {
      data: {
        type: "VALVE_CONTROL",
        id: crypto.randomUUID(),
        attributes: { command: "STOP_UNTIL_NEXT_TASK" },
      },
    },
  })
