# crawlcove-redirect-chain-checker

A redirect chain checker for the command line: follow every hop of a URL's redirects, see each status code and Location, and get told when a chain, loop, HTTPS downgrade, meta refresh or redirect-to-404 is costing you crawl budget and link equity. Exit code 1 in CI when it matters.

Prefer a browser? The same check runs at [crawlcove.com/tools/redirect-checker](https://crawlcove.com/tools/redirect-checker?utm_source=github&utm_medium=crawlcove-redirect-chain-checker).

## Install

```sh
# one-off, nothing installed (Node 18+):
npx github:CrawlCove/crawlcove-redirect-chain-checker https://example.com/old-page

# global command, from the release tarball:
npm install -g https://github.com/CrawlCove/crawlcove-redirect-chain-checker/archive/refs/tags/v1.0.0.tar.gz
redirect-chain-checker --version
```

(The tarball form is deliberate: a global `github:` install on npm 10 leaves a dangling symlink. The npm package is coming.)

## Usage

```sh
redirect-chain-checker <url...> [options]
redirect-chain-checker --file urls.txt      # one URL per line, # comments allowed

Options:
  --max-hops <n>       give up after this many redirects (default 10)
  --timeout <ms>       per-request timeout (default 10000)
  --json               JSON output for scripts
  --fail-on <codes>    comma-separated finding codes that set exit code 1, or "none"
                       (default: chain,loop,too-many-hops,https-to-http,meta-refresh,redirect-to-error,fetch-error)
```

Example:

```
$ redirect-chain-checker http://example.com/old
http://example.com/old
  301 → https://example.com/old  (120 ms)
  ↳ 301 → https://www.example.com/old  (95 ms)
  ↳ 302 → https://www.example.com/new  (88 ms)
  ↳ 200  (140 ms)
  3 redirects → https://www.example.com/new (200)
  ! chain: 3 redirects in a row — point http://example.com/old straight at https://www.example.com/new
  ! http-to-https: http://example.com/old is reached over HTTP first; link to https://example.com/old directly
  ! temporary-redirect: https://www.example.com/old uses a temporary 302; use 301/308 if the move is permanent
```

Scheme-less URLs are tried over HTTPS. Exit codes: `0` clean (or only non-gated findings), `1` a gated finding, `2` usage error.

## What each finding means, and the fix

| Finding | Why it matters | Fix |
|---|---|---|
| `chain` | Every extra hop costs crawlers time and leaks a little link equity; Google follows at most ~10 and may give up sooner. | Point the first URL straight at the final one (and update internal links to the final URL). |
| `loop` | The URL never resolves — users see a browser error, crawlers drop it. | Find the rule that sends the final URL back to the start. |
| `too-many-hops` | Same as a chain, but past the point a crawler will follow. | As `chain`. |
| `https-to-http` | A secure page redirecting to an insecure one drops the padlock and can be flagged as mixed content. | Make the target HTTPS. |
| `http-to-https` | Fine as a safety net, but every internal link that starts on HTTP costs a hop. | Link to the HTTPS URL directly; keep the redirect for old links. |
| `temporary-redirect` | 302/307 tell search engines the old URL may return, so ranking signals may stay on the old URL. | Use 301 (or 308) for a permanent move. |
| `meta-refresh` | A `<meta http-equiv="refresh">` after the HTTP redirects finish is a slow, weak redirect that some crawlers ignore. | Replace with a server-side 301. |
| `redirect-to-error` | The chain ends on a 4xx/5xx — a soft way of losing the page. | Redirect to the live equivalent, or return 410 directly. |
| `fetch-error` | Something in the chain did not respond (DNS, TLS, timeout). | Check the host in the last hop shown. |

## Works with CrawlCove

This checks the URLs you give it. [Crawl Cove](https://crawlcove.com/?utm_source=github&utm_medium=crawlcove-redirect-chain-checker), the desktop SEO crawler for Windows and Mac, finds every redirect chain across a whole site — including the internal links that point at the start of each chain, which is what you actually have to fix.

## Related tools

- [crawlcove-sf-import](https://github.com/CrawlCove/crawlcove-sf-import) — convert a Screaming Frog export into the Crawl Cove export format, with a report of what carried over.
- [crawlcove-schema-validator](https://github.com/CrawlCove/crawlcove-schema-validator) — validate a page's JSON-LD against Google's required and recommended rich-result properties.
- [crawlcove-hreflang-checker](https://github.com/CrawlCove/crawlcove-hreflang-checker) — check a page's or a sitemap's hreflang tags: codes, self-reference, x-default and return tags.
- [crawlcove-cli](https://github.com/CrawlCove/crawlcove-cli) — headless whole-site crawl with redirect-chain, broken-link, title and noindex checks.
- [crawlcove-action](https://github.com/CrawlCove/crawlcove-action) — the same checks as a GitHub Action on every PR.
- [crawlcove-mcp](https://github.com/CrawlCove/crawlcove-mcp) — crawl data for Claude, Cursor and other AI assistants.
- [crawlcove-export-spec](https://github.com/CrawlCove/crawlcove-export-spec) — the JSON Schema for Crawl Cove's crawl export.
- [crawlcove-sitemap-validator](https://github.com/CrawlCove/crawlcove-sitemap-validator) — validate an XML sitemap or sitemap index against the protocol and search-engine limits.
- [crawlcove-robots-txt-tester](https://github.com/CrawlCove/crawlcove-robots-txt-tester) — lint a robots.txt and test which URLs each crawler may fetch, with the deciding line.

## License

MIT — see [LICENSE](LICENSE).
