import { afterEach, describe, expect, it } from 'vitest'
import { analyse, checkRedirects, DEFAULT_FOLLOW_OPTIONS } from '../src/check.js'
import { FixtureServer } from './fixtureServer.js'

describe('checkRedirects against a real HTTP server', () => {
  let server: FixtureServer
  afterEach(async () => server.close())

  it('reports a clean 200 with no findings', async () => {
    server = new FixtureServer({ '/': {} })
    const base = await server.listen()
    const r = await checkRedirects(base + '/')
    expect(r.redirectCount).toBe(0)
    expect(r.finalStatus).toBe(200)
    expect(r.findings).toEqual([])
  })

  it('a single 301 is fine; two in a row is a chain, with the shortcut spelled out', async () => {
    server = new FixtureServer({
      '/a': { status: 301, headers: { location: '/b' } },
      '/b': { status: 301, headers: { location: '/c' } },
      '/c': {}
    })
    const base = await server.listen()
    const single = await checkRedirects(base + '/b')
    expect(single.redirectCount).toBe(1)
    expect(single.findings).toEqual([])
    const chain = await checkRedirects(base + '/a')
    expect(chain.redirectCount).toBe(2)
    expect(chain.hops.map((h) => h.status)).toEqual([301, 301, 200])
    expect(chain.finalUrl).toBe(base + '/c')
    expect(chain.findings.map((f) => f.code)).toEqual(['chain'])
    expect(chain.findings[0].message).toContain(`point ${base}/a straight at ${base}/c`)
  })

  it('detects a loop without hanging', async () => {
    server = new FixtureServer({
      '/x': { status: 302, headers: { location: '/y' } },
      '/y': { status: 302, headers: { location: '/x' } }
    })
    const base = await server.listen()
    const r = await checkRedirects(base + '/x')
    expect(r.findings.map((f) => f.code)).toContain('loop')
    expect(r.findings.map((f) => f.code)).toContain('temporary-redirect')
    expect(r.hops).toHaveLength(2)
  })

  it('gives up at max hops', async () => {
    const routes: Record<string, { status: number; headers: Record<string, string> }> = {}
    for (let i = 0; i < 30; i++) routes[`/h${i}`] = { status: 301, headers: { location: `/h${i + 1}` } }
    server = new FixtureServer(routes)
    const base = await server.listen()
    const r = await checkRedirects(base + '/h0', { ...DEFAULT_FOLLOW_OPTIONS, maxHops: 5 })
    expect(r.findings.map((f) => f.code)).toEqual(['too-many-hops'])
    expect(r.hops.length).toBe(6)
  })

  it('flags a redirect that lands on an error page, and a meta refresh on the final page', async () => {
    server = new FixtureServer({
      '/gone': { status: 301, headers: { location: '/missing' } },
      '/meta': { body: '<html><head><meta http-equiv="refresh" content="0; url=/elsewhere"></head><body></body></html>' }
    })
    const base = await server.listen()
    const err = await checkRedirects(base + '/gone')
    expect(err.finalStatus).toBe(404)
    expect(err.findings.map((f) => f.code)).toEqual(['redirect-to-error'])
    const meta = await checkRedirects(base + '/meta')
    expect(meta.findings.map((f) => f.code)).toEqual(['meta-refresh'])
    expect(meta.findings[0].message).toContain('/elsewhere')
  })

  it('reports a fetch error for an unreachable host', async () => {
    server = new FixtureServer({})
    const base = await server.listen()
    await server.close()
    server = new FixtureServer({})
    await server.listen()
    const r = await checkRedirects(base + '/', { ...DEFAULT_FOLLOW_OPTIONS, timeoutMs: 2000 })
    expect(r.fetchError).not.toBeNull()
    expect(r.findings.map((f) => f.code)).toEqual(['fetch-error'])
  })
})

describe('analyse (pure)', () => {
  const followed = (hops: Array<{ url: string; status: number; location: string | null }>, finalStatus = 200) => ({
    hops: hops.map((h) => ({ ...h, latencyMs: 1 })),
    finalStatus,
    fetchError: null,
    bodyHead: null,
    loopAt: null,
    tooManyHops: false
  })

  it('flags an HTTPS→HTTP downgrade as a failure and HTTP→HTTPS on the start URL as advice', () => {
    const down = analyse('https://a.test/', followed([{ url: 'https://a.test/', status: 301, location: 'http://a.test/x' }, { url: 'http://a.test/x', status: 200, location: null }]))
    expect(down.findings.map((f) => f.code)).toEqual(['https-to-http'])
    const up = analyse('http://a.test/', followed([{ url: 'http://a.test/', status: 301, location: 'https://a.test/' }, { url: 'https://a.test/', status: 200, location: null }]))
    expect(up.findings.map((f) => f.code)).toEqual(['http-to-https'])
    expect(up.redirectCount).toBe(1)
  })

  it('a 308 is permanent and raises nothing; a 307 is temporary advice', () => {
    expect(analyse('https://a.test/', followed([{ url: 'https://a.test/', status: 308, location: 'https://a.test/b' }, { url: 'https://a.test/b', status: 200, location: null }])).findings).toEqual([])
    expect(analyse('https://a.test/', followed([{ url: 'https://a.test/', status: 307, location: 'https://a.test/b' }, { url: 'https://a.test/b', status: 200, location: null }])).findings.map((f) => f.code)).toEqual(['temporary-redirect'])
  })
})
