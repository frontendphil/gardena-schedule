import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes"

export default [
  route("master", "routes/master.ts"),
  route("refresh", "routes/refresh.ts"),
  layout("routes/layout.tsx", [
    index("routes/dashboard.tsx"),
    route("schedules", "routes/schedules.tsx"),
    route("schedules/:scheduleId", "routes/schedule.tsx"),
    route("sprinklers", "routes/sprinklers.tsx"),
    route("settings", "routes/settings.tsx"),
  ]),
] satisfies RouteConfig
