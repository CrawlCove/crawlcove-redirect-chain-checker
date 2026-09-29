# Changelog

## 1.0.0 — 2026-09-29

Initial release.

- `redirect-chain-checker <url...>` / `--file urls.txt`: follows every hop
  manually so each status, Location and latency is shown.
- Findings: `chain` (2+ redirects, with the direct target spelled out),
  `loop`, `too-many-hops`, `https-to-http`, `http-to-https`,
  `temporary-redirect` (302/307), `meta-refresh` on the final page,
  `redirect-to-error`, `fetch-error`.
- `--fail-on` picks which findings set exit code 1 (default: everything
  except the two advisories `http-to-https` and `temporary-redirect`);
  `--json` for scripts.
