# Gardena Scheduler

Watering schedules for a GARDENA smart irrigation system, written the way you
actually think about them: **start at 06:30, then run these sprinklers for these
durations**. Every clock time is derived from that.

![The dashboard: the soil reading, the next run, and a history of what watered and what was skipped](https://raw.githubusercontent.com/frontendphil/gardena-schedule/main/docs/screenshots/dashboard.png)

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
3. Start the add-on. It appears in the sidebar as **Watering**.
4. On **Settings**, set your timezone. Schedule times are local to it.

| Option | |
|---|---|
| `gardena_application_key` | Application key from the developer portal. |
| `gardena_application_secret` | Application secret. Stored by Supervisor, never shown again. |

## Access and authentication

The add-on runs behind **Home Assistant Ingress**, so it appears in the sidebar
as *Watering* and Home Assistant does the authenticating. There is no separate
login and no port is opened on your network.

No port is published by default. If you want to reach the UI directly — from a
tablet on the wall, say — set a host port under the add-on's **Network**
settings. Be deliberate about it: **anything reaching that port bypasses Home
Assistant's login entirely**, and can water your garden.

## Using it

### Schedules

A schedule is a start time and an ordered list of sprinklers with a duration
each. Reorder by dragging, or with the arrows on each row — browsers only fire
drag-and-drop for a mouse, so on a phone the arrows are the way. Clock times
update as you go. Schedules repeat either on chosen weekdays or **every N days**
from an anchor date — a two-day cycle cannot be expressed as a weekday set, which
is why both modes exist.

![The schedule editor: an ordered list of sprinklers with a duration each, and the clock times derived from them](https://raw.githubusercontent.com/frontendphil/gardena-schedule/main/docs/screenshots/editor.png)

Only **one schedule runs at a time**. If a second becomes due while the first is
still watering it is skipped for the day rather than queued, so the Schedules
page plots everything running today on a shared clock and warns when two overlap.

![Today: two schedules laid out on one clock, one of them a pair of sprinklers opening together](https://raw.githubusercontent.com/frontendphil/gardena-schedule/main/docs/screenshots/schedules.png)

### Watering now

Every row on the Schedules page has a **Run now** button that waters that
schedule immediately, whether or not it is due today — for a dry spell, or to
check the plumbing after moving a sprinkler.

It waters exactly what the schedule says: same sprinklers, same order, same
durations. It takes no advice, though — neither the schedule's own switch nor the
moisture check holds it back, because pressing the button is a clearer
instruction than either. The history still records what the soil read at the
time.

Starting a schedule by hand does **not** use up its scheduled start: the schedule
still fires at its usual time. The one exception is a manual run that is still
watering when that time comes round, which would otherwise water the same
sprinklers twice in a row. Runs started this way are marked *started by hand* in
the history.

Only one run waters at a time, so pressing the button while anything else is
watering is refused rather than queued, and it says what is in the way.

### Stopping everything

The **All schedules** switch in the header turns off every schedule at once, and
closes a valve that is open right now rather than leaving it to run out its
duration. It is also how a run started by hand is stopped early.

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
enough. There are three places to set a target, and the most specific one wins:

1. **A single sprinkler**, on the Sprinklers page.
2. **A whole schedule**, in the schedule editor — useful when a schedule covers
   one area, like a shaded bed that should stay wetter than the lawn.
3. **The global target**, on the Settings page, used when neither is set.

So a global 20% with a 35% goal on your "Shade" schedule waters everything in
that schedule until the soil reaches 35% — except a sprinkler you have given its
own number, which keeps it. The schedule editor names those sprinklers, so a
goal that does not apply everywhere says so.

The check runs again before **each** sprinkler, so a long schedule reacts to the
soil as it goes. It only ever holds back the scheduler: a run you start with
**Run now** waters however wet the soil reads.

The dashboard shows the reading's age and the sensor's battery, and warns below
30%. A flat sensor stops reporting, and the gate would then decide on a stale
number.

### Trusting a reading, and forcing a new one

A reading is only trusted for as long as you allow on the Settings page
(3 hours by default). Past that it counts as *unknown*, and the sprinkler
**waters**. That asymmetry is deliberate: watering an already-wet garden wastes
one cycle, whereas trusting a sensor that has quietly stopped reporting skips
watering indefinitely while every run still looks healthy in the history.

The **Refresh** button re-reads what Gardena currently holds. It cannot make the
sensor measure — the public API has no command for that.

**Optionally**, you can supply your Husqvarna account email and password on the
Configuration tab. With those set the add-on can ask the sensor to measure, so a
stale reading is brought up to date before the gate decides, and a **Measure** button appears on the dashboard.

Worth understanding before you enable it:

- It uses Gardena's own app API rather than the public developer API, because
  only the former has the command. That API is undocumented and may change
  without notice; if it fails, the run falls back to the rule above and waters.
- An account password is a much stronger credential than an application key.
  Leave the fields empty and none of this is used — everything else works
  exactly the same.

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
