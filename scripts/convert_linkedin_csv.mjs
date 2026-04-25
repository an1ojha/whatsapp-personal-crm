// One-time script: converts ranked_connections.csv → /public/linkedin_data/ranked_connections.json
// Run from project root: node scripts/convert_linkedin_csv.mjs

import { createReadStream, mkdirSync, writeFileSync } from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const csvPath = join(root, 'linkedin_data', 'ranked_connections.csv')
const outDir = join(root, 'public', 'linkedin_data')
const outPath = join(outDir, 'ranked_connections.json')

mkdirSync(outDir, { recursive: true })

const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity })

let headers = null
const rows = []

function parseLine(line) {
  // CSV parse that handles commas inside unquoted fields (this CSV has no quoted fields)
  return line.split(',')
}

for await (const line of rl) {
  if (!headers) {
    headers = parseLine(line)
    continue
  }
  const vals = parseLine(line)
  if (vals.length < headers.length) continue

  const obj = {}
  headers.forEach((h, i) => { obj[h] = vals[i] ?? '' })

  // Drop PII
  delete obj.email

  // Parse numerics
  for (const f of ['rank', 'total_score', 'relevance_score', 'relationship_score', 'helpfulness_score', 'total_messages']) {
    obj[f] = parseInt(obj[f], 10) || 0
  }

  // Parse booleans
  for (const f of ['they_initiated', 'is_us', 'is_decision_maker', 'is_vc']) {
    obj[f] = obj[f] === 'True'
  }

  rows.push(obj)
}

writeFileSync(outPath, JSON.stringify(rows, null, 0))
console.log(`Written ${rows.length} profiles to ${outPath}`)
