import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router"

import type { Route } from "./+types/root"
import "./app.css"

export const meta: Route.MetaFunction = () => [{ title: "Gardena Scheduler" }]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <Meta />
        <Links />
      </head>
      <body className="h-full bg-stone-50 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong"
  let details = "An unexpected error occurred."
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Not found" : `Error ${error.status}`
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details
  } else if (error instanceof Error) {
    details = error.message
    if (import.meta.env.DEV) stack = error.stack
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="mt-2 text-stone-600 dark:text-stone-400">{details}</p>
      {stack && (
        <pre className="mt-6 overflow-x-auto rounded-lg bg-stone-100 p-4 text-xs dark:bg-stone-900">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
