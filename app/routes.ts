import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes"

export default [
  route("master", "routes/master.ts"),
  route("refresh", "routes/refresh.ts"),
  route("measure", "routes/measure.ts"),
  layout("routes/layout.tsx", [
    // The root only redirects to /dashboard — see routes/index.ts for why the
    // dashboard needs a path of its own under Ingress.
    index("routes/index.ts"),
    route("dashboard", "routes/dashboard.tsx"),
    route("schedules", "routes/schedules.tsx"),
    route("schedules/:scheduleId", "routes/schedule.tsx"),
    route("sprinklers", "routes/sprinklers.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig
