/**
 * Follow a URL's redirects one hop at a time (so every hop is observable) and
 * analyse the chain. Network in `followRedirects`, pure analysis in `analyse`.
 */

export interface Hop {
  url: string
  status: number
  /** Resolved absolute Location, or null when the hop was not a redirect. */
  location: string | null
  latencyMs: number
}

export type FindingCode =
  | 'chain'
  | 'loop'
  | 'too-many-hops'
  | 'https-to-http'
  | 'http-to-https'
  | 'temporary-redirect'
  | 'meta-refresh'
  | 'redirect-to-error'
  | 'fetch-error'

export interface Finding {
  code: FindingCode
  message: string
}

export interface RedirectReport {
  url: string
  hops: Hop[]
  finalUrl: string
  /** Status of the last response, or null when a request failed. */
  finalStatus: number | null
  fetchError: string | null
  /** Number of redirects followed (hops with a Location). */
  redirectCount: number
  findings: Finding[]
}

export interface FollowOptions {
  maxHops: number
  timeoutMs: number
  userAgent: string
  /** Injected for tests. */
  fetch?: typeof fetch
}

export const DEFAULT_FOLLOW_OPTIONS: FollowOptions = {
  maxHops: 10,
  timeoutMs: 10_000,
  userAgent: 'crawlcove-redirect-chain-checker/1.0 (+https://github.com/CrawlCove/crawlcove-redirect-chain-checker)'
}

export const ALL_FINDING_CODES: readonly FindingCode[] = [
  'chain',
  'loop',
  'too-many-hops',
  'https-to-http',
  'http-to-https',
  'temporary-redirect',
  'meta-refresh',
  'redirect-to-error',
  'fetch-error'
]

/** Findings that fail a CI run unless --fail-on says otherwise. http-to-https and temporary-redirect are advisories. */
export const DEFAULT_FAIL_ON: readonly FindingCode[] = ['chain', 'loop', 'too-many-hops', 'https-to-http', 'meta-refresh', 'redirect-to-error', 'fetch-error']

interface Followed {
  hops: Hop[]
  finalStatus: number | null
  fetchError: string | null
  /** First 4 KB of a final 200 HTML body, for the meta-refresh check. */
  bodyHead: string | null
  loopAt: string | null
  tooManyHops: boolean
}

export async function followRedirects(url: string, opts: FollowOptions = DEFAULT_FOLLOW_OPTIONS): Promise<Followed> {
  const doFetch = opts.fetch ?? fetch
  const hops: Hop[] = []
  const seen = new Set<string>()
  let current = url

  for (;;) {
    if (seen.has(current)) return { hops, finalStatus: hops[hops.length - 1]?.status ?? null, fetchError: null, bodyHead: null, loopAt: current, tooManyHops: false }
    seen.add(current)
    if (hops.length > opts.maxHops) return { hops, finalStatus: hops[hops.length - 1]?.status ?? null, fetchError: null, bodyHead: null, loopAt: null, tooManyHops: true }

    const started = Date.now()
    let res: Response
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
      try {
        res = await doFetch(current, { redirect: 'manual', headers: { 'user-agent': opts.userAgent }, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      const name = err instanceof Error ? err.name : String(err)
      return { hops, finalStatus: null, fetchError: name === 'AbortError' ? 'TIMEOUT' : (err as Error).message || name, bodyHead: null, loopAt: null, tooManyHops: false }
    }
    const latencyMs = Date.now() - started
    const rawLocation = res.headers.get('location')
    const isRedirect = res.status >= 300 && res.status < 400 && rawLocation !== null
    let location: string | null = null
    if (isRedirect) {
      try {
        location = new URL(rawLocation as string, current).toString()
      } catch {
        location = null
      }
    }
    hops.push({ url: current, status: res.status, location, latencyMs })
    if (location === null) {
      const type = res.headers.get('content-type') ?? ''
      let bodyHead: string | null = null
      if (res.status === 200 && /text\/html/i.test(type)) {
        try {
          bodyHead = (await res.text()).slice(0, 4096)
        } catch {
          bodyHead = null
        }
      } else {
        try {
          await res.body?.cancel()
        } catch {
          /* ignore */
        }
      }
      return { hops, finalStatus: res.status, fetchError: null, bodyHead, loopAt: null, tooManyHops: false }
    }
    current = location
  }
}

const META_REFRESH_RE = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*(\d+)\s*;\s*url\s*=\s*([^"'>\s]+)/i

/** Pure: derive findings from what followRedirects observed. */
export function analyse(url: string, f: Followed): RedirectReport {
  const findings: Finding[] = []
  const redirects = f.hops.filter((h) => h.location !== null)
  const finalUrl = f.hops.length > 0 ? f.hops[f.hops.length - 1].location ?? f.hops[f.hops.length - 1].url : url

  if (f.fetchError) findings.push({ code: 'fetch-error', message: `${f.hops.length > 0 ? finalUrl : url} could not be fetched: ${f.fetchError}` })
  if (f.loopAt) findings.push({ code: 'loop', message: `redirect loop: ${f.loopAt} was reached twice` })
  if (f.tooManyHops) findings.push({ code: 'too-many-hops', message: `gave up after ${redirects.length} redirects` })
  if (redirects.length >= 2 && !f.loopAt && !f.tooManyHops)
    findings.push({ code: 'chain', message: `${redirects.length} redirects in a row — point ${url} straight at ${finalUrl}` })

  for (const h of redirects) {
    const from = safeUrl(h.url)
    const to = safeUrl(h.location as string)
    if (from && to) {
      if (from.protocol === 'https:' && to.protocol === 'http:') findings.push({ code: 'https-to-http', message: `${h.url} downgrades to HTTP (${h.location})` })
      if (from.protocol === 'http:' && to.protocol === 'https:' && h.url === url)
        findings.push({ code: 'http-to-https', message: `${url} is reached over HTTP first; link to ${h.location} directly` })
    }
    if (h.status === 302 || h.status === 307)
      findings.push({ code: 'temporary-redirect', message: `${h.url} uses a temporary ${h.status}; use 301/308 if the move is permanent` })
  }

  if (f.finalStatus !== null && f.finalStatus >= 400 && redirects.length > 0)
    findings.push({ code: 'redirect-to-error', message: `the chain ends at ${finalUrl} with HTTP ${f.finalStatus}` })

  if (f.bodyHead) {
    const m = META_REFRESH_RE.exec(f.bodyHead)
    if (m) findings.push({ code: 'meta-refresh', message: `${finalUrl} redirects again with a meta refresh (${m[1]}s → ${m[2]}); search engines treat this as a weak redirect` })
  }

  return { url, hops: f.hops, finalUrl, finalStatus: f.finalStatus, fetchError: f.fetchError, redirectCount: redirects.length, findings }
}

function safeUrl(u: string): URL | null {
  try {
    return new URL(u)
  } catch {
    return null
  }
}

/** Follow + analyse in one call. */
export async function checkRedirects(url: string, opts: FollowOptions = DEFAULT_FOLLOW_OPTIONS): Promise<RedirectReport> {
  return analyse(url, await followRedirects(url, opts))
}
