import { Form, href, redirect } from "react-router"

import { Button, Card, Input } from "../components/ui"
import type { Route } from "./+types/login"
import { commitSession, getSession, verifyPassword } from "./session"

/** Only ever redirect to a path on this app, never to an attacker-supplied host. */
const safeRedirect = (value: FormDataEntryValue | null) => {
  if (typeof value !== "string") return href("/")
  if (!value.startsWith("/") || value.startsWith("//")) return href("/")

  return value
}

export const loader = async ({ request }: Route.LoaderArgs) => {
  const session = await getSession(request.headers.get("Cookie"))

  if (session.get("authenticated") === true) throw redirect(href("/"))

  return null
}

export const action = async ({ request }: Route.ActionArgs) => {
  const formData = await request.formData()
  const password = String(formData.get("password") ?? "")

  if (!verifyPassword(password)) {
    return { error: "That password is not correct." }
  }

  const session = await getSession(request.headers.get("Cookie"))
  session.set("authenticated", true)

  return redirect(safeRedirect(formData.get("redirectTo")), {
    headers: { "Set-Cookie": await commitSession(session) },
  })
}

export default function Login({ actionData }: Route.ComponentProps) {
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card title="Garden" description="Sign in to manage your watering schedules." className="w-full max-w-sm">
        <Form method="post" className="space-y-4">
          <input
            type="hidden"
            name="redirectTo"
            value={
              typeof document === "undefined"
                ? ""
                : new URLSearchParams(document.location.search).get(
                    "redirectTo"
                  ) ?? ""
            }
          />
          <Input
            type="password"
            name="password"
            autoFocus
            required
            autoComplete="current-password"
            placeholder="Password"
          />
          {actionData?.error != null && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full">
            Sign in
          </Button>
        </Form>
      </Card>
    </main>
  )
}
