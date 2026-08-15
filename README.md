# Gardena Scheduler

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

Measured budget: ~360 requests/month per location for socket reconnects, ~30 for
token refreshes, one request per valve per run, and one per press of the dashboard's
*Refresh* button. That button re-reads what Gardena already holds (useful if the
socket has gone quiet); it cannot make the sensor take a new measurement, because
the API has no command for that — `SENSOR_CONTROL` is rejected outright. Settings → *Gardena connection*
shows the live request count for the running process.

## Features

| | |
|---|---|
| **Schedules** | An ordered list of sprinklers with a duration each. Drag to reorder or change a duration, and every clock time updates live. |
| **Parallel sprinklers** | Any sprinkler can be set to start *with the previous* one instead of after it. The group lasts as long as its longest member. A Gardena controller can only hold **two** of its valves open at once, so the editor refuses a third and names the sprinklers that clash — valves on different controllers are counted separately, so 2 + 2 is fine. |
| **Today at a glance** | The schedules page plots every schedule running today on a shared clock, and warns when two overlap — only one run executes at a time, so the second would be skipped rather than queued. |
| **Sprinklers, not controllers** | The Gardena `DEVICE` / `VALVE_SET` layer is never surfaced. Sprinklers are a flat alphabetical list you can rename and switch off; order only matters inside a schedule. |
| **Unused valves** | Gardena reports every valve port as healthy whether or not anything is wired to it, so unused ports are switched off on the Sprinklers page and disappear from schedules and the dashboard. Ports still carrying the default `Valve N` name start switched off; that guess only sets the initial position of the toggle. |
| **Multiple schedules** | As many as you like — a morning and an evening one, say — each independently switchable. |
| **Master switch** | One toggle in the header stops every schedule. Turning it off mid-run closes the open valve immediately. |
| **Moisture gating** | With the soil sensor enabled, a sprinkler is skipped when the reading is at or above its target. Re-checked before every sprinkler, so a long run reacts to the soil as it goes. |
| **Per-sprinkler targets** | Any sprinkler can override the global moisture target — global 20%, but 30% for the hedge. |
| **Run history** | Every run records what watered, what was skipped and why. |
| **Several locations** | Every location on the account is connected, with one WebSocket each. Sprinklers are labelled by location when there is more than one, so two "Terrace" valves stay tellable apart. |
| **Sensor health** | The dashboard shows soil moisture, soil temperature, sensor battery and how old the reading is, and warns below 30% battery — a flat sensor stops reporting and moisture gating would then water on a stale reading. |

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
| `DATABASE_PATH` | SQLite file location. Defaults to `./data/gardena.db`. |

There is **no authentication** — the app assumes it is reachable only from your
home network. Anyone who can open the page can water the garden, so do not
forward the port or otherwise expose it to the internet without putting an
authenticating proxy in front of it.

## Development

```bash
pnpm test        # planner unit tests (timezone, DST, recurrence, moisture gate,
                 # parallel grouping and the per-controller valve limit)
pnpm typecheck
pnpm db:generate # regenerate migrations after editing app/db/schema.ts
```

## Deployment

The app needs a process that stays awake and a file that survives restarts, so a
small always-on machine suits it far better than a serverless host.

### As a Home Assistant add-on (recommended)

This repository *is* a Home Assistant add-on repository:

```
repository.yaml            # repository manifest
gardena-scheduler/         # the add-on
  config.yaml              # manifest; points at a prebuilt image
  DOCS.md                  # rendered as the add-on's Documentation tab
```

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, and add
   `https://github.com/frontendphil/gardena-schedule`.
2. Install **Gardena Scheduler** from the store.
3. Fill in your Gardena key and secret on the **Configuration** tab, start it,
   and open the web UI.

Installing pulls a prebuilt image from GHCR rather than building on the device,
so it is a download instead of a multi-minute build on a Raspberry-Pi-class box —
and it sidesteps the HAOS 17 containerd cache bug where a rebuild silently ships
stale code. Updates appear as a normal **Update** button once a new version is
published.

> **Migrating from the old local add-on.** Earlier versions were installed by
> copying this repo to `/addons/garden`. A repository add-on gets a different
> slug, and therefore a different `/data`, so **schedules do not carry over**.
> Either recreate them, or copy `gardena.db` out of the old add-on's data
> directory into the new one before starting it. Uninstall the local copy
> afterwards so two schedulers are not both watering.

### Publishing a new version

`garden`-side and code-side versions must agree, so the release workflow reads
the version out of the manifest rather than the git tag:

1. Bump `version:` in `gardena-scheduler/config.yaml`.
2. Commit, tag (`git tag v1.5.0`), and push the tag.
3. `.github/workflows/release.yml` builds `aarch64` + `amd64` images and pushes
   them to GHCR under that version.
4. Home Assistant offers the update.

### As a plain Docker container

```bash
docker build -t gardena-scheduler .
docker run -p 3000:3000 --env-file .env -v gardena-data:/data gardena-scheduler
```

Migrations run automatically on boot. **The `/data` volume must be persistent** —
without it, every redeploy wipes your schedules.

### Not Vercel

Serverless functions are frozen between requests and have no durable local disk,
so the scheduler would never fire and the database would vanish. If you do want a
cloud host, use an always-on container platform (Fly.io with
`min_machines_running = 1`, Railway) and attach a volume at `/data`.

## How it fits together

```
app/
  db/          schema + migrations; the source of truth for everything you author
  gardena/     auth, REST client, WebSocket, in-memory device cache, valve sync
  scheduler/   plan.ts is pure and unit-tested; runner.ts executes runs
  routes/      dashboard, schedules, sprinklers, settings
```

One WebSocket is opened per Gardena location, each with its own backoff, so a
flaky gateway at one property cannot stall the others. Services are tagged with
the location they arrived from, which is what lets sprinklers be labelled.

`app/gardena/runtime.ts` boots the sockets, valve sync and the scheduler tick on
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
