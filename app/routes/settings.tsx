import { eq } from "drizzle-orm"
import { Form } from "react-router"

import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  SavedFlash,
  Select,
  Toggle,
  useIsPending,
} from "../components/ui"
import { LANGUAGES, LANGUAGE_LABELS, useLocale, useT } from "../i18n"
import { translatorFor } from "../i18n/server"
import { db } from "../db"
import {
  locations as locationsTable,
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { getRequestStats } from "../gardena/client"
import { hasAccountCredentials } from "../gardena/account"
import { readingAgeMinutes } from "../gardena/measure"
import { getConnectionState, getDevices, getSensor, getSensors } from "../gardena/store"
import { displayName } from "../scheduler/plan"
import type { Route } from "./+types/settings"

/** Process start, used to show how long the current build has been running. */
const START_TIME = new Date()

export const loader = async () => {
  const settings = db.select().from(settingsTable).get()!
  const connection = getConnectionState()

  // A sensor service shares its id with the device that carries the name, so
  // the picker can show "Sensor hinten" instead of a UUID fragment.
  const deviceNames = new Map(
    getDevices().map((device) => [device.id, device.name])
  )
  const locationNames = new Map(
    db.select().from(locationsTable).all().map((row) => [row.id, row.name])
  )
  const showLocation = locationNames.size > 1

  const sensors = getSensors().map((sensor) => {
    const device = getDevices().find((entry) => entry.id === sensor.id)

    return {
      id: sensor.id,
      name: deviceNames.get(sensor.id) ?? `Sensor ${sensor.id.slice(0, 8)}`,
      soilHumidity: sensor.soilHumidity,
      location:
        showLocation && device != null
          ? (locationNames.get(device.locationId) ?? null)
          : null,
    }
  })

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
    sensors,
    connection: {
      connected: connection.connected,
      connectedAt: connection.connectedAt,
      lastMessageAt: connection.lastMessageAt,
      lastError: connection.lastError,
    },
    requests: getRequestStats(),
    canForceMeasurement: hasAccountCredentials(),
    currentReadingAge: readingAgeMinutes(
      getSensor(settings.sensorId)?.measuredAt ?? null
    ),
    version: process.env.APP_VERSION ?? "dev",
    startedAt: START_TIME,
  }
}

