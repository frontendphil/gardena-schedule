import type { Config } from "@react-router/dev/config"

export default {
  ssr: true,

  // Ship the whole route manifest with the first document instead of fetching
  // it at runtime. Under Home Assistant Ingress that runtime fetch would go to
  // an unprefixed URL, and the app is small enough that the difference is noise.
  routeDiscovery: { mode: "initial" },
  /**
   * Every v8 future flag is on, so the v8 upgrade itself is just a version bump.
   * A flag left off here would defer its behaviour change to the release, where
   * it would land mixed in with everything else.
   */
  future: {
    // Lets the app layout guarantee that auth and the Gardena runtime have run
    // before any child loader. Sibling loaders run in parallel, so ordering
    // cannot be expressed with loaders alone.
    v8_middleware: true,

    // Splits clientLoader/clientAction/HydrateFallback into their own chunks.
    // Purely an optimisation, with one thing to keep an eye on here: it adds
    // route-module URLs to the client manifest, which is the file server.mjs
    // rewrites for Ingress. That rewrite is a blanket replace of `"/assets/`,
    // so the extra chunks are covered — see the Ingress smoke test in
    // scripts/check-ingress.mjs.
    v8_splitRouteModules: true,

    // Hands loaders the raw request instead of a normalised one. Nothing in
    // `app/` reads `request.url` — the Ingress prefix is reapplied at the
    // Express level in server.mjs, which sets both `url` and `originalUrl` —
    // so this is a no-op for us today. Enabling it now stops a future loader
    // from quietly growing a dependency on the normalised form.
    v8_passThroughRequests: true,

    // Renames the root data request from `/_root.data` to `/_.data`. Only
    // matters for anything matching `.data` URLs; server.mjs matches assets and
    // the manifest, never `.data`, and Supervisor forwards it unchanged.
    v8_trailingSlashAwareDataRequests: true,

    // Uses Vite's Environment API. The migration is only needed for configs
    // branching on `isSsrBuild`; vite.config.ts does not.
    v8_viteEnvironmentApi: true,
  },
} satisfies Config
