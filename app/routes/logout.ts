import { href, redirect } from "react-router"

import type { Route } from "./+types/logout"
import { destroySession, getSession } from "./session"

export const action = async ({ request }: Route.ActionArgs) => {
  const session = await getSession(request.headers.get("Cookie"))

  return redirect(href("/login"), {
    headers: { "Set-Cookie": await destroySession(session) },
  })
}

export const loader = () => redirect(href("/login"))
