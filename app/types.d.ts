/**
 * Set by React Router's SSR handoff script. The server puts the Home Assistant
 * Ingress prefix here as the app's basename, and the client hydrates from it.
 */
interface Window {
  __reactRouterContext?: { basename?: string }
}
