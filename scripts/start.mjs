import { spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"

/**
 * Server entrypoint for containers.
 *
 * Works in two environments without a separate image. Under plain Docker the
 * configuration arrives as environment variables; as a Home Assistant add-on it
 * arrives in /data/options.json, written by Supervisor from the add-on's
 * configuration page.
 */

const OPTIONS_PATH = "/data/options.json"

/** Add-on option name -> environment variable the app actually reads. */
const OPTION_ENV = {
  gardena_application_key: "GARDENA_APPLICATION_KEY",
  gardena_application_secret: "GARDENA_APPLICATION_SECRET",
}

const env = { ...process.env }

if (existsSync(OPTIONS_PATH)) {
  const options = JSON.parse(readFileSync(OPTIONS_PATH, "utf8"))

  for (const [option, variable] of Object.entries(OPTION_ENV)) {
    const value = options[option]

    if (typeof value === "string" && value !== "") env[variable] = value
  }

  // Supervisor gives every add-on a persistent /data, which is where the
  // database belongs.
  env.DATABASE_PATH ??= "/data/gardena.db"
}

env.DATABASE_PATH ??= "/data/gardena.db"

// Report bad configuration before anything else, so a first-time user sees the
// instruction rather than a stack trace from whatever fails first.
const missing = ["GARDENA_APPLICATION_KEY", "GARDENA_APPLICATION_SECRET"].filter(
  (variable) => !env[variable]
)

if (missing.length > 0) {
  console.error(
    `Missing configuration: ${missing.join(", ")}.\n` +
      (existsSync(OPTIONS_PATH)
        ? "Fill these in on the add-on's Configuration tab, then restart it."
        : "Set them in the container environment.")
  )
  process.exit(1)
}

const server = spawn("node", ["./server.mjs"], { stdio: "inherit", env })

// Supervisor stops add-ons with SIGTERM; pass it on so the process exits
// promptly instead of being killed after the grace period. The app closes its
// Gardena socket and scheduler on that signal — the timer is only a backstop in
// case something else is holding the event loop open.
const FORCE_KILL_AFTER_MS = 5000

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.kill(signal)
    setTimeout(() => server.kill("SIGKILL"), FORCE_KILL_AFTER_MS).unref()
  })
}

server.on("exit", (code, signal) => {
  process.exit(signal != null ? 1 : (code ?? 0))
})
