/**
 * German translations, keyed by the English source string.
 *
 * Gardena's own German app is the reference for domain wording, so a user does
 * not have to hold two vocabularies at once: *Bewässerung* for watering,
 * *Ventil* for a valve, *Bodenfeuchte* for soil moisture. "Sprinkler" is left as
 * is — it is the word Gardena uses in German too.
 */
export const de: Record<string, string> = {
  // Navigation and layout
  "Gardena Scheduler": "Gardena Zeitplan",
  Dashboard: "Übersicht",
  Schedules: "Zeitpläne",
  Sprinklers: "Sprinkler",
  Settings: "Einstellungen",
  Connected: "Verbunden",
  Offline: "Offline",
  "All schedules": "Alle Zeitpläne",
  "Watering · {name}": "Bewässert · {name}",
  "All schedules are switched off. Nothing will be watered until you turn them back on.":
    "Alle Zeitpläne sind ausgeschaltet. Es wird nicht bewässert, bis du sie wieder einschaltest.",
  "Scheduler disabled on this instance.":
    "Zeitsteuerung auf dieser Instanz deaktiviert.",
  "It will not run schedules or open any valve — {flag} is set. Only the instance actually in charge of the garden should run without it.":
    "Sie führt keine Zeitpläne aus und öffnet kein Ventil — {flag} ist gesetzt. Nur die Instanz, die den Garten tatsächlich steuert, sollte ohne diese Einstellung laufen.",
  Working: "Arbeitet",

  // Dashboard
  Soil: "Boden",
  "Sensor reading": "Sensorwert",
  "Measured {age} · {date}": "Gemessen {age} · {date}",
  Measure: "Messen",
  Refresh: "Aktualisieren",
  "Ask the sensor to take a reading now, via Gardena's app API.":
    "Den Sensor jetzt zu einer Messung auffordern, über Gardenas App-API.",
  "Re-read what Gardena already holds. Does not ask the sensor to measure.":
    "Liest erneut, was Gardena bereits hat. Fordert keine Messung an.",
  "The sensor": "Der Sensor",
  Moisture: "Feuchte",
  "Soil temp": "Bodentemp.",
  Battery: "Batterie",
  "Next run": "Nächster Lauf",
  "Nothing scheduled": "Nichts geplant",
  "Create a schedule": "Zeitplan anlegen",
  "Recent runs": "Letzte Läufe",
  "What actually happened, and why.": "Was tatsächlich passiert ist, und warum.",
  "No runs yet": "Noch keine Läufe",
  "Runs will appear here once a schedule fires.":
    "Läufe erscheinen hier, sobald ein Zeitplan startet.",
  "No sensor reading yet.": "Noch kein Sensorwert.",
  "Watering now: {names}": "Bewässert gerade: {names}",
  "{count} sprinklers · {minutes} min": "{count} Sprinkler · {minutes} min",
  "Moisture gating is off — schedules run regardless of the reading.":
    "Die Feuchtesperre ist aus — Zeitpläne laufen unabhängig vom Messwert.",
  "Below the {target}% target, so schedules will water.":
    "Unter dem Zielwert von {target} %, es wird also bewässert.",
  "Below every schedule's target, so schedules will water.":
    "Unter dem Zielwert jedes Zeitplans, es wird also bewässert.",
  "Currently holding back: {names}.": "Aktuell zurückgehalten: {names}.",
  "Gardena decides when the sensor measures; refreshing re-reads what it has already reported.":
    "Gardena entscheidet, wann der Sensor misst; Aktualisieren liest nur erneut, was bereits gemeldet wurde.",
  " Signal {level}%.": " Signal {level} %.",
  "{name} is down to {level}%": "{name} ist auf {level} % gefallen",
  " (as of {age})": " (Stand {age})",
  ". A flat sensor stops reporting, and moisture gating then waters on a stale reading.":
    ". Ein leerer Sensor meldet nichts mehr, und die Feuchtesperre entscheidet dann anhand eines veralteten Werts.",

  // Measurement outcomes
  "The sensor took a new reading.": "Der Sensor hat neu gemessen.",
  "Gardena accepted the request, but no new reading arrived within 30 seconds. The sensor declines to measure again straight after a previous reading — wait a minute and try again.":
    "Gardena hat die Anfrage angenommen, aber innerhalb von 30 Sekunden kam kein neuer Wert. Der Sensor misst nicht direkt nach einer vorherigen Messung erneut — warte eine Minute und versuche es nochmal.",
  "Could not reach Gardena's app API — check the account email and password on Settings.":
    "Gardenas App-API war nicht erreichbar — prüfe E-Mail und Passwort des Kontos in den Einstellungen.",
  "No Husqvarna account is configured, so the sensor cannot be asked to measure.":
    "Es ist kein Husqvarna-Konto hinterlegt, der Sensor kann also nicht zum Messen aufgefordert werden.",
  "No soil sensor is reporting.": "Kein Bodensensor meldet Werte.",
  "The reading was already current.": "Der Wert war bereits aktuell.",

  // Relative time
  "just now": "gerade eben",
  "{minutes} min ago": "vor {minutes} min",
  "{hours} h ago": "vor {hours} Std.",
  "{days} d ago": "vor {days} Tg.",

  // Run status
  Pending: "Ausstehend",
  Watering: "Bewässert",
  Watered: "Bewässert",
  "Skipped — soil wet": "Übersprungen — Boden feucht",
  "Skipped — all off": "Übersprungen — alles aus",
  "Skipped — schedule off": "Übersprungen — Zeitplan aus",
  "Skipped — unreachable": "Übersprungen — nicht erreichbar",
  Failed: "Fehlgeschlagen",

  // Recurrence and weekdays
  Mon: "Mo",
  Tue: "Di",
  Wed: "Mi",
  Thu: "Do",
  Fri: "Fr",
  Sat: "Sa",
  Sun: "So",
  "Every day": "Täglich",
  Never: "Nie",
  "Every second day": "Jeden zweiten Tag",
  "Every third day": "Jeden dritten Tag",
  "Every {count} days": "Alle {count} Tage",

  // Schedules list and today view
  Today: "Heute",
  "Every schedule running today, on a shared clock.":
    "Alle Zeitpläne von heute auf einer gemeinsamen Zeitachse.",
  "Nothing runs today": "Heute läuft nichts",
  "No enabled schedule covers today, or none has sprinklers yet.":
    "Kein aktiver Zeitplan gilt für heute, oder keiner hat bisher Sprinkler.",
  "Each schedule waters its sprinklers one after another, starting at its start time.":
    "Jeder Zeitplan bewässert seine Sprinkler nacheinander, beginnend zur Startzeit.",
  "No schedules yet": "Noch keine Zeitpläne",
  "Create one below to get started.": "Lege unten einen an, um zu starten.",
  "New schedule": "Neuer Zeitplan",
  Create: "Anlegen",
  "Evening watering": "Abendbewässerung",
  "Give the schedule a name.": "Gib dem Zeitplan einen Namen.",
  Off: "Aus",
  "No sprinklers yet": "Noch keine Sprinkler",
  "{count} sprinklers · {minutes} min total":
    "{count} Sprinkler · {minutes} min gesamt",
  "{names} overlap. Only one schedule runs at a time, so whichever comes second will be skipped today rather than waiting its turn. Move its start time past the end of the first.":
    "{names} überschneiden sich. Es läuft immer nur ein Zeitplan, der zweite wird heute also übersprungen statt zu warten. Verschiebe seine Startzeit hinter das Ende des ersten.",
  "{minutes} min": "{minutes} min",

  // Schedule editor
  Schedule: "Zeitplan",
  Duplicate: "Duplizieren",
  Delete: "Löschen",
  Name: "Name",
  "Start time": "Startzeit",
  "Local time in your configured timezone.":
    "Ortszeit in der eingestellten Zeitzone.",
  Repeat: "Wiederholung",
  "On certain weekdays": "An bestimmten Wochentagen",
  "Every N days": "Alle N Tage",
  "Run every": "Läuft alle",
  "2 = every second day.": "2 = jeden zweiten Tag.",
  days: "Tage",
  "Starting from": "Beginnend am",
  "Sets which days the cycle lands on.":
    "Legt fest, auf welche Tage der Rhythmus fällt.",
  " · waters below {target}%": " · bewässert unter {target} %",
  "Moisture goal for this schedule": "Feuchte-Ziel für diesen Zeitplan",
  "Everything in this schedule waters only below this. Leave empty to follow the global target.":
    "Alles in diesem Zeitplan bewässert nur unterhalb dieses Werts. Leer lassen, um dem globalen Zielwert zu folgen.",
  "Moisture gating is off in Settings, so this has no effect yet.":
    "Die Feuchtesperre ist in den Einstellungen aus, dieser Wert hat also noch keine Wirkung.",
  "{names} keep their own target and ignore this goal. Clear it on the Sprinklers page to bring them in line.":
    "{names} behalten ihren eigenen Zielwert und ignorieren dieses Ziel. Auf der Sprinkler-Seite löschen, um sie anzugleichen.",
  "Schedule enabled": "Zeitplan aktiv",
  Save: "Speichern",
  Saved: "Gespeichert",
  "Add sprinklers in the order they should run.":
    "Füge Sprinkler in der Reihenfolge hinzu, in der sie laufen sollen.",
  "No sprinklers in this schedule": "Keine Sprinkler in diesem Zeitplan",
  "{start}–{end} · {minutes} min total":
    "{start}–{end} · {minutes} min gesamt",
  "starts the run": "startet den Lauf",
  "With previous": "Mit vorherigem",
  "{count} at once": "{count} gleichzeitig",
  min: "min",
  "Add sprinkler": "Sprinkler hinzufügen",
  Add: "Hinzufügen",
  "Add all": "Alle hinzufügen",
  "Switched off, so never watered": "Ausgeschaltet, wird nie bewässert",
  "These sprinklers are off on the Sprinklers page. They are skipped entirely — no command is sent to the valve — and the times above already exclude them.":
    "Diese Sprinkler sind auf der Sprinkler-Seite ausgeschaltet. Sie werden komplett übersprungen — es wird kein Befehl an das Ventil gesendet — und die Zeiten oben schließen sie bereits aus.",
  Remove: "Entfernen",
  "Delete “{name}”?": "„{name}“ löschen?",
  "{first} and {last} are on the same controller, which can only open {max} valves at once.":
    "{first} und {last} hängen am selben Steuergerät, das nur {max} Ventile gleichzeitig öffnen kann.",
  "Pick a sprinkler to add.": "Wähle einen Sprinkler zum Hinzufügen.",

  // Sprinklers
  "Rename and set a moisture target that differs from the global one. Listed alphabetically; order only matters inside a schedule.":
    "Umbenennen und einen vom globalen abweichenden Feuchte-Zielwert setzen. Alphabetisch sortiert; die Reihenfolge zählt nur innerhalb eines Zeitplans.",
  "No sprinklers in use": "Keine Sprinkler in Benutzung",
  "Every valve is switched off below.": "Alle Ventile unten sind ausgeschaltet.",
  "They appear automatically once the Gardena connection is up.":
    "Sie erscheinen automatisch, sobald die Verbindung zu Gardena steht.",
  "In use": "In Benutzung",
  "Not reported": "Nicht gemeldet",
  Unreachable: "Nicht erreichbar",
  "Name in Gardena: {name}": "Name in Gardena: {name}",
  "Moisture target": "Feuchte-Zielwert",
  "{target} (global)": "{target} (global)",
  "Unused valves": "Ungenutzte Ventile",
  "Gardena reports every valve port as healthy whether or not anything is wired to it, so switch off the ones you do not use. They stay out of schedules and the dashboard.":
    "Gardena meldet jeden Ventilanschluss als in Ordnung, egal ob etwas angeschlossen ist. Schalte deshalb die aus, die du nicht nutzt. Sie bleiben aus Zeitplänen und der Übersicht heraus.",
  "Every valve is in use.": "Alle Ventile sind in Benutzung.",

  // Settings
  "Watering rules": "Bewässerungsregeln",
  "Applies to every schedule. Individual sprinklers can override the moisture target.":
    "Gilt für alle Zeitpläne. Einzelne Sprinkler können den Feuchte-Zielwert überschreiben.",
  "Let the soil sensor decide": "Den Bodensensor entscheiden lassen",
  "A sprinkler is skipped when the sensor reads at or above its target. Checked again for each sprinkler as the schedule runs, so a long run reacts to the soil as it goes.":
    "Ein Sprinkler wird übersprungen, wenn der Sensor seinen Zielwert erreicht oder überschreitet. Wird während des Laufs für jeden Sprinkler erneut geprüft, sodass ein langer Lauf auf den Boden reagiert.",
  "Global moisture target": "Globaler Feuchte-Zielwert",
  "Water only while the reading is below this. Schedules and single sprinklers can set their own.":
    "Nur bewässern, solange der Messwert darunter liegt. Zeitpläne und einzelne Sprinkler können eigene Werte festlegen.",
  "Schedules with their own goal": "Zeitpläne mit eigenem Ziel",
  "These win over both the global target and any schedule goal.":
    "Diese haben Vorrang vor dem globalen Zielwert und vor jedem Zeitplan-Ziel.",
  Sensor: "Sensor",
  "Used for the moisture check.": "Wird für die Feuchteprüfung verwendet.",
  "First available": "Erster verfügbarer",
  "no reading": "kein Wert",
  "Trust a reading for": "Messwert gültig für",
  "Past this, the sensor is asked to measure again before the gate decides.":
    "Danach wird der Sensor zu einer neuen Messung aufgefordert, bevor entschieden wird.",
  "Past this, the reading is treated as unknown and the sprinkler waters.":
    "Danach gilt der Wert als unbekannt und der Sprinkler bewässert.",
  minutes: "Minuten",
  " · current reading is {age} min old":
    " · aktueller Wert ist {age} min alt",
  "Can force a measurement": "Messung kann ausgelöst werden",
  "Cannot force a measurement": "Messung kann nicht ausgelöst werden",
  "A Husqvarna account is configured, so a stale reading is refreshed before the gate decides. This uses Gardena's own app API, which is undocumented and may change; if it fails, the run falls back to watering.":
    "Ein Husqvarna-Konto ist hinterlegt, ein veralteter Wert wird also vor der Entscheidung aktualisiert. Das nutzt Gardenas eigene App-API, die undokumentiert ist und sich ändern kann; schlägt sie fehl, wird bewässert.",
  "Gardena's public API cannot ask the sensor to measure — only its own app can. Without a Husqvarna account configured, a reading older than the limit above counts as unknown and the sprinkler waters, so a sensor that stops reporting can never silently suppress watering.":
    "Gardenas öffentliche API kann den Sensor nicht zum Messen auffordern — nur die eigene App kann das. Ohne hinterlegtes Husqvarna-Konto gilt ein Wert, der älter als das Limit oben ist, als unbekannt und der Sprinkler bewässert. So kann ein Sensor, der nichts mehr meldet, die Bewässerung nie stillschweigend unterdrücken.",
  "Sprinklers with their own target": "Sprinkler mit eigenem Zielwert",
  Timezone: "Zeitzone",
  "Schedule start times are local to this zone.":
    "Startzeiten von Zeitplänen gelten in dieser Zone.",
  Language: "Sprache",
  "Used for this app's own interface.":
    "Wird für die Oberfläche dieser App verwendet.",
  "Match my browser": "Browsersprache verwenden",
  '"{zone}" is not a valid timezone.': "„{zone}“ ist keine gültige Zeitzone.",
  "Gardena connection": "Gardena-Verbindung",
  "State arrives over a WebSocket, so browsing this app costs no API requests.":
    "Der Zustand kommt über einen WebSocket, das Blättern in dieser App kostet also keine API-Anfragen.",
  Status: "Status",
  Disconnected: "Getrennt",
  "Last update": "Letzte Aktualisierung",
  "API requests this process": "API-Anfragen dieses Prozesses",
  "Last error": "Letzter Fehler",
  "Requests by endpoint": "Anfragen nach Endpunkt",
  Build: "Build",
  " · running since ": " · läuft seit ",
}
