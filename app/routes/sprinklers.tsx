import { eq } from "drizzle-orm"
import { Form, useSubmit } from "react-router"

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  SavedFlash,
  Toggle,
  usePendingForm,
} from "../components/ui"
import { useT, type Translate } from "../i18n"
import { db } from "../db"
import {
  locations as locationsTable,
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { getValves } from "../gardena/store"
import { byDisplayName, displayName } from "../scheduler/plan"
import type { Route } from "./+types/sprinklers"

export const loader = async () => {
  const settings = db.select().from(settingsTable).get()!

  // The Gardena `DEVICE` / `VALVE_SET` layer is intentionally not surfaced —
  // requirement 2 is that this screen is a flat list of sprinklers.
  const live = new Map(getValves().map((valve) => [valve.id, valve]))

  // Only worth showing when an account actually spans several properties;
  // otherwise it is noise on every row.
  const locationNames = new Map(
    db.select().from(locationsTable).all().map((row) => [row.id, row.name])
  )
  const showLocation = locationNames.size > 1

  const valves = db
    .select()
    .from(valvesTable)
    .all()
    .sort(byDisplayName)
    .map((valve) => ({
      id: valve.id,
      name: displayName(valve),
      apiName: valve.apiName,
      displayName: valve.displayName,
      hidden: valve.hidden,
      moistureTarget: valve.moistureTarget,
      connected: live.get(valve.id)?.connected ?? false,
      watering: live.get(valve.id)?.watering ?? false,
      known: live.has(valve.id),
      location:
        showLocation && valve.locationId != null
          ? (locationNames.get(valve.locationId) ?? null)
          : null,
    }))

  return {
    inUse: valves.filter((valve) => !valve.hidden),
    disabled: valves.filter((valve) => valve.hidden),
    globalMoistureTarget: settings.globalMoistureTarget,
  }
}

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData()
  const intent = formData.get("intent")
  const valveId = String(formData.get("valveId") ?? "")

  if (intent === "save") {
    const name = String(formData.get("displayName") ?? "").trim()
    const rawTarget = String(formData.get("moistureTarget") ?? "").trim()

    // Blank means "inherit the global target" — requirement 6 hinges on the
    // difference between an empty override and an explicit number.
    const moistureTarget =
      rawTarget === ""
        ? null
        : Math.min(100, Math.max(0, Math.round(Number(rawTarget))))

    db.update(valvesTable)
      .set({
        displayName: name === "" ? null : name,
        moistureTarget: Number.isNaN(moistureTarget) ? null : moistureTarget,
      })
      .where(eq(valvesTable.id, valveId))
      .run()

    return { ok: true, valveId }
  }

  if (intent === "toggle-hidden") {
    db.update(valvesTable)
      .set({ hidden: formData.get("visible") !== "on" })
      .where(eq(valvesTable.id, valveId))
      .run()

    return null
  }

  return null
}

type Sprinkler = Route.ComponentProps["loaderData"]["inUse"][number]

const DisableToggle = ({
  valve,
  onToggle,
  t,
}: {
  valve: Sprinkler
  onToggle: (form: HTMLFormElement) => void
  t: Translate
}) => (
  <Form method="post" className="flex items-center gap-2">
    <input type="hidden" name="intent" value="toggle-hidden" />
    <input type="hidden" name="valveId" value={valve.id} />
    <span className="text-sm text-stone-500 dark:text-stone-400">
      {t("In use")}
    </span>
    <Toggle
      name="visible"
      checked={!valve.hidden}
      onChange={(event) => onToggle(event.currentTarget.form!)}
      aria-label={`${valve.hidden ? "Enable" : "Disable"} ${valve.name}`}
    />
  </Form>
)

export default function Sprinklers({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { inUse, disabled, globalMoistureTarget } = loaderData
  const submit = useSubmit()
  const t = useT()
  const pending = usePendingForm()
  const onToggle = (form: HTMLFormElement) => submit(form)

  // Narrowed to the row, so saving one sprinkler does not spin all nine.
  const savingValve =
    pending?.get("intent") === "save"
      ? String(pending.get("valveId"))
      : null

  return (
    <>
      <Card
        title={t("Sprinklers")}
        description={t(
          "Rename and set a moisture target that differs from the global one. Listed alphabetically; order only matters inside a schedule."
        )}
      >
        {inUse.length === 0 ? (
          <EmptyState title={t("No sprinklers in use")}>
            {disabled.length > 0
              ? t("Every valve is switched off below.")
              : t("They appear automatically once the Gardena connection is up.")}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {inUse.map((valve) => (
              <li
                key={valve.id}
                className="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{valve.name}</span>
                    {valve.location != null && (
                      <Badge tone="neutral">{valve.location}</Badge>
                    )}
                    {valve.watering && <Badge tone="active">{t("Watering")}</Badge>}
                    {!valve.known && <Badge tone="neutral">{t("Not reported")}</Badge>}
                    {valve.known && !valve.connected && (
                      <Badge tone="bad">{t("Unreachable")}</Badge>
                    )}
                  </div>

                  <DisableToggle valve={valve} onToggle={onToggle} t={t} />
                </div>

                <Form
                  method="post"
                  className="mt-3 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="valveId" value={valve.id} />

                  <label className="min-w-48 flex-1">
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {t("Name in Gardena: {name}", { name: valve.apiName })}
                    </span>
                    <Input
                      name="displayName"
                      defaultValue={valve.displayName ?? ""}
                      placeholder={valve.apiName}
                      className="mt-1"
                      aria-label={`Rename ${valve.name}`}
                    />
                  </label>

                  <label className="w-44">
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      {t("Moisture target")}
                    </span>
                    <Input
                      type="number"
                      name="moistureTarget"
                      min={0}
                      max={100}
                      defaultValue={valve.moistureTarget ?? ""}
                      placeholder={t("{target} (global)", { target: globalMoistureTarget })}
                      className="mt-1"
                      aria-label={`Moisture target for ${valve.name}`}
                    />
                  </label>

                  <div className="flex items-center gap-2">
                    <Button type="submit" busy={savingValve === valve.id}>
                      Save
                    </Button>
                    {actionData != null &&
                      "valveId" in actionData &&
                      actionData.valveId === valve.id && (
                        <SavedFlash token={actionData}>{t("Saved")}</SavedFlash>
                      )}
                  </div>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title={t("Unused valves")}
        description={t(
          "Gardena reports every valve port as healthy whether or not anything is wired to it, so switch off the ones you do not use. They stay out of schedules and the dashboard."
        )}
      >
        {disabled.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            {t("Every valve is in use.")}
          </p>
        ) : (
          <ul className="space-y-2">
            {disabled.map((valve) => (
              <li
                key={valve.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-stone-300 px-4 py-3 dark:border-stone-700"
              >
                <span className="flex items-center gap-2 text-stone-500 dark:text-stone-400">
                  {valve.name}
                  {valve.location != null && (
                    <Badge tone="neutral">{valve.location}</Badge>
                  )}
                </span>
                <DisableToggle valve={valve} onToggle={onToggle} t={t} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
