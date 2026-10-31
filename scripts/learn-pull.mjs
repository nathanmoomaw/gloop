import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { toJSONL } from '../src/audio/learn.js'

// Pull recent days of learn entries from DynamoDB into learning/remote/<day>.jsonl
// using the AWS CLI so the gloop repo needs no AWS SDK dependency.

export function unmarshal(attr) {
  if (!attr || typeof attr !== 'object') return null
  if ('S' in attr) return attr.S
  if ('N' in attr) return Number(attr.N)
  if ('BOOL' in attr) return Boolean(attr.BOOL)
  if ('NULL' in attr) return null
  if ('L' in attr) return attr.L.map(unmarshal)
  if ('M' in attr) {
    return Object.fromEntries(Object.entries(attr.M).map(([k, v]) => [k, unmarshal(v)]))
  }
  return null
}

// An unmarshaled row as a learn entry: the same shape gloop logs locally
// (the `day` partition key dropped).
export function toEntry({ id, t, kind, params, levels, state, host }) {
  return { id, t, kind, params, levels, state, host }
}

export function lastDays(n, now = new Date()) {
  const count = Math.max(0, Math.floor(Number(n) || 0))
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = []
  for (let i = 0; i < count; i++) {
    days.push(new Date(base - i * 86400_000).toISOString().slice(0, 10))
  }
  return days
}

function queryDay(day, table, region) {
  const out = execFileSync(
    'aws',
    [
      'dynamodb',
      'query',
      '--table-name',
      table,
      '--region',
      region,
      '--key-condition-expression',
      '#d = :d',
      '--expression-attribute-names',
      '{"#d":"day"}',
      '--expression-attribute-values',
      JSON.stringify({ ':d': { S: day } }),
      '--output',
      'json',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const parsed = JSON.parse(out)
  return (parsed.Items || []).map((raw) => toEntry(unmarshal({ M: raw })))
}

function main() {
  const daysArg = Number(process.argv[2] ?? 7)
  const table = process.env.GLOOP_LEARN_TABLE || 'gloop-learn'
  const region = process.env.AWS_REGION || 'us-east-1'
  const outDir = join(process.cwd(), 'learning', 'remote')
  mkdirSync(outDir, { recursive: true })

  let total = 0
  for (const day of lastDays(daysArg)) {
    const entries = queryDay(day, table, region)
    if (entries.length === 0) continue
    entries.sort((a, b) => String(a.t).localeCompare(String(b.t)))
    writeFileSync(join(outDir, `${day}.jsonl`), toJSONL(entries), 'utf8')
    console.log(`${day}: ${entries.length} entries`)
    total += entries.length
  }
  console.log(`total: ${total} entries`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
