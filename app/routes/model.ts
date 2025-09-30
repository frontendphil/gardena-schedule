import z from "zod"

const deviceSchema = z.object({
  id: z.string(),
  type: z.literal("DEVICE"),
})

const commonSchema = z.object({
  id: z.string(),
  type: z.literal("COMMON"),
})

const sensorSchema = z.object({
  id: z.string(),
  type: z.literal("SENSOR"),
})

const valveSetSchema = z.object({
  id: z.string(),
  type: z.literal("VALVE_SET"),
})

const valveSchema = z.object({
  id: z.string(),
  type: z.literal("VALVE"),
  attributes: z.object({
    name: z.object({ value: z.string() }),
    state: z.object({
      value: z.union([z.literal("OK"), z.literal("UNAVAILABLE")]),
    }),
    activity: z.object({
      value: z.union([z.literal("CLOSED"), z.literal("OPEN")]),
    }),
  }),
})

export const schema = z
  .discriminatedUnion("type", [
    deviceSchema,
    valveSchema,
    valveSetSchema,
    commonSchema,
    sensorSchema,
  ])
  .array()

export class Valve {
  public readonly id: string
  public readonly name: string
  public readonly connected: boolean
  public readonly open: boolean

  constructor(data: unknown) {
    const {
      id,
      attributes: { name, state, activity },
    } = valveSchema.parse(data)

    this.id = id
    this.name = name.value
    this.connected = state.value === "OK"
    this.open = activity.value === "OPEN"
  }
}
