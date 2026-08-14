const TOKEN_URL =
  "https://api.authentication.husqvarnagroup.dev/v1/oauth2/token"

/** Refresh this far before the token actually expires. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000

export const getAppKey = () => {
  const key = process.env.GARDENA_APPLICATION_KEY

  if (key == null) {
    throw new Error("Missing GARDENA_APPLICATION_KEY")
  }

  return key
}

const getAppSecret = () => {
  const secret = process.env.GARDENA_APPLICATION_SECRET

  if (secret == null) {
    throw new Error("Missing GARDENA_APPLICATION_SECRET")
  }

  return secret
}

type Token = {
  value: string
  expiresAt: number
}

let token: Token | null = null
let pending: Promise<Token> | null = null

const requestToken = async (): Promise<Token> => {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: getAppKey(),
    client_secret: getAppSecret(),
  })

  const response = await fetch(TOKEN_URL, { method: "POST", body })

  if (!response.ok) {
    throw new Error(
      `Gardena auth failed: ${response.status} ${await response.text()}`
    )
  }

  const { access_token, expires_in } = await response.json()

  if (typeof access_token !== "string") {
    throw new Error("Gardena auth returned no access_token")
  }

  return {
    value: access_token,
    expiresAt: Date.now() + (expires_in ?? 86400) * 1000,
  }
}

/**
 * The scheduler needs a token whether or not a browser is open, so the token
 * lives in the process rather than in a cookie session. Concurrent callers share
 * one in-flight request — the API allows very few calls per month and a burst of
 * loaders must not each mint a token.
 */
export const getToken = async (): Promise<string> => {
  if (token != null && Date.now() < token.expiresAt - REFRESH_MARGIN_MS) {
    return token.value
  }

  pending ??= requestToken()
    .then((fresh) => {
      token = fresh
      return fresh
    })
    .finally(() => {
      pending = null
    })

  return (await pending).value
}

/** Drops the cached token so the next call re-authenticates. Used on a 401. */
export const invalidateToken = () => {
  token = null
}
