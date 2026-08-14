import { eq } from "drizzle-orm"
import { Form, useSubmit } from "react-router"

import { Badge, Button, Card, EmptyState, Input, Toggle } from "../components/ui"
import { db } from "../db"
import {
  settings as settingsTable,
  valves as valvesTable,
} from "../db/schema"
import { getValves } from "../gardena/store"
import { displayName } from "../scheduler/plan"
import type { Route } from "./+types/sprinklers"

export const loader = async () => {
  const settings = db.select().from(settingsTable).get()!

  // The Gardena `DEVICE` / `VALVE_SET` layer is intentionally not surfaced —
  // requirement 2 is that this screen is a flat list of sprinklers.
  const live = new Map(getValves().map((valve) => [valve.id, valve]))

  const valves = db
    .select()
    .from(valvesTable)
    .orderBy(valvesTable.sortOrder)
    .all()
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

    return null
  }

  if (intent === "toggle-hidden") {
    db.update(valvesTable)
      .set({ hidden: formData.get("visible") !== "on" })
      .where(eq(valvesTable.id, valveId))
      .run()

    return null
  }

  if (intent === "move") {
    const direction = formData.get("direction") === "up" ? -1 : 1

    // Reorder within the valves actually shown. Ordering against the full list
    // would let a visible valve swap places with a disabled one and appear to do
    // nothing.
    const visible = db
      .select()
      .from(valvesTable)
      .where(eq(valvesTable.hidden, false))
      .orderBy(valvesTable.sortOrder)
      .all()

    const index = visible.findIndex((valve) => valve.id === valveId)
    const target = index + direction

    if (index === -1 || target < 0 || target >= visible.length) return null

    db.transaction((tx) => {
      // Renumber the visible valves over the sort positions they already
      // occupy, which leaves the disabled ones exactly where they are.
      const positions = visible.map((valve) => valve.sortOrder).sort((a, b) => a - b)

      const reordered = [...visible]
      const [moved] = reordered.splice(index, 1)
      reordered.splice(target, 0, moved)

      reordered.forEach((valve, slot) => {
        tx.update(valvesTable)
          .set({ sortOrder: positions[slot] })
          .where(eq(valvesTable.id, valve.id))
          .run()
      })
    })

    return null
  }

  return null
}

type Sprinkler = Route.ComponentProps["loaderData"]["inUse"][number]

const DisableToggle = ({
  valve,
  onToggle,
}: {
  valve: Sprinkler
  onToggle: (form: HTMLFormElement) => void
}) => (
  <Form method="post" className="flex items-center gap-2">
    <input type="hidden" name="intent" value="toggle-hidden" />
    <input type="hidden" name="valveId" value={valve.id} />
    <span className="text-sm text-stone-500 dark:text-stone-400">In use</span>
    <Toggle
      name="visible"
      checked={!valve.hidden}
      onChange={(event) => onToggle(event.currentTarget.form!)}
      aria-label={`${valve.hidden ? "Enable" : "Disable"} ${valve.name}`}
    />
  </Form>
)

export default function Sprinklers({ loaderData }: Route.ComponentProps) {
  const { inUse, disabled, globalMoistureTarget } = loaderData
  const submit = useSubmit()
  const onToggle = (form: HTMLFormElement) => submit(form)

  return (
    <>
      <Card
        title="Sprinklers"
        description="Rename, reorder, and set a moisture target that differs from the global one."
      >
        {inUse.length === 0 ? (
          <EmptyState title="No sprinklers in use">
            {disabled.length > 0
              ? "Every valve is switched off below."
              : "They appear automatically once the Gardena connection is up."}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {inUse.map((valve, index) => (
              <li
                key={valve.id}
                className="rounded-lg border border-stone-200 p-4 dark:border-stone-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{valve.name}</span>
                    {valve.watering && <Badge tone="active">Watering</Badge>}
                    {!valve.known && <Badge tone="neutral">Not reported</Badge>}
                    {valve.known && !valve.connected && (
                      <Badge tone="bad">Unreachable</Badge>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    <Form method="post">
                      <input type="hidden" name="intent" value="move" />
                      <input type="hidden" name="valveId" value={valve.id} />
                      <input type="hidden" name="direction" value="up" />
                      <Button
                        type="submit"
                        variant="ghost"
                        disabled={index === 0}
                        aria-label={`Move ${valve.name} up`}
                      >
                        ↑
                      </Button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="move" />
                      <input type="hidden" name="valveId" value={valve.id} />
                      <input type="hidden" name="direction" value="down" />
                      <Button
                        type="submit"
                        variant="ghost"
                        disabled={index === inUse.length - 1}
                        aria-label={`Move ${valve.name} down`}
                      >
                        ↓
                      </Button>
                    </Form>
                    <span className="ml-2">
                      <DisableToggle valve={valve} onToggle={onToggle} />
                    </span>
                  </div>
                </div>

                <Form
                  method="post"
                  className="mt-3 flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="intent" value="save" />
                  <input type="hidden" name="valveId" value={valve.id} />

                  <label className="min-w-48 flex-1">
                    <span className="text-xs text-stone-500 dark:text-stone-400">
                      Name in Gardena: {valve.apiName}
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
                      Moisture target
                    </span>
                    <Input
                      type="number"
                      name="moistureTarget"
                      min={0}
                      max={100}
                      defaultValue={valve.moistureTarget ?? ""}
                      placeholder={`${globalMoistureTarget} (global)`}
                      className="mt-1"
                      aria-label={`Moisture target for ${valve.name}`}
                    />
                  </label>

                  <Button type="submit">Save</Button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Unused valves"
        description="Gardena reports every valve port as healthy whether or not anything is wired to it, so switch off the ones you do not use. They stay out of schedules and the dashboard."
      >
        {disabled.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            Every valve is in use.
          </p>
        ) : (
          <ul className="space-y-2">
            {disabled.map((valve) => (
              <li
                key={valve.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-stone-300 px-4 py-3 dark:border-stone-700"
              >
                <span className="text-stone-500 dark:text-stone-400">
                  {valve.name}
                </span>
                <DisableToggle valve={valve} onToggle={onToggle} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
