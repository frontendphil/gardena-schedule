/**
 * Optional access to Gardena's *private* app API, used for one thing the public
 * developer API cannot do: force the soil sensor to take a reading now.
 *
 * The public API has no such command — verified by probing `SENSOR_CONTROL`
 * with nine command spellings, against a positive control that proves a valid
 * command is distinguishable from an invalid one. What the official app calls is
 *
 *     POST https://smart.gardena.com/v1/devices/{deviceId}/abilities/humidity/command
 *          ?locationId={locationId}
 *     {"name":"measure_soil_humidity","parameters":{}}
 *
 * authenticated with a Husqvarna *account* token rather than the application
 * key and secret.
 *
 * Two consequences shape everything below:
 *
 *  - It needs the account password, which is a much stronger credential than an
 *    API key. So it is entirely optional: without it the app behaves exactly as
 *    it did before, and the moisture gate falls back to the staleness rule.
 *  - It is undocumented, so it may change without notice. Every failure here is
 *    caught and logged; a broken refresh must never take a watering run down
 *    with it.
 */

const APP_API = "https://smart.gardena.com/v1"
const TOKEN_URL =
  "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token"

/** Refresh a little before expiry rather than discovering it mid-run. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000

export const hasAccountCredentials = () =>
  (process.env.GARDENA_EMAIL ?? "") !== "" &&
  (process.env.GARDENA_PASSWORD ?? "") !== ""

type Token = { value: string; expiresAt: number }

let token: Token | null = null
let pending: Promise<Token> | null = null

/**
 * The OAuth client the Gardena web app itself uses.
 *
 * Not the application key: that client rejects the password grant outright
 * ("unauthorized_client: `grant_type` is invalid"). This id is the one carried
 * by the token the app sends, and it is the only one of the candidates tried
 * that authenticates.
 */
const ACCOUNT_CLIENT_ID = "smartgarden-jwt-client"

const requestToken = async (): Promise<Token> => {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: ACCOUNT_CLIENT_ID,
    username: process.env.GARDENA_EMAIL ?? "",
    password: process.env.GARDENA_PASSWORD ?? "",
  })

  const response = await fetch(TOKEN_URL, { method: "POST", body })

  if (!response.ok) {
    throw new Error(
      `Gardena account login failed: ${response.status} ${await response.text()}`
    )
  }

  const { access_token, expires_in } = await response.json()

  if (typeof access_token !== "string") {
    throw new Error("Gardena account login returned no access_token")
  }

  return {
    value: access_token,
    expiresAt: Date.now() + (expires_in ?? 86400) * 1000,
  }
}

const getAccountToken = async () => {
  if (token != null && Date.now() < token.expiresAt - REFRESH_MARGIN_MS) {
    return token.value
  }

  pending ??= requestToken()
    .then((fresh) => {
      token = fresh
      return fresh
    })
    .finally(() => {
      pending = null
    })

  return (await pending).value
}

/** Clears the cached token so the next call logs in again. */
export const resetAccountToken = () => {
  token = null
}

/**
 * Asks the sensor to measure now. Returns true if Gardena accepted the request.
 *
 * Acceptance is not the same as a new reading: the device answers over the
 * WebSocket a few seconds later, which is what the caller waits for.
 */
export const requestSoilMeasurement = async (
  deviceId: string,
  locationId: string
) => {
  const jwt = await getAccountToken()

  const url = `${APP_API}/devices/${deviceId}/abilities/humidity/command?locationId=${encodeURIComponent(locationId)}`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "authorization-provider": "husqvarna",
      "Content-Type": "application/json; charset=utf-8",
      accept: "*/*",
    },
    body: JSON.stringify({ name: "measure_soil_humidity", parameters: {} }),
  })

  if (response.status === 401 || response.status === 403) {
    // The token may simply have aged out; drop it so the next attempt re-logs in.
    resetAccountToken()
  }

  if (!response.ok) {
    throw new Error(
      `measure_soil_humidity failed: ${response.status} ${(await response.text()).slice(0, 200)}`
    )
  }

  return true
}
