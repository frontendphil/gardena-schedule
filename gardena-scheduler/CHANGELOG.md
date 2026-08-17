# Changelog

Home Assistant shows this file on the add-on's page and when an update is
available. Entries are added automatically from GitHub release notes — see
"Publishing a new version" in the repository README.

## 1.8.0

- The interface is now available in **German** as well as English. It follows
  your browser by default, and Settings has a language picker if you want to
  fix it. Dates and times follow the language too.
- The add-on's own configuration options are translated in Home Assistant.

## 1.7.2

- Added `SCHEDULER_DISABLED`, a hard stop for any instance that must never open a
  valve. A development copy points at the same Gardena account as the add-on, so
  a schedule left enabled locally waters a real garden while the add-on's own
  history shows nothing. When set, the scheduler does not start and the UI says
  so.

## 1.7.1

- Fixed **Measure**, **Refresh** and the **All schedules** switch returning a 404
  when pressed from the dashboard. Each redirected back to the app root, and
  under Ingress that redirect ended up carrying the path prefix twice. They now
  stay on the page instead of redirecting at all.
- "Measure" explains that the sensor declines to measure again straight after a
  previous reading, rather than reporting it as a failure.

## 1.7.0

- The moisture gate no longer trusts a reading forever. Past a configurable age
  (3 hours by default) a reading counts as unknown and the sprinkler waters, so
  a sensor that has stopped reporting cannot silently suppress watering while
  the run history still looks healthy.
- **Optional**: supply a Husqvarna account email and password and the add-on can
  ask the sensor to measure before a moisture-gated run, plus a **Measure**
  button on the dashboard. This uses Gardena's own app API — the public API has
  no such command — so it is undocumented and may change; if it fails, the run
  falls back to the rule above and waters. Leave the fields empty and nothing
  changes.
- Run history now records how old the reading was when the gate decided.

## 1.6.4 - 2026-08-16

Make sure no hidden valves are part of any execution.

**Full Changelog**: https://github.com/frontendphil/gardena-schedule/compare/v1.6.3...v1.6.4

## 1.6.3

- Duplicating a schedule now opens the copy with its own values in the form.
  Previously the fields kept showing the original's name and settings, so it was
  impossible to tell which schedule you were editing. The same staleness
  affected any navigation from one schedule to another.
- Added an add-on icon and logo.

## 1.6.2

- Fixed navigation doing nothing under Ingress. Route modules were requested
  without the Ingress path prefix, so every tab click failed to load and bounced
  back to the page it started on.
- Fixed a hydration mismatch caused by rendering relative timestamps and
  locale-formatted dates, which differ between the server and the browser.
- Reloading the dashboard tab no longer 404s.

## 1.6.0

- The add-on now runs behind **Home Assistant Ingress**. It appears in the
  sidebar as *Watering*, Home Assistant authenticates every request, and no port
  is exposed by default. Direct access is opt-in from the Network settings and
  bypasses that authentication.

## 1.5.0

- Support for accounts with more than one Gardena location. Every location is
  connected, and sprinklers are labelled by location when there is more than one.
- The moisture sensor is now shown by name instead of an id fragment.
- Renamed to **Gardena Scheduler**.
- Published as a proper add-on repository with prebuilt images, so installing no
  longer builds on the device.

## 1.4.0

- Dashboard shows soil temperature and the sensor's battery, and warns below 30%
  — a flat sensor stops reporting, and moisture gating would then run on a stale
  reading.
- Added a refresh button for the sensor reading, and the reading's age.

## 1.3.0

- Sprinklers can be set to start **with the previous** one instead of after it.
  A controller can hold at most two of its valves open at once, which the editor
  enforces and explains.

## 1.2.0

- The schedules page plots everything running today on a shared clock, and warns
  when two schedules overlap — only one runs at a time, so the second would be
  skipped rather than queued.
- Drag to reorder sprinklers within a schedule.
- Sprinklers are listed alphabetically; unused valve ports can be switched off.

---

Versions before 1.6.0 were installed as a local add-on and were never published
to this repository.
