/**
 * Finds the login that Gardena's app API accepts.
 *
 *   node scripts/check-account.mjs
 *
 * Reads GARDENA_EMAIL / GARDENA_PASSWORD from .env, tries each known-plausible
 * login shape, and prints status codes only — never the credentials, never a
 * whole token. Nothing leaves your machine except the login attempts.
 *
 * Why this is a search rather than one call: the measurement endpoint is
 * confirmed working, but the application key's OAuth client rejects the password
 * grant outright ("unauthorized_client: `grant_type` is invalid"). The token the
 * web app carries names a different client (`smartgarden-jwt-client`), so the
 * candidates below try that, and the legacy token endpoint the app host serves.
 */
import { readFileSync } from "node:fs"

const env = Object.fromEntries(
  readFileSync("./.env", "utf8")
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.trimStart().startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=")
      return [line.slice(0, index), line.slice(index + 1).trim()]
    })
)

const { GARDENA_EMAIL: email, GARDENA_PASSWORD: password } = env

if (!email || !password) {
  console.log("GARDENA_EMAIL / GARDENA_PASSWORD not set in .env — nothing to test.")
  process.exit(0)
}

const AUTH = "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token"

const candidates = [
  {
    name: "password grant, client_id=smartgarden-jwt-client",
    request: () => [
      AUTH,
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "smartgarden-jwt-client",
          username: email,
          password,
        }),
      },
    ],
  },
  {
    name: "password grant, client_id=husqvarna-group-account",
    request: () => [
      AUTH,
      {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "password",
          client_id: "husqvarna-group-account",
          username: email,
          password,
        }),
      },
    ],
  },
  {
    name: "legacy JSON:API token endpoint on smart.gardena.com",
    request: () => [
      "https://smart.gardena.com/v1/auth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: {
            type: "token",
            attributes: { username: email, password },
          },
        }),
      },
    ],
  },
]

let solved = false

for (const candidate of candidates) {
  const [url, init] = candidate.request()

  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    console.log(`  ERR   ${candidate.name}: ${error.message}`)
    continue
  }

  const text = await response.text()

  if (!response.ok) {
    let reason = text.slice(0, 160)
    try {
      const parsed = JSON.parse(text)
      reason = parsed.error_description ?? parsed.error ?? reason
    } catch {}
    console.log(`  ${response.status}   ${candidate.name}\n        ${reason}`)
    continue
  }

  // Report only the shape, never the token itself.
  let shape = "(unrecognised body)"
  try {
    const parsed = JSON.parse(text)
    const token =
      parsed.access_token ?? parsed.data?.attributes?.token ?? null
    shape = token
      ? `token found (${String(token).length} chars), keys: ${Object.keys(parsed).join(", ")}`
      : `no token field; keys: ${Object.keys(parsed).join(", ")}`
  } catch {}

  console.log(`  ${response.status}   ${candidate.name}\n        ${shape}`)
  solved = true
  break
}

console.log(
  solved
    ? "\nThat is the login to use — tell me which line succeeded and I will wire it in."
    : "\nNone worked. Capture the login request from the browser (log out, log in,\n" +
        "copy the token request as cURL, redact the password) and I will match it."
)
