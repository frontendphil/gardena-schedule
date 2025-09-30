import { type RouteConfig, index, route } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),
  route("refresh-session", "routes/refresh-session.ts"),
] satisfies RouteConfig
