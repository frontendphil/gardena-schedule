# Garden

A scheduling app for a GARDENA smart irrigation system, built on the official
Gardena Smart System API and backed by a local SQLite database.

Schedules are authored the way you actually think about watering — *"start at
06:30, then run these sprinklers for these durations"* — and the app derives every
clock time from that.

## Why there is a database

The Gardena API has no schedule endpoints. It can report device state and accept
commands, and nothing else. So this app owns scheduling itself: it stores the
schedules locally and opens each valve at the right moment with
`START_SECONDS_TO_OVERRIDE`.

Two consequences worth knowing:

- **Delete your schedules in the Gardena app.** This app should be the only thing
  opening valves; otherwise two schedulers fight over the same hardware.
- **The host must stay awake.** A sleeping process is a schedule that silently
  does not water. On Fly.io set `min_machines_running = 1` and disable
  scale-to-zero.

The valve duration is enforced by the device itself, so a valve closes on its own
even if this app crashes mid-run. The app never depends on sending a stop.

## Staying inside the API rate limit

Gardena allows roughly **3000 requests per month** (about one call per 15
minutes). A naive implementation that fetched device state in a route loader
would burn the monthly quota in a few hundred page views.

Instead, a single long-lived process holds a WebSocket to Gardena and keeps an
in-memory mirror of the location. **Route loaders never call the Gardena API** —
they read the in-memory cache and SQLite. Browsing the app costs nothing.

Measured budget: ~360 requests/month for WebSocket reconnects, ~30 for token
refreshes, plus one request per valve per run. Settings → *Gardena connection*
shows the live request count for the running process.

## Features

| | |
|---|---|
| **Schedules** | An ordered list of sprinklers with a duration each. Reorder or change a duration and every clock time updates live. |
| **Sprinklers, not controllers** | The Gardena `DEVICE` / `VALVE_SET` layer is never surfaced. Sprinklers are a flat list you can rename, reorder and hide. |
| **Multiple schedules** | As many as you like — a morning and an evening one, say — each independently switchable. |
| **Master switch** | One toggle in the header stops every schedule. Turning it off mid-run closes the open valve immediately. |
| **Moisture gating** | With the soil sensor enabled, a sprinkler is skipped when the reading is at or above its target. Re-checked before every sprinkler, so a long run reacts to the soil as it goes. |
| **Per-sprinkler targets** | Any sprinkler can override the global moisture target — global 20%, but 30% for the hedge. |
| **Run history** | Every run records what watered, what was skipped and why. |

### Recurrence

A schedule repeats either on chosen weekdays, or every *N* days from an anchor
date. The second mode exists because a 2-day cycle cannot be expressed as a
weekday set.

## Setup

```bash
pnpm install
cp .env.example .env   # then fill it in
pnpm dev
```

| Variable | |
|---|---|
| `GARDENA_APPLICATION_KEY` / `GARDENA_APPLICATION_SECRET` | From the [Husqvarna developer portal](https://developer.husqvarnagroup.cloud/). The app needs the Gardena Smart System API connected to it. |
| `APP_PASSWORD` | Shared password for signing in. |
| `SESSION_SECRET` | At least 16 characters; signs the login cookie. Changing it signs everyone out. |
| `DATABASE_PATH` | SQLite file location. Defaults to `./data/gardena.db`. |

The app controls physical valves, so a single shared password guards every route.
Put it behind HTTPS.

## Development

```bash
pnpm test        # planner unit tests (timezone, DST, recurrence, moisture gate)
pnpm typecheck
pnpm db:generate # regenerate migrations after editing app/db/schema.ts
```

## Deployment

```bash
docker build -t garden .
docker run -p 3000:3000 --env-file .env -v garden-data:/data garden
```

Migrations run automatically on boot. **The `/data` volume must be persistent** —
without it, every redeploy wipes your schedules.

## How it fits together

```
app/
  db/          schema + migrations; the source of truth for everything you author
  gardena/     auth, REST client, WebSocket, in-memory device cache, valve sync
  scheduler/   plan.ts is pure and unit-tested; runner.ts executes runs
  routes/      dashboard, schedules, sprinklers, settings
```

`app/gardena/runtime.ts` boots the socket, valve sync and the scheduler tick on
the first request and is a no-op afterwards. It is invoked from route middleware
on the app layout (`v8_middleware`), not from a loader: sibling loaders run in
parallel, so only middleware can guarantee the runtime is up — and the database
migrated — before any child route reads. Boot deliberately waits for the socket
to actually open (capped at 10s) and runs one valve sync inline, so the first
request after a restart renders live state rather than an empty page.

The scheduler ticks every 30 seconds using only local state. A schedule fires if
it is enabled, the master switch is on, the day matches, and its start time has
passed within a 30-minute grace window — so a restart at 06:02 still runs the
06:00 schedule, but a restart at 09:00 does not water at breakfast. Runs
interrupted by a restart are marked aborted rather than resumed.

Steps run sequentially, one valve at a time. A sprinkler skipped by the moisture
gate simply hands over to the next one immediately, so the rest of the run shifts
earlier.
