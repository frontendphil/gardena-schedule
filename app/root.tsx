import {
  href,
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  redirect,
  Scripts,
  ScrollRestoration,
} from "react-router"

import type { Route } from "./+types/root"
import "./app.css"
import { getSession } from "./routes/session"
import { api } from "./routes/api"
import { schema, Valve } from "./routes/model"

export const loader = async ({ request }: Route.LoaderArgs) => {
  const session = await getSession(request.headers.get("Cookie"))

  if (!session.has("token")) {
    return redirect(href("/refresh-session"))
  }

  const locations = await api(session, "/locations")
  const locationDetails = await api(
    session,
    `/locations/${locations.data[0].id}`
  )

  const valves = schema
    .parse(locationDetails.included)
    .reduce<Valve[]>((result, item) => {
      if (item.type === "VALVE") {
        return [...result, new Valve(item)]
      }

      return result
    }, [])
    .filter((valve) => valve.connected)
    .sort((a, b) => a.name.localeCompare(b.name))

  return { valves }
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App({ loaderData: { valves } }: Route.ComponentProps) {
  return (
    <div className="flex flex-col">
      {valves.map((valve) => (
        <div key={valve.id}>{valve.name}</div>
      ))}
    </div>
  )
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error"
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
