// Open a URL in the default browser once it responds (cross-platform).
import { exec } from 'node:child_process'

const url = process.argv[2]
const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`

for (let i = 0; i < 60; i++) {
  try {
    await fetch(url)
    break
  } catch {
    await new Promise((r) => setTimeout(r, 500))
  }
}
exec(cmd)
console.log(`Opened ${url}`)
