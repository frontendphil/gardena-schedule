# Gardena Scheduler

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ffrontendphil%2Fgardena-schedule)

A Home Assistant add-on for a GARDENA smart irrigation system. Schedules are
authored the way you actually think about watering — *"start at 06:30, then run
these sprinklers for these durations"* — and every clock time is derived from
that.

> [!WARNING]
> **The app has no login of its own.** As an add-on it runs behind Home Assistant
> **Ingress**, which authenticates every request and publishes no port — that is
> the default and the supported way to run it. Publishing a host port, or running
> the container directly, bypasses that entirely.

## Why it works the way it does

**The Gardena API has no schedule endpoints.** It reports device state and
accepts commands, nothing more. So the app stores schedules itself and opens each
valve at the right moment with `START_SECONDS_TO_OVERRIDE`. Two consequences:

- **Delete your schedules in the Gardena app**, or two schedulers fight over the
  same valves.
- **The host must stay awake.** A stopped add-on is a schedule that silently does
  not water.

The duration is enforced by the device, so a valve closes itself even if the app
dies mid-run.

**The API allows roughly 3000 requests a month.** Fetching device state in a
route loader would exhaust that in a few hundred page views, so a single
long-lived process holds a WebSocket per location and every page is served from
memory. Browsing costs nothing. Budget: ~430 requests/month per location for
socket reconnects, ~30 for token refreshes, one per valve per run, and one per
press of *Refresh* or *Measure*. Settings → *Gardena connection* counts what this
process has spent.

## Features

| | |
|---|---|
| **Schedules** | An ordered list of sprinklers with a duration each. Drag to reorder; clock times update live. Repeats on chosen weekdays, or every *N* days from an anchor date — a two-day cycle cannot be expressed as a weekday set. |
| **Parallel sprinklers** | A sprinkler can start *with the previous* one; the group lasts as long as its longest member. A controller holds at most **two** of its valves open at once, so the editor refuses a third and names the clash. Valves on different controllers count separately, so 2 + 2 is fine. |
| **Today at a glance** | Every schedule running today on a shared clock, with a warning when two overlap — only one run executes at a time, so the second is skipped rather than queued. |
| **Sprinklers, not controllers** | The `DEVICE` / `VALVE_SET` layer is never surfaced. A flat alphabetical list you can rename and switch off; order matters only inside a schedule. |
| **Unused valves** | Gardena reports every port as healthy whether or not anything is wired to it. Switch unused ones off and they never receive a command. Ports still carrying the default `Valve N` name start switched off. |
| **Moisture gating** | With a soil sensor, a sprinkler is skipped when the reading is at or above its target. Three levels, most specific wins: a sprinkler's own target, then the schedule's goal, then the global one — so a schedule can stand in for an area that wants wetter or drier soil. Re-checked before every sprinkler. A reading older than the configured age counts as *unknown* and waters, so a sensor that stops reporting cannot silently suppress watering. |
| **Forcing a measurement** | Optional. Gardena's public API cannot ask the sensor to measure; its own app API can. Supply a Husqvarna account and the app refreshes a stale reading before the gate decides, and a **Measure** button appears. Undocumented and may change; on failure the run falls back to watering. |
| **Master switch** | One toggle stops every schedule, closing an open valve immediately. |
| **Run history** | What watered, what was skipped, and why — including the reading's age. |
| **Several locations** | One WebSocket each, with sprinklers labelled by location when there is more than one. |
| **English and German** | Follows the browser, overridable in Settings. Home Assistant translates the add-on's own options separately, from `gardena-scheduler/translations/`. |

## Install

1. Click the badge above — it opens the *add repository* dialog on your Home
   Assistant. Or add `https://github.com/frontendphil/gardena-schedule` under
   **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Install **Gardena Scheduler**, fill in your Gardena key and secret on the
   **Configuration** tab, and start it. It appears in the sidebar as *Watering*.

Installing pulls a prebuilt image from GHCR rather than building on the device —
a download instead of a multi-minute build on a Raspberry-Pi-class box, and it
sidesteps the HAOS 17 containerd cache bug where a rebuild silently ships stale
code.

## Configuration

