import {
  createCookieSessionStorage,
  type Session as RRSession,
} from "react-router"

type Data = {
  token: string
}

export const { getSession, destroySession, commitSession } =
  createCookieSessionStorage<Data>({ cookie: { name: "__session" } })

export type Session = RRSession<Data>
