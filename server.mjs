import { createRequestHandler } from "@react-router/express"
import compression from "compression"
import express from "express"
import { join, resolve } from "node:path"

/**
 * Production server.
 *
 * This replaces `react-router-serve` for one reason: Home Assistant Ingress.
 * Ingress publishes the add-on at `https://<home-assistant>/api/hassio_ingress/
 * <token>/…` where the token is per session, and Supervisor **strips** that
 * prefix before forwarding — the app sees `/settings`, and only learns the
 * public prefix from the `X-Ingress-Path` header.
 *
 * So every URL the app emits (links, form actions, asset `src`s, redirects)
 * has to carry a prefix that is not known at build time. React Router's
 * `basename` is a build-time config, but `ServerBuild` carries `basename` and
 * `publicPath` as plain fields, so a per-prefix handler can supply both — and
 * because the server serialises `basename` into `window.__reactRouterContext`,
 * the client hydrates with the same value and needs no changes at all.
 */

const BUILD_PATH = resolve("./build/server/index.js")
const CLIENT_PATH = resolve("./build/client")

const build = await import(BUILD_PATH)

/**
 * Only ever trust a header that looks exactly like an Ingress path. It becomes
 * the app's basename and is echoed into markup, so a malformed or hostile value
 * must not get through.
 */
const INGRESS_PATH = /^\/api\/hassio_ingress\/[A-Za-z0-9_-]+$/

const ingressPrefix = (request) => {
  const header = request.get("X-Ingress-Path")

  if (typeof header !== "string") return ""

  const prefix = header.endsWith("/") ? header.slice(0, -1) : header

  return INGRESS_PATH.test(prefix) ? prefix : ""
}

/**
 * Asset URLs are baked into the build's manifest, so overriding `publicPath` at
 * runtime does not move them — the manifest itself has to be rewritten. Every
 * `/`-prefixed string in it is an `/assets/…` URL, which makes the rewrite a
 * narrow, checkable transformation rather than a guess.
 */
const prefixAssets = (value, prefix) => {
  if (typeof value === "string") {
    return value.startsWith("/assets/") ? `${prefix}${value}` : value
  }

  if (Array.isArray(value)) {
    return value.map((entry) => prefixAssets(entry, prefix))
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        // `sri` is keyed by asset URL, so its keys move too.
        key.startsWith("/assets/") ? `${prefix}${key}` : key,
        prefixAssets(entry, prefix),
      ])
    )
  }

  return value
}

/**
 * One handler per prefix. Tokens rotate, so the cache is capped rather than
 * unbounded — a handler is cheap to rebuild and this is not a hot path.
 */
const handlers = new Map()
const MAX_HANDLERS = 16

const handlerFor = (prefix) => {
  const cached = handlers.get(prefix)

  if (cached != null) return cached

  if (handlers.size >= MAX_HANDLERS) {
    handlers.delete(handlers.keys().next().value)
  }

  const handler = createRequestHandler({
    build: {
      ...build,
      assets: prefix === "" ? build.assets : prefixAssets(build.assets, prefix),
      // Makes React Router emit prefixed links, form actions and data URLs…
      basename: prefix === "" ? (build.basename ?? "/") : prefix,
      // …and prefixed asset URLs. Requests for them arrive back stripped, so
      // the static middleware below still sees plain `/assets/…`.
      publicPath:
        prefix === "" ? build.publicPath : `${prefix}${build.publicPath ?? "/"}`,
    },
    mode: process.env.NODE_ENV,
  })

  handlers.set(prefix, handler)
  return handler
}

const app = express()

app.disable("x-powered-by")
app.use(compression())

// Assets are requested with the prefix already stripped by Supervisor, so they
// are served before any rewriting happens.
app.use(
  "/assets",
  express.static(join(CLIENT_PATH, "assets"), {
    immutable: true,
    maxAge: "1y",
  })
)
app.use(express.static(CLIENT_PATH, { maxAge: "1h" }))

// A catch-all `app.use` rather than `app.all("*")`: Express 5 parses route
// strings with path-to-regexp 8, which rejects a bare `*`.
app.use((request, response, next) => {
  const prefix = ingressPrefix(request)

  if (prefix !== "") {
    // React Router strips `basename` from the incoming path before matching,
    // but Supervisor already removed it — so put it back, or every route 404s.
    // The Express adapter builds its Request from `originalUrl`, so that is the
    // one that actually matters; `url` is kept in step for any other middleware.
    request.url = `${prefix}${request.url}`
    request.originalUrl = `${prefix}${request.originalUrl}`

    // A redirect from an action is a plain Response; React Router does not
    // prefix its Location, so a form post would send the browser to the Home
    // Assistant root instead of back into the add-on.
    const setHeader = response.setHeader.bind(response)

    response.setHeader = (name, value) => {
      if (
        name.toLowerCase() === "location" &&
        typeof value === "string" &&
        value.startsWith("/") &&
        !value.startsWith(`${prefix}/`)
      ) {
        return setHeader(name, `${prefix}${value}`)
      }

      return setHeader(name, value)
    }
  }

  return handlerFor(prefix)(request, response, next)
})

const port = Number(process.env.PORT ?? 3000)

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`[server] listening on http://0.0.0.0:${port}`)
})

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => server.close())
}
