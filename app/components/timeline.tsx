import { cx } from "./ui"

/**
 * Categorical palette for schedule identity, slots assigned in fixed order and
 * never cycled. Validated for colour-vision deficiency and contrast against both
 * surfaces (worst adjacent CVD ΔE 9.2 light / 9.4 dark; normal-vision 27.6 /
 * 22.5). Every row is also labelled with its schedule name, so identity never
 * rests on colour alone — which is what licenses the one sub-3:1 light step.
 */
const SERIES_STYLES = `
.tl {
  --tl-series-1: #2a78d6;
  --tl-series-2: #eb6834;
  --tl-series-3: #1baf7a;
  --tl-series-4: #4a3aa7;
  --tl-series-5: #e34948;
}
@media (prefers-color-scheme: dark) {
  .tl {
    --tl-series-1: #3987e5;
    --tl-series-2: #d95926;
    --tl-series-3: #199e70;
    --tl-series-4: #9085e9;
    --tl-series-5: #e66767;
  }
}
`

export const SERIES_COUNT = 5

export type TimelineStep = {
  name: string
  startMinutes: number
  endMinutes: number
  durationMinutes: number
  /** Parallel steps share a group index and therefore a start time. */
  group: number
  skipped: boolean
}

export type TimelineRow = {
  id: number
  name: string
  /** 0-based slot into the categorical palette. */
  series: number
  startMinutes: number
  endMinutes: number
  label: string
  steps: TimelineStep[]
  conflict: boolean
}

export type TimelineData = {
  rows: TimelineRow[]
  windowStart: number
  windowEnd: number
  nowMinutes: number | null
}

const formatMinutes = (minutes: number) => {
  const wrapped = ((minutes % 1440) + 1440) % 1440

  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(
    wrapped % 60
  ).padStart(2, "0")}`
}

/** Hour marks across the window, thinned out so labels never collide. */
const hourTicks = (start: number, end: number) => {
  const span = end - start
  const stepHours = span > 720 ? 3 : span > 360 ? 2 : 1
  const ticks: number[] = []

  for (
    let minute = Math.ceil(start / 60) * 60;
    minute <= end;
    minute += stepHours * 60
  ) {
    ticks.push(minute)
  }

  return ticks
}

export const Timeline = ({ data }: { data: TimelineData }) => {
  const { rows, windowStart, windowEnd, nowMinutes } = data
  const span = Math.max(1, windowEnd - windowStart)

  const percent = (minutes: number) =>
    ((minutes - windowStart) / span) * 100

  return (
    // One grid for the axis and every row, so the hour labels line up with the
    // gridlines instead of drifting by the width of the side columns.
    <div className="tl grid grid-cols-[1fr] items-center gap-x-3 gap-y-2 sm:grid-cols-[11rem_1fr_4.5rem]">
      <style dangerouslySetInnerHTML={{ __html: SERIES_STYLES }} />

      {/* Hour axis. Recessive: hairline ticks, muted labels. */}
      <div className="relative h-4 sm:col-start-2">
        {hourTicks(windowStart, windowEnd).map((minute) => (
          <span
            key={minute}
            className="absolute top-0 -translate-x-1/2 text-[11px] tabular-nums text-stone-400 dark:text-stone-500"
            style={{ left: `${percent(minute)}%` }}
          >
            {formatMinutes(minute)}
          </span>
        ))}
      </div>
      <div className="hidden sm:block" />

      {rows.map((row) => (
        <div key={row.id} className="contents">
          <div className="flex min-w-0 items-center gap-2 sm:col-start-1">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: `var(--tl-series-${row.series + 1})` }}
            />
            <span className="truncate text-sm font-medium">{row.name}</span>
          </div>

          <div className="relative h-8 sm:col-start-2">
              {/* Track */}
              <div className="absolute inset-y-0 left-0 right-0 rounded-md bg-stone-100 dark:bg-stone-800/60" />

              {/* Hour gridlines, behind the marks. */}
              {hourTicks(windowStart, windowEnd).map((minute) => (
                <span
                  key={minute}
                  className="absolute inset-y-0 w-px bg-stone-200 dark:bg-stone-700/70"
                  style={{ left: `${percent(minute)}%` }}
                />
              ))}

              {row.steps.map((step, index) => {
                const left = percent(step.startMinutes)
                const width = percent(step.endMinutes) - left

                // Parallel members occupy the same span, so split the row's
                // height between them rather than drawing one on top of another.
                const siblings = row.steps.filter((s) => s.group === step.group)
                const lane = siblings.indexOf(step)
                const laneHeight = 100 / siblings.length

                return (
                  <span
                    key={index}
                    className="group absolute overflow-visible"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      top: `calc(0.25rem + ${lane * laneHeight}% * 0.9)`,
                      height: `calc((100% - 0.5rem) * ${1 / siblings.length})`,
                    }}
                  >
                    <span
                      className={cx(
                        "block h-full transition-opacity",
                        // The run is one continuous band, so only its true ends
                        // are rounded. A fixed gap between every segment would
                        // eat most of a 10-minute block on a 16-hour axis, so
                        // segments are divided by a hairline instead.
                        step.group === 0 && "rounded-l-[4px]",
                        step.group === row.steps[row.steps.length - 1].group &&
                          "rounded-r-[4px]",
                        step.group < row.steps[row.steps.length - 1].group &&
                          "border-r border-white/70 dark:border-stone-900/70",
                        step.skipped && "opacity-40"
                      )}
                      style={{
                        background: step.skipped
                          ? `repeating-linear-gradient(135deg, var(--tl-series-${row.series + 1}) 0 4px, transparent 4px 8px)`
                          : `var(--tl-series-${row.series + 1})`,
                      }}
                    />

                    {/* Hover detail — the segments are too narrow to label inline. */}
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-stone-900 px-2 py-1 text-xs text-white shadow-lg group-hover:block dark:bg-stone-700"
                    >
                      {step.name} · {formatMinutes(step.startMinutes)}–
                      {formatMinutes(step.endMinutes)} · {step.durationMinutes}
                      {" min"}
                      {siblings.length > 1 && " · parallel"}
                      {step.skipped && " · likely skipped"}
                    </span>
                  </span>
                )
              })}

              {nowMinutes != null &&
                nowMinutes >= windowStart &&
                nowMinutes <= windowEnd && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 z-10 w-0.5 bg-stone-900 dark:bg-white"
                    style={{ left: `${percent(nowMinutes)}%` }}
                  />
                )}
          </div>

          <div className="text-xs tabular-nums text-stone-500 sm:col-start-3 sm:text-right dark:text-stone-400">
            {row.label}
          </div>
        </div>
      ))}
    </div>
  )
}