export const action = async ({ request }: Route.ActionArgs) => {
  const t = translatorFor(request)
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
    return { error: t('"{zone}" is not a valid timezone.', { zone: timezone }) }
  }

  const maxReadingAge = Math.min(
    10080,
    Math.max(5, Math.round(Number(formData.get("maxReadingAgeMinutes") ?? 180)))
  )

  const requested = String(formData.get("language") ?? "auto")
  const language = (LANGUAGES as readonly string[]).includes(requested)
    ? requested
    : "auto"

  const sensorId = String(formData.get("sensorId") ?? "").trim()

  db.update(settingsTable)
    .set({
      sensorGateEnabled: formData.get("sensorGateEnabled") === "on",
      globalMoistureTarget: Number.isNaN(target) ? 30 : target,
      sensorId: sensorId === "" ? null : sensorId,
      maxReadingAgeMinutes: Number.isNaN(maxReadingAge) ? 180 : maxReadingAge,
      timezone,
      language,
    })
    .where(eq(settingsTable.id, 1))
    .run()

  return { ok: true, at: Date.now() }
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  const {
    settings,
    sensors,
    overrides,
    connection,
    requests,
    version,
    startedAt,
    canForceMeasurement,
    currentReadingAge,
  } = loaderData
  const t = useT()
  const saving = useIsPending("save-settings")

  // Explicit locale and zone: `toLocaleString()` resolves differently on the
  // server than in the browser, which shows up as a hydration mismatch.
  const locale = useLocale()

  const timeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: settings.timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    timeZone: settings.timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <>
      <Card
        title={t("Watering rules")}
        description={t(
          "Applies to every schedule. Individual sprinklers can override the moisture target."
        )}
      >
        <Form method="post" className="space-y-5">
          <input type="hidden" name="intent" value="save-settings" />
          <label className="flex items-start gap-3">
            <Toggle
              name="sensorGateEnabled"
              defaultChecked={settings.sensorGateEnabled}
            />
            <span>
              <span className="text-sm font-medium">
                {t("Let the soil sensor decide")}
              </span>
              <span className="mt-1 block text-sm text-stone-500 dark:text-stone-400">
                {t(
                  "A sprinkler is skipped when the sensor reads at or above its target. Checked again for each sprinkler as the schedule runs, so a long run reacts to the soil as it goes."
                )}
              </span>
            </span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("Global moisture target")}
              hint={t("Water only while the reading is below this.")}
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

            <Field label={t("Sensor")} hint={t("Used for the moisture check.")}>
              <Select
                name="sensorId"
                defaultValue={settings.sensorId ?? ""}
                className="mt-1"
              >
                <option value="">{t("First available")}</option>
                {sensors.map((sensor) => (
                  <option key={sensor.id} value={sensor.id}>
                    {sensor.name}
                    {sensor.location == null ? "" : ` (${sensor.location})`} ·{" "}
                    {sensor.soilHumidity == null
                      ? t("no reading")
                      : `${sensor.soilHumidity}%`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field
            label={t("Trust a reading for")}
            hint={
              canForceMeasurement
                ? t(
                    "Past this, the sensor is asked to measure again before the gate decides."
                  )
                : t(
                    "Past this, the reading is treated as unknown and the sprinkler waters."
                  )
            }
          >
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="number"
                name="maxReadingAgeMinutes"
                min={5}
                max={10080}
                defaultValue={settings.maxReadingAgeMinutes}
                className="max-w-32"
              />
              <span className="text-sm text-stone-500 dark:text-stone-400">
                {t("minutes")}
                {currentReadingAge != null &&
                  t(" · current reading is {age} min old", {
                    age: currentReadingAge,
                  })}
              </span>
            </div>
          </Field>

          <div className="rounded-lg bg-stone-100 px-4 py-3 text-sm dark:bg-stone-800/50">
            <p className="font-medium">
              {canForceMeasurement
                ? t("Can force a measurement")
                : t("Cannot force a measurement")}
            </p>
            <p className="mt-1 text-stone-600 dark:text-stone-400">
              {canForceMeasurement
                ? t(
                    "A Husqvarna account is configured, so a stale reading is refreshed before the gate decides. This uses Gardena's own app API, which is undocumented and may change; if it fails, the run falls back to watering."
                  )
                : t(
                    "Gardena's public API cannot ask the sensor to measure — only its own app can. Without a Husqvarna account configured, a reading older than the limit above counts as unknown and the sprinkler waters, so a sensor that stops reporting can never silently suppress watering."
                  )}
            </p>
          </div>

          {overrides.length > 0 && (
            <div className="rounded-lg bg-stone-100 px-4 py-3 text-sm dark:bg-stone-800/50">
              <p className="font-medium">
                {t("Sprinklers with their own target")}
              </p>
              <ul className="mt-1 space-y-0.5 text-stone-600 dark:text-stone-400">
                {overrides.map((override) => (
                  <li key={override.name}>
                    {override.name} — {override.target}%
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Field
            label={t("Timezone")}
            hint={t("Schedule start times are local to this zone.")}
          >
            <Input
              name="timezone"
              defaultValue={settings.timezone}
              className="mt-1"
            />
          </Field>

          <Field label={t("Language")} hint={t("Used for this app's own interface.")}>
            <Select
              name="language"
              defaultValue={settings.language}
              className="mt-1"
            >
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {t(LANGUAGE_LABELS[code])}
                </option>
              ))}
            </Select>
          </Field>

          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" busy={saving}>
              {t("Save")}
            </Button>
            {actionData != null && "ok" in actionData && (
              <SavedFlash token={actionData.at}>{t("Saved")}</SavedFlash>
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
        title={t("Gardena connection")}
        description={t(
          "State arrives over a WebSocket, so browsing this app costs no API requests."
        )}
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-stone-500 dark:text-stone-400">
              {t("Status")}
            </dt>
            <dd className="mt-1">
              {connection.connected ? (
                <Badge tone="good">{t("Connected")}</Badge>
              ) : (
                <Badge tone="bad">{t("Disconnected")}</Badge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-stone-400">
              {t("Last update")}
            </dt>
            <dd className="mt-1">
              {connection.lastMessageAt == null
                ? "—"
                : timeFormat.format(new Date(connection.lastMessageAt))}
            </dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-stone-400">
              {t("API requests this process")}
            </dt>
            <dd className="mt-1 tabular-nums">{requests.total}</dd>
          </div>
          <div>
            <dt className="text-stone-500 dark:text-stone-400">{t("Build")}</dt>
            <dd className="mt-1">
              <span className="tabular-nums">{version}</span>
              <span className="text-stone-500 dark:text-stone-400">
                {t(" · running since ")}
                {dateTimeFormat.format(new Date(startedAt))}
              </span>
            </dd>
          </div>
          {connection.lastError != null && (
            <div className="sm:col-span-2">
              <dt className="text-stone-500 dark:text-stone-400">
                {t("Last error")}
              </dt>
              <dd className="mt-1 text-red-600 dark:text-red-400">
                {connection.lastError}
              </dd>
            </div>
          )}
        </dl>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-stone-500 dark:text-stone-400">
            {t("Requests by endpoint")}
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
