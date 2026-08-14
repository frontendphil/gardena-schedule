import type { Config } from "@react-router/dev/config"

export default {
  ssr: true,
  future: {
    // Lets the app layout guarantee that auth and the Gardena runtime have run
    // before any child loader. Sibling loaders run in parallel, so ordering
    // cannot be expressed with loaders alone.
    v8_middleware: true,
  },
} satisfies Config
