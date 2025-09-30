import { getSession, type Session } from "./session"

export const api = async (session: Session, path: string) => {
  if (!session.has("token")) {
    throw new Error("Invalid session")
  }

  const url = new URL(`/v1/${path}`, "https://api.smart.gardena.dev")

  console.log(url.toString())

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.get("token")}`,
      "X-Api-Key": getAppKey(),
    },
  })

  return response.json()
}

export const getAppKey = () => {
  const GARDENA_APPLICATION_KEY = process.env.GARDENA_APPLICATION_KEY

  if (GARDENA_APPLICATION_KEY == null) {
    throw new Error("Missing GARDENA_APPLICATION_KEY")
  }

  return GARDENA_APPLICATION_KEY
}
