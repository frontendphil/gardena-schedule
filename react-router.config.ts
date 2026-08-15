import type { Config } from "@react-router/dev/config"

export default {
  ssr: true,

  // Ship the whole route manifest with the first document instead of fetching
  // it at runtime. Under Home Assistant Ingress that runtime fetch would go to
  // an unprefixed URL, and the app is small enough that the difference is noise.
  routeDiscovery: { mode: "initial" },
  future: {
    // Lets the app layout guarantee that auth and the Gardena runtime have run
    // before any child loader. Sibling loaders run in parallel, so ordering
    // cannot be expressed with loaders alone.
    v8_middleware: true,
  },
} satisfies Config
