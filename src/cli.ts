#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Command } from 'commander'
import { ALL_FINDING_CODES, checkRedirects, DEFAULT_FAIL_ON, DEFAULT_FOLLOW_OPTIONS, type FindingCode, type RedirectReport } from './check.js'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

const program = new Command()
program
  .name('redirect-chain-checker')
  .description('Follow every hop of a URL’s redirects and flag chains, loops, HTTPS downgrades, meta refreshes and redirects to errors.')
  .version(version)
  .argument('[urls...]', 'URLs to check')
  .option('--file <path>', 'read URLs from a file, one per line (# comments allowed)')
  .option('--max-hops <n>', 'give up after this many redirects', String(DEFAULT_FOLLOW_OPTIONS.maxHops))
  .option('--timeout <ms>', 'per-request timeout', String(DEFAULT_FOLLOW_OPTIONS.timeoutMs))
  .option('--json', 'print JSON instead of a table', false)
  .option('--fail-on <codes>', `comma-separated finding codes that make the exit code 1 (${ALL_FINDING_CODES.join(', ')}, or "none")`, DEFAULT_FAIL_ON.join(','))
  .action(async (urls: string[], opts) => {
    const list = [...urls]
    if (opts.file) {
      list.push(
        ...readFileSync(opts.file, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#'))
      )
    }
    if (list.length === 0) {
      program.help({ error: true })
    }
    const failOn = new Set<FindingCode>(opts.failOn === 'none' ? [] : (opts.failOn as string).split(',').map((s) => s.trim() as FindingCode))
    for (const code of failOn) {
      if (!ALL_FINDING_CODES.includes(code)) {
        console.error(`Unknown --fail-on code "${code}". Valid: ${ALL_FINDING_CODES.join(', ')}`)
        process.exitCode = 2
        return
      }
    }

    const reports: RedirectReport[] = []
    for (const url of list) {
      const target = /^https?:\/\//i.test(url) ? url : `https://${url}`
      reports.push(await checkRedirects(target, { ...DEFAULT_FOLLOW_OPTIONS, maxHops: Number(opts.maxHops), timeoutMs: Number(opts.timeout) }))
    }

    if (opts.json) process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`)
    else process.stdout.write(reports.map(render).join('\n'))

    const failing = reports.filter((r) => r.findings.some((f) => failOn.has(f.code)))
    if (failing.length > 0) {
      console.error(`\n${failing.length} of ${reports.length} URL(s) have failing findings (${[...failOn].join(', ')}).`)
      process.exitCode = 1
    }
  })

export function render(r: RedirectReport): string {
  const lines = [`${r.url}`]
  r.hops.forEach((h, i) => {
    const arrow = h.location ? ` → ${h.location}` : ''
    lines.push(`  ${i === 0 ? '' : '↳ '}${h.status}${arrow}  (${h.latencyMs} ms)`)
  })
  if (r.fetchError) lines.push(`  ✗ ${r.fetchError}`)
  lines.push(r.redirectCount === 0 ? '  0 redirects' : `  ${r.redirectCount} redirect${r.redirectCount === 1 ? '' : 's'} → ${r.finalUrl} (${r.finalStatus ?? 'no response'})`)
  for (const f of r.findings) lines.push(`  ! ${f.code}: ${f.message}`)
  if (r.findings.length === 0) lines.push('  ✓ no findings')
  return lines.join('\n') + '\n'
}

program.parseAsync(process.argv)
