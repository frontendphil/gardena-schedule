import { href, redirect } from "react-router"
import { commitSession, getSession } from "./session"
import type { Route } from "./+types/refresh-session"
import { getAppKey } from "./api"

export const loader = async ({ request }: Route.LoaderArgs) => {
  const session = await getSession(request.headers.get("Cookie"))

  const url = new URL(
    "v1/oauth2/token",
    "https://api.authentication.husqvarnagroup.dev"
  )

  const body = new URLSearchParams()
  body.set("grant_type", "client_credentials")
  body.set("client_id", getAppKey())
  body.set("client_secret", process.env.GARDENA_APPLICATION_SECRET)

  const response = await fetch(url, {
    method: "POST",
    body,
  })

  const gardena = await response.json()

  session.set("token", gardena.access_token)

  return redirect(href("/"), {
    headers: { "Set-Cookie": await commitSession(session) },
  })
}
