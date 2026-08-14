import { eq } from "drizzle-orm"
import { Form } from "react-router"

import { Badge, Button, Card, Field, Input, Select, Toggle } from "../components/ui"
import { db } from "../db"
import { settings as settingsTable, valves as valvesTable } from "../db/schema"
import { getRequestStats } from "../gardena/client"
import { getConnectionState, getSensors } from "../gardena/store"
import { displayName } from "../scheduler/plan"
import type { Route } from "./+types/settings"

/** Process start, used to show how long the current build has been running. */
const START_TIME = new Date()

export const loader = async () => {
  const settings = db.select().from(settingsTable).get()!
  const sensors = getSensors()
  const connection = getConnectionState()

  const overrides = db
    .select()
    .from(valvesTable)
    .all()
    .filter((valve) => valve.moistureTarget != null)
    .map((valve) => ({
      name: displayName(valve),
      target: valve.moistureTarget!,
    }))

  return {
    settings,
    overrides,
    sensors: sensors.map((sensor) => ({
      id: sensor.id,
      soilHumidity: sensor.soilHumidity,
    })),
    connection: {
      connected: connection.connected,
      connectedAt: connection.connectedAt,
      lastMessageAt: connection.lastMessageAt,
      lastError: connection.lastError,
    },
    requests: getRequestStats(),
    version: process.env.APP_VERSION ?? "dev",
    startedAt: START_TIME,
  }
}

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData()

  const target = Math.min(
    100,
    Math.max(0, Math.round(Number(formData.get("globalMoistureTarget") ?? 30)))
  )

  const timezone = String(formData.get("timezone") ?? "Europe/Berlin")

  try {
    // Reject an unknown zone here rather than letting every later time
    // calculation throw.
    new Intl.DateTimeFormat("en-US", { timeZone: timezone })
  } catch {
    return { error: `"${timezone}" is not a valid timezone.` }
  }

  const sensorId = String(formData.get("sensorId") ?? "").trim()

  db.update(settingsTable)
    .set({
      sensorGateEnabled: formData.get("sensorGateEnabled") === "on",
      globalMoistureTarget: Number.isNaN(target) ? 30 : target,
      sensorId: sensorId === "" ? null : sensorId,
      timezone,
    })
    .where(eq(settingsTable.id, 1))
    .run()

  return { ok: true }
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, sensors, overrides, connection, requests, version, startedAt } =
    loaderData

  return (
    <>
      <Card
        title="Watering rules"
        description="Applies to every schedule. Individual sprinklers can override the moisture target."
      >
        <Form method="post" className="space-y-5">
          <label className="flex items-start gap-3">
            <Toggle
              name="sensorGateEnabled"
              defaultChecked={settings.sensorGateEnabled}
            />
            <span>
              <span className="text-sm font-medium">
                Let the soil sensor decide
              </span>
              <span className="mt-1 block text-sm text-stone-500 dark:text-stone-400">
                A sprinkler is skipped when the sensor reads at or above its
                target. Checked again for each sprinkler as the schedule runs, so
                a long run reacts to the soil as it goes.
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Global moisture target"
              hint="Water only while the reading is below this."
            >
              <div className="mt-1 flex items-center gap-2">
                <Input
                  type="number"
                  name="globalMoistureTarget"
                  min={0}
                  max={100}
                  defaultValue={settings.globalMoistureTarget}
                />
                <span className="text-sm text-stone-500 dark:text-stone-400">
                  %
                </span>
              </div>
            </Field>

            <Field label="Sensor" hint="Used for the moisture check.">
              <Select
                name="sensorId"
                defaultValue={settings.sensorId ?? ""}
                className="mt-1"
              >
                <option value="">First available</option>
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.id.slice(0, 8)} ·{" "}
                    {sensor.soilHumidity == null
                      ? "no reading"
                      : `${sensor.soilHumidity}%`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {overrides.length > 0 && (
            <div className="rounded-lg bg-stone-100 px-4 py-3 text-sm dark:bg-stone-800/50">
              <p className="font-medium">Sprinklers with their own target</p>
              <ul className="mt-1 space-y-0.5 text-stone-600 dark:text-stone-400">
                {overrides.map((override) => (
                  <li key={override.name}>
                    {override.name} — {override.target}%
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field label="Timezone" hint="Schedule start times are local to this zone.">
            <Input
              name="timezone"
              defaultValue={settings.timezone}
              className="mt-1"
            />
          </Field>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary">
              Save
            </Button>
            {actionData != null && "ok" in actionData && (
              <span className="text-sm text-emerald-700 dark:text-emerald-400">
                Saved.
              </span>
            )}
            {actionData != null && "error" in actionData && (
              <span className="text-sm text-red-600 dark:text-red-400">
                {actionData.error}
              </span>
            )}
          </div>
        </Form>
      </Card>

      <Card
        title="Gardena connection"
        description="State arrives over a WebSocket, so browsing this app costs no API requests."
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone-500 dark:text-stone-400">Status</dt>
            <dd className="mt-1">
              {connection.connected ? (
                <Badge tone="good">Connected</Badge>
              ) : (
                <Badge tone="bad">Disconnected</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-stone-400">Last update</dt>
            <dd className="mt-1">
              {connection.lastMessageAt == null
                ? "—"
                : new Date(connection.lastMessageAt).toLocaleTimeString()}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-stone-400">
              API requests this process
            </dt>
            <dd className="mt-1 tabular-nums">{requests.total}</dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-stone-400">Build</dt>
            <dd className="mt-1">
              <span className="tabular-nums">{version}</span>
              <span className="text-stone-500 dark:text-stone-400">
                {" · running since "}
                {new Date(startedAt).toLocaleString()}
              </span>
            </dd>
          </div>
          {connection.lastError != null && (
            <div className="sm:col-span-2">
              <dt className="text-stone-500 dark:text-stone-400">Last error</dt>
              <dd className="mt-1 text-red-600 dark:text-red-400">
                {connection.lastError}
              </dd>
            </div>
          )}
        </dl>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-stone-500 dark:text-stone-400">
            Requests by endpoint
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            {Object.entries(requests.byPath).map(([path, count]) => (
              <li key={path} className="flex justify-between gap-4">
                <span className="truncate">{path}</span>
                <span className="tabular-nums">{count}</span>
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </>
  )
}
