import { timingSafeEqual } from "node:crypto"
import { createCookieSessionStorage, href, redirect } from "react-router"

type Data = {
  authenticated: boolean
}

const getSessionSecret = () => {
  const secret = process.env.SESSION_SECRET

  if (secret == null || secret.length < 16) {
    throw new Error(
      "Missing SESSION_SECRET (at least 16 characters) — required to sign the login cookie"
    )
  }

  return secret
}

export const { getSession, destroySession, commitSession } =
  createCookieSessionStorage<Data>({
    cookie: {
      name: "__session",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
      secrets: [getSessionSecret()],
    },
  })

/**
 * Compares against `APP_PASSWORD` in constant time.
 *
 * The app controls physical valves and will be reachable from the internet, so a
 * single shared password is the minimum that should stand in front of it.
 */
export const verifyPassword = (candidate: string) => {
  const expected = process.env.APP_PASSWORD

  if (expected == null || expected === "") {
    throw new Error("Missing APP_PASSWORD")
  }

  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/** Guards a loader or action; redirects to the login page when signed out. */
export const requireSession = async (request: Request) => {
  const session = await getSession(request.headers.get("Cookie"))

  if (session.get("authenticated") !== true) {
    const url = new URL(request.url)
    const redirectTo = `${url.pathname}${url.search}`

    throw redirect(
      `${href("/login")}?redirectTo=${encodeURIComponent(redirectTo)}`
    )
  }

  return session
}
