// Write web/.env.local from the running local Supabase stack.
import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const out = execSync('npm exec --yes --package=supabase@2 -- supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const env = Object.fromEntries(
  out
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)="?(.*?)"?$/.exec(l))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
)
const url = env.API_URL
const key = env.PUBLISHABLE_KEY || env.ANON_KEY
if (!url || !key) {
  console.error('Local Supabase is not running. Run `make db-start` first.')
  process.exit(1)
}

const file = 'web/.env.local'
const next = `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`
if (existsSync(file) && readFileSync(file, 'utf8') === next) {
  console.log(`${file} is up to date`)
} else {
  writeFileSync(file, next)
  console.log(`Wrote ${file}`)
}
