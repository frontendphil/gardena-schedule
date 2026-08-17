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
  future: {},
} satisfies Config