| Variable | |
|---|---|
| `GARDENA_APPLICATION_KEY` / `GARDENA_APPLICATION_SECRET` | From the [Husqvarna developer portal](https://developer.husqvarnagroup.cloud/), with the Gardena Smart System API connected. Required. |
| `GARDENA_EMAIL` / `GARDENA_PASSWORD` | Optional Husqvarna account login, used only to force a soil measurement. |
| `SCHEDULER_DISABLED` | Set in any instance that must never open a valve. |
| `DATABASE_PATH` | SQLite file. Defaults to `./data/gardena.db`; must be persistent. |

As an add-on, both credential pairs come from the Configuration tab instead.

## Development

> [!CAUTION]
> A development copy talks to the **same Gardena account** as the deployed
> add-on, so a schedule left enabled locally waters a real garden — at the wrong
> time, in the wrong order, and with nothing in the add-on's history to explain
> it. Put `SCHEDULER_DISABLED=1` in your local `.env`.

```bash
pnpm install
cp .env.example .env    # then fill it in
pnpm dev

pnpm test               # pure planner tests: timezones and DST, recurrence,
                        # parallel grouping, the moisture gate
pnpm typecheck
pnpm i18n:check         # German dictionary vs. the strings the UI uses
pnpm ingress:check      # builds, then exercises the Ingress path handling
pnpm db:generate        # after editing app/db/schema.ts
```

CI runs all of these. The two custom checks exist because both failures are
silent: translation drift orphans a string that then quietly renders in English,
and a broken Ingress prefix renders a perfectly normal page whose links do
nothing. Neither breaks a build, and both were previously found by hand after a
release.

React Router's v8 future flags are all enabled in `react-router.config.ts`, so
the upgrade itself is a version bump rather than a behaviour change.

## Releasing

The manifest version is the source of truth, and releasing is automatic:

1. Bump `version:` in `gardena-scheduler/config.yaml`.
2. Add the entry to `gardena-scheduler/CHANGELOG.md` by hand — Home Assistant
   reads that file and never sees GitHub Releases.
3. Merge to main. That is the whole process.

On every push to main, `release.yml` compares `config.yaml` against the tags on
the remote. If that version is already tagged it stops; otherwise it builds
`aarch64` and `amd64` on native runners — emulating arm64 crashes V8 under QEMU
— pushes both to GHCR, and only then creates `v{version}`.

**The order is deliberate.** Home Assistant reads `config.yaml` from the default
branch and appends `:{version}` to the image name, so it offers an update the
moment a bump lands, whether or not an image exists to pull. Tagging by hand
left 1.8.0 published with nothing behind it. Because the tag is created last, a
tag now means "these images exist" — and a failed build leaves the version
untagged, so the next push retries it.

This cannot be split into "tag on main" and "build on tag": events created with
the default `GITHUB_TOKEN` do not start workflow runs, so a tag pushed by a
workflow would never trigger a build.

To rebuild a version that is already tagged, run the workflow manually with
**Republish** ticked. There is no need to push tags by hand, and doing so is
actively harmful: a tag pushed ahead of its release makes the workflow consider
that version done and skip building it.

Running as a plain container works too (`docker run -p 3000:3000 --env-file .env
-v gardena-data:/data …`), but not on a serverless host: the scheduler needs a
process that stays awake and a disk that survives. HACS is not an option either —
it distributes code that runs *inside* Home Assistant, not add-ons.

## How it fits together

```
server.mjs      production server; also the Ingress path handling
app/
  db/           schema + migrations; the source of truth for what you author
  gardena/      auth, REST client, WebSockets, in-memory device cache, sync
  scheduler/    plan.ts is pure and unit-tested; runner.ts executes runs
  routes/       dashboard, schedules, sprinklers, settings
  i18n/         English-keyed dictionaries
  components/   shared UI
gardena-scheduler/   the add-on: manifest, docs, changelog, artwork, translations
```

`app/gardena/runtime.ts` boots the sockets, valve sync and scheduler tick on the
first request. It runs from route middleware rather than a loader, because
sibling loaders run in parallel and only middleware can guarantee the runtime is
up — and the database migrated — before any child route reads.

The scheduler ticks every 30 seconds on local state alone. A schedule fires if it
is enabled, the master switch is on, the day matches, and its start time passed
within a 30-minute grace window — so a restart at 06:02 still runs the 06:00
schedule, but one at 09:00 does not water at breakfast. Runs interrupted by a
restart are marked aborted, never resumed. Parallel groups open together and the
run waits for the longest member; a skipped sprinkler hands over immediately, so
the rest of the run shifts earlier.

**Ingress** publishes the add-on under `/api/hassio_ingress/<token>/` with a
per-session token, and Supervisor strips that prefix before forwarding — so the
app sees clean paths and learns the prefix only from `X-Ingress-Path`. React
Router's `basename` is build-time config, which a per-session token cannot
satisfy, so `server.mjs` builds one request handler per prefix and rewrites the
asset manifest to match. The reasoning, and the several ways it goes subtly
wrong, is documented in that file.
