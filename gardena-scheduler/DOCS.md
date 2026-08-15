# Gardena Scheduler

Watering schedules for a GARDENA smart irrigation system, written the way you
actually think about them: **start at 06:30, then run these sprinklers for these
durations**. Every clock time is derived from that.

## Why this exists

The Gardena API has no schedule endpoints. It reports device state and accepts
commands, and nothing else. So this add-on stores schedules itself and opens each
valve at the right moment.

Two consequences you should know before starting it:

- **Delete your schedules in the Gardena app.** This add-on should be the only
  thing opening valves. Leaving Gardena-side schedules in place means two
  schedulers watering the same garden, and the moisture check cannot stop the
  other one.
- **Home Assistant must stay running.** A stopped add-on is a schedule that
  silently does not water.

A valve's duration is enforced by the device itself, so a valve closes on its own
even if this add-on crashes mid-run. It never depends on being alive to send a
stop.

## Installation

1. Get API credentials from the
   [Husqvarna developer portal](https://developer.husqvarnagroup.cloud/):
   create an application, then **connect the "GARDENA smart system API"** to it.
   Copy the application key and secret.
2. Fill both into the **Configuration** tab.
3. Start the add-on and open the web UI.
4. On **Settings**, set your timezone. Schedule times are local to it.

| Option | |
|---|---|
| `gardena_application_key` | Application key from the developer portal. |
| `gardena_application_secret` | Application secret. Stored by Supervisor, never shown again. |

## No authentication

The add-on serves its UI on port 3000 with **no login**. Anyone who can reach
that port on your network can water your garden. That is a deliberate tradeoff
for a LAN tool — but do not forward the port or otherwise expose it to the
internet without an authenticating proxy in front of it.

It is not behind Home Assistant Ingress: Ingress serves an add-on under a path
containing a per-session token, which a server-rendered router cannot use as a
static base path.

To reach it from the sidebar, add a `panel_iframe` entry pointing at
`http://<home-assistant>:3000`.

## Using it

### Schedules

A schedule is a start time and an ordered list of sprinklers with a duration
each. Drag to reorder; the clock times update as you drag. Schedules repeat
either on chosen weekdays or **every N days** from an anchor date — a two-day
cycle cannot be expressed as a weekday set, which is why both modes exist.

Only **one schedule runs at a time**. If a second becomes due while the first is
still watering it is skipped for the day rather than queued, so the Schedules
page plots everything running today on a shared clock and warns when two overlap.

### Running sprinklers together

Any sprinkler can be set to start **with the previous** one rather than after it.
The group then lasts as long as its longest member.

A Gardena controller can hold **at most two of its own valves open at once**.
Valves on different controllers are independent, so two per controller is fine —
with two controllers you can run four at once. The editor refuses a third on the
same controller and names the sprinklers that clash.

### Unused valves

Gardena reports every valve port as healthy whether or not anything is wired to
it, so the API cannot tell you which ports are in use. Switch off the ones you do
not use on the **Sprinklers** page; they then disappear from schedules and the
dashboard. Ports still carrying Gardena's default `Valve N` name start switched
off — that guess only sets the toggle's initial position and you can override it.

### Moisture

With a GARDENA smart Sensor you can skip watering when the soil is already wet
enough. Set a global target, and override it for individual sprinklers — global
20%, but 30% for the hedge. The check runs again before **each** sprinkler, so a
long schedule reacts to the soil as it goes.

The dashboard shows the reading's age and the sensor's battery, and warns below
30%. A flat sensor stops reporting, and the gate would then decide on a stale
number.

The **Refresh** button re-reads what Gardena currently holds. It cannot make the
sensor take a new measurement — the API has no command for that.

### Several locations

Accounts covering more than one property get all their valves, with each
sprinkler labelled by location so two "Terrace" valves stay tellable apart.
Accounts with a single location never see the labels.

## API rate limit

Gardena allows roughly **3000 requests per month**. This add-on holds a WebSocket
per location and serves every page from memory, so browsing costs nothing.

Budget: about 360 requests/month per location for socket reconnects, ~30 for
token refreshes, one per valve per run, and one per press of **Refresh**.
Settings → *Gardena connection* shows the live count for the running process.

## Data and backups

Schedules live in the add-on's `/data`, which Home Assistant includes in its
backups. Restoring a backup restores your schedules.

The **Settings** page shows the running build version — useful for confirming an
update actually took effect.
