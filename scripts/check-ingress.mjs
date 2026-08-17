/**
 * Smoke-tests the Home Assistant Ingress path handling in server.mjs.
 *
 *   node scripts/check-ingress.mjs        (after `pnpm build`)
 *
 * Ingress is the part of this app with no type safety and no unit test: the
 * prefix is a runtime string from a header, and every failure mode looks like
 * "the page renders but navigation does nothing". That has broken twice — once
 * because lazy route modules were fetched from unprefixed URLs, once because a
 * basename with a trailing slash matches the root and rejects every sub-path.
 *
 * Both were found by hand, in Home Assistant, after a release. This checks them
 * here instead. It matters most across a React Router upgrade, where asset
 * layout and data-URL naming can shift under the rewrite.
 *
 * The server is started with credentials that cannot authenticate and with the
 * scheduler disabled: this must never reach the real Gardena account.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PREFIX = "/api/hassio_ingress/abc123DEF456_test-token"
const PORT = 39_517
const BASE = `http://127.0.0.1:${PORT}`

const dataDir = mkdtempSync(join(tmpdir(), "ingress-check-"))

const server = spawn("node", ["server.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(PORT),
    DATABASE_PATH: join(dataDir, "test.db"),
    // Belt and braces: no valve may open because of this script.
    SCHEDULER_DISABLED: "1",
    GARDENA_APPLICATION_KEY: "check-ingress-not-a-real-key",
    GARDENA_APPLICATION_SECRET: "check-ingress-not-a-real-secret",
    GARDENA_EMAIL: "",
    GARDENA_PASSWORD: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
})

let serverLog = ""
server.stdout.on("data", (chunk) => (serverLog += chunk))
server.stderr.on("data", (chunk) => (serverLog += chunk))

const stop = () => {
  server.kill("SIGKILL")
  rmSync(dataDir, { recursive: true, force: true })
}

process.on("exit", stop)

const ingress = (path, init) =>
  fetch(`${BASE}${path}`, {
    redirect: "manual",
    ...init,
    headers: { "X-Ingress-Path": PREFIX, ...init?.headers },
  })

/** The server boots a runtime on first request, so allow a slow first hit. */
const waitForServer = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await fetch(BASE, { redirect: "manual" })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  throw new Error(`server did not start:\n${serverLog}`)
}

const failures = []
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures.push(name)
}

await waitForServer()

// ---------------------------------------------------------------- document
const documentResponse = await ingress("/")
const document = await documentResponse.text()

check("GET / is routed", documentResponse.status < 500, `status ${documentResponse.status}`)

check(
  "basename is the ingress prefix, with no trailing slash",
  document.includes(`"basename":"${PREFIX}"`),
  "a trailing slash here matches the root and rejects every sub-path"
)

const unprefixedInDocument = [
  ...document.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g),
].map((match) => match[1])

check(
  "every asset URL in the document carries the prefix",
  unprefixedInDocument.length === 0,
  unprefixedInDocument.slice(0, 3).join(", ")
)

// ---------------------------------------------------------------- manifest
// The regression that made navigation silently do nothing: route modules were
// listed here with unprefixed URLs, so every lazy import went to the Home
// Assistant root. `v8_splitRouteModules` adds more entries to this file, which
// is why it is asserted over rather than spot-checked.
const manifestUrl = document.match(
  new RegExp(`${PREFIX}(/assets/manifest-[^"]+\\.js)`)
)?.[1]

check("document references a route manifest", manifestUrl != null, manifestUrl ?? "")

if (manifestUrl != null) {
  const manifestResponse = await ingress(manifestUrl)
  const manifest = await manifestResponse.text()

  const unprefixed = [...manifest.matchAll(/"(\/assets\/[^"]+)"/g)].map((m) => m[1])
  const prefixed = [...manifest.matchAll(new RegExp(`"${PREFIX}(/assets/[^"]+)"`, "g"))]

  check(
    "every route module in the manifest carries the prefix",
    unprefixed.length === 0,
    unprefixed.slice(0, 3).join(", ")
  )
  check("the manifest actually lists modules", prefixed.length > 0, `${prefixed.length} entries`)
  check(
    "the rewritten manifest is not cacheable",
    manifestResponse.headers.get("cache-control") === "no-store",
    "it is per-session, and a cached copy would leak another session's token"
  )
}

// ---------------------------------------------------------------- sub-routes
for (const path of ["/schedules", "/sprinklers", "/settings"]) {
  const response = await ingress(path)
  check(`GET ${path} is routed`, response.status < 500, `status ${response.status}`)
}

const missing = await ingress("/definitely-not-a-route")
check("an unknown path still 404s", missing.status === 404, `status ${missing.status}`)

// ------------------------------------------------------------- data requests
// These are what a client-side navigation actually fetches, so a data URL that
// does not route is the "navigation does nothing" failure all over again.
// Supervisor forwards them unchanged; all that matters is that they route.
//
// `/_.data` is the root data request under `v8_trailingSlashAwareDataRequests`.
// It was `/_root.data` in v7, and that name is deliberately gone — asserted
// below so this file explains the rename rather than quietly encoding it.
for (const path of ["/_.data", "/settings.data"]) {
  const response = await ingress(path)
  const routed = response.status < 500 && response.status !== 404
  check(`data request ${path} is routed`, routed, `status ${response.status}`)
}

check(
  "the v7 root data URL /_root.data is gone",
  (await ingress("/_root.data")).status === 404,
  "renamed to /_.data by v8_trailingSlashAwareDataRequests"
)

// ----------------------------------------------------------------- redirects
// React Router applies `basename` to a redirect itself. server.mjs must
// therefore leave the value alone apart from one repair, and an earlier version
// that prefixed the whole thing double-prefixed every redirect. Creating a
// schedule is the redirect a user actually hits; the temp database makes it
// throwaway, and SCHEDULER_DISABLED means it could never run regardless.
const created = await ingress("/schedules", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: "intent=create&name=ingress-check",
})

const location = created.headers.get("location")

check(
  "creating a schedule redirects",
  created.status >= 300 && created.status < 400 && location != null,
  `status ${created.status}`
)

check(
  "a redirect is prefixed exactly once",
  location != null &&
    location.startsWith(`${PREFIX}/`) &&
    !location.startsWith(`${PREFIX}${PREFIX}`),
  location ?? "no Location header"
)

// ------------------------------------------------------------ without ingress
// Served directly (no header), nothing may be prefixed.
const plain = await fetch(BASE, { redirect: "manual" })
const plainBody = await plain.text()

check(
  "without the header the app is unprefixed",
  !plainBody.includes(PREFIX) && plain.status < 500,
  `status ${plain.status}`
)

const spoofed = await fetch(BASE, {
  headers: { "X-Ingress-Path": "/api/hassio_ingress/../../etc" },
  redirect: "manual",
})

check(
  "a malformed X-Ingress-Path is ignored",
  !(await spoofed.text()).includes("etc"),
  "the header becomes the basename and is echoed into markup"
)

stop()

if (failures.length > 0) {
  console.log(`\n${failures.length} Ingress check(s) failed:`)
  for (const name of failures) console.log(`  ${name}`)
  console.log(`\nserver output:\n${serverLog}`)
  process.exit(1)
}

console.log("\nIngress path handling is intact.")
process.exit(0)
