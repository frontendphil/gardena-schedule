import { migrateDatabase } from "../db"
import { startScheduler } from "../scheduler/runner"
import { startSocket } from "./socket"
import { subscribe } from "./store"
import { syncFromStore } from "./sync"

/**
 * Boots the long-lived side of the app: database migrations, the Gardena
 * WebSocket, valve sync and the scheduler tick.
 *
 * Vite reloads modules on every change in development, so this guards against
 * opening a second socket (each one costs an API call) via a global flag.
 */
declare global {
  var __gardenaRuntime: Promise<void> | undefined
}

const boot = async () => {
  migrateDatabase()

  // Keep the valve table in step with the account whenever the socket reports a
  // change. Cheap: it is a local upsert, not an API call.
  let syncTimer: NodeJS.Timeout | null = null

  subscribe(() => {
    if (syncTimer != null) return

    syncTimer = setTimeout(() => {
      syncTimer = null
      try {
        syncFromStore()
      } catch (error) {
        console.error("[runtime] valve sync failed", error)
      }
    }, 1000)
  })

  try {
    await startSocket()
  } catch (error) {
    console.error("[runtime] could not connect to Gardena", error)
  }

  // Run one sync inline rather than waiting for the debounced subscriber, so the
  // first request already sees the valve list instead of an empty page.
  try {
    syncFromStore()
  } catch (error) {
    console.error("[runtime] initial valve sync failed", error)
  }

  startScheduler()
}

export const ensureRuntime = () => {
  globalThis.__gardenaRuntime ??= boot()
  return globalThis.__gardenaRuntime
}
