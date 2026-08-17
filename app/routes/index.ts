import { href, redirect } from "react-router"

/**
 * The app's root does nothing but hand over to `/dashboard`.
 *
 * It exists because of Home Assistant Ingress. React Router renders a link to
 * the root as the bare basename with no trailing slash — `useHref` special-cases
 * it:
 *
 *     joinedPathname = pathname === "/" ? basename : joinPaths([basename, pathname])
 *
 * Ingress publishes the add-on at `/api/hassio_ingress/<token>/` and Home
 * Assistant only routes `/api/hassio_ingress/{token}/{path}`, so that bare form
 * 404s upstream and never reaches this server. The "Dashboard" tab was the one
 * link that produced it, and clicking it from any other page 404'd.
 *
 * The basename cannot simply carry the slash instead: `stripBasename` requires
 * the character after it to be "/" or nothing, so a basename ending in "/"
 * matches the root and rejects every sub-path.
 *
 * Giving the dashboard a real path means nothing in the app ever links to the
 * root, so the bare-basename URL is never generated. This route only catches
 * people arriving at the root — which is how Ingress opens the add-on.
 */
export const loader = () => redirect(href("/dashboard"))
