# Gardena Scheduler

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ffrontendphil%2Fgardena-schedule)

A scheduling app for a GARDENA smart irrigation system, built on the official
Gardena Smart System API and backed by a local SQLite database.

Schedules are authored the way you actually think about watering — *"start at
06:30, then run these sprinklers for these durations"* — and the app derives every
clock time from that.

> [!WARNING]
> **This app has no login of its own.** Anyone who can reach it can open your
> valves.
>
> Installed as a Home Assistant add-on it runs behind **Ingress**, so Home
> Assistant authenticates every request and no port is published — that is the
> supported way to run it, and the default.
>
> Publishing a host port under the add-on's *Network* settings, or running the
> container directly, bypasses that entirely. Only do it on a network you trust,
> and never forward the port or put it on the internet without an
> authenticating proxy in front.

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

Run this way the app is unauthenticated — see the warning at the top. It is fine
for local development; it is not something to leave listening on a shared
network.

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

1. Click the badge at the top of this README — it opens the *add repository*
   dialog on your own Home Assistant with the URL filled in. Or add
   `https://github.com/frontendphil/gardena-schedule` by hand under
   **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
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

The manifest version is the source of truth — the release workflow reads it from
`config.yaml` rather than the git tag, so the image tag and the add-on version
cannot drift apart. That also means **bumping the manifest is what makes Home
Assistant offer an update**; tagging alone does nothing.

1. Bump `version:` in `gardena-scheduler/config.yaml` and commit.
2. Tag it to match (`git tag v1.6.2`) and push the tag.
3. `release.yml` builds `aarch64` + `amd64` natively and pushes both to GHCR.
   (Native runners per architecture: emulating arm64 crashes V8 under QEMU.)
4. Publish the GitHub release and write the notes there.
5. `changelog.yml` copies those notes into
   `gardena-scheduler/CHANGELOG.md` and commits it — Home Assistant reads the
   changelog from that file and never sees GitHub Releases.

Editing a published release rewrites its section rather than adding a second
one, and a release with empty notes is skipped. Entries are inserted newest-
release-first, so a backport published after a newer version appears above it.

### As a plain Docker container

```bash
docker build -t gardena-scheduler .
docker run -p 3000:3000 --env-file .env -v gardena-data:/data gardena-scheduler
```

Migrations run automatically on boot. **The `/data` volume must be persistent** —
without it, every redeploy wipes your schedules.

### Not HACS

HACS does not distribute add-ons, and this is not a gap that repository layout
can work around: HACS installs code that runs *inside* Home Assistant
(integrations, dashboard plugins, themes), whereas an add-on is a separate
container that Supervisor manages — and Supervisor already has its own store.
A custom add-on repository, as above, *is* the equivalent distribution channel,
and it gives real version tracking and Update buttons.

### Not Vercel

Serverless functions are frozen between requests and have no durable local disk,
so the scheduler would never fire and the database would vanish. If you do want a
cloud host, use an always-on container platform (Fly.io with
`min_machines_running = 1`, Railway) and attach a volume at `/data`.

## How it fits together

```
server.mjs                 production server; also does the Ingress path handling
app/
  db/          schema + migrations; the source of truth for everything you author
  gardena/     auth, REST client, WebSocket, in-memory device cache, valve sync
  scheduler/   plan.ts is pure and unit-tested; runner.ts executes runs
  routes/      dashboard, schedules, sprinklers, settings
gardena-scheduler/         Home Assistant add-on (manifest + docs)
```

### Home Assistant Ingress

Ingress publishes the add-on at `/api/hassio_ingress/<token>/…` with a token that
changes per session, and Supervisor strips that prefix before forwarding — so the
app sees clean paths and learns the public prefix only from the `X-Ingress-Path`
header. React Router's `basename` is build-time config, which a per-session token
cannot satisfy.

`server.mjs` resolves this per request:

- builds one request handler per prefix, overriding the `ServerBuild`'s
  `basename` and `publicPath`, and rewriting the asset manifest (asset URLs are
  baked in at build time, so `publicPath` alone does not move them);
- puts the prefix *back* onto `req.originalUrl` — React Router strips `basename`
  before matching, and the Express adapter builds its Request from `originalUrl`,
  not `url`;
- prefixes `Location` headers, since a redirect returned from an action is a
  plain Response that React Router does not rewrite.

Nothing on the client changes: the server serialises `basename` into
`window.__reactRouterContext`, and `HydratedRouter` reads it from there.

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
