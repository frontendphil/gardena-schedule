import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react"
import { useNavigation } from "react-router"

export const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ")

export const Card = ({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}) => (
  <section
    className={cx(
      "rounded-xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900",
      className
    )}
  >
    {(title != null || actions != null) && (
      <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
        <div>
          {title != null && (
            <h2 className="font-semibold tracking-tight">{title}</h2>
          )}
          {description != null && (
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              {description}
            </p>
          )}
        </div>
        {actions}
      </header>
    )}
    <div className="p-5">{children}</div>
  </section>
)

const buttonStyles = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-600",
  secondary:
    "border border-stone-300 bg-white text-stone-800 hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:hover:bg-stone-800",
  danger:
    "border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-stone-900 dark:text-red-400 dark:hover:bg-red-950",
  ghost:
    "text-stone-600 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-800",
}

export const Spinner = ({ className }: { className?: string }) => (
  <svg
    aria-hidden
    viewBox="0 0 16 16"
    className={cx("h-3.5 w-3.5 animate-spin", className)}
  >
    <circle
      cx="8"
      cy="8"
      r="6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeOpacity="0.25"
    />
    <path
      d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
    />
  </svg>
)

export const Button = ({
  variant = "secondary",
  className,
  busy = false,
  children,
  ...props
}: ComponentProps<"button"> & {
  variant?: keyof typeof buttonStyles
  /** Shows a spinner and blocks re-submission while the action is in flight. */
  busy?: boolean
}) => (
  <button
    {...props}
    disabled={props.disabled || busy}
    aria-busy={busy || undefined}
    className={cx(
      "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
      buttonStyles[variant],
      className
    )}
  >
    {busy && <Spinner />}
    {children}
  </button>
)

/**
 * The form data currently in flight, if any.
 *
 * Every mutation in this app is a form post carrying an `intent`, so this lets
 * each button light up for its own action and nothing else. Pages with several
 * copies of the same action (one Save per sprinkler) can narrow further on the
 * row's id, so pressing one does not spin all of them.
 */
export const usePendingForm = () => {
  const navigation = useNavigation()

  return navigation.state === "idle" ? null : (navigation.formData ?? null)
}

/** True while `intent` is being submitted, optionally for one specific row. */
export const useIsPending = (
  intent: string,
  match?: { field: string; value: string }
) => {
  const pending = usePendingForm()

  if (pending?.get("intent") !== intent) return false

  return match == null || pending.get(match.field) === match.value
}

/**
 * A brief "Saved" acknowledgement.
 *
 * Without it a successful save is indistinguishable from a dead button: the
 * server re-renders the same values and nothing on screen changes.
 */
export const SavedFlash = ({
  /** Changes whenever the server confirms another save. */
  token,
  children = "Saved",
}: {
  token: unknown
  children?: ReactNode
}) => {
  const [visible, setVisible] = useState(false)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }

    if (token == null) return

    setVisible(true)
    const timer = setTimeout(() => setVisible(false), 2500)

    return () => clearTimeout(timer)
  }, [token])

  if (!visible) return null

  return (
    <span
      role="status"
      className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"
    >
      <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4">
        <path
          d="M3.5 8.5l3 3 6-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {children}
    </span>
  )
}

export const Input = ({ className, ...props }: ComponentProps<"input">) => (
  <input
    {...props}
    className={cx(
      "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-stone-700 dark:bg-stone-950",
      className
    )}
  />
)

export const Select = ({ className, ...props }: ComponentProps<"select">) => (
  <select
    {...props}
    className={cx(
      "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-stone-700 dark:bg-stone-950",
      className
    )}
  />
)

export const Field = ({
  label,
  hint,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}) => (
  <label className="block">
    <span className="text-sm font-medium">{label}</span>
    {children}
    {hint != null && (
      <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
        {hint}
      </span>
    )}
  </label>
)

/**
 * A checkbox styled as a switch. Submits through the enclosing form, so every
 * toggle in the app is a plain form post and works without JavaScript.
 *
 * The appearance is driven by the real checkbox's `:checked` state rather than
 * by a `checked` prop, so it animates identically whether the caller controls it
 * (`checked` + `onChange`) or leaves it uncontrolled (`defaultChecked` behind a
 * Save button). Reading the prop instead would leave every uncontrolled toggle
 * looking permanently off, however much the user clicked it.
 */
export const Toggle = ({ className, ...props }: ComponentProps<"input">) => (
  <span
    className={cx(
      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-stone-300 transition-colors has-checked:bg-emerald-600 dark:bg-stone-700 dark:has-checked:bg-emerald-600",
      className
    )}
  >
    <input
      {...props}
      type="checkbox"
      className="peer absolute inset-0 z-10 cursor-pointer opacity-0"
    />
    <span className="pointer-events-none ml-0.5 inline-block h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
  </span>
)

const badgeStyles = {
  neutral:
    "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  active: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bad: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
}

export const Badge = ({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeStyles
  children: ReactNode
}) => (
  <span
    className={cx(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      badgeStyles[tone]
    )}
  >
    {children}
  </span>
)

export const EmptyState = ({
  title,
  children,
}: {
  title: ReactNode
  children?: ReactNode
}) => (
  <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center dark:border-stone-700">
    <p className="font-medium">{title}</p>
    {children != null && (
      <div className="mt-2 text-sm text-stone-500 dark:text-stone-400">
        {children}
      </div>
    )}
  </div>
)
