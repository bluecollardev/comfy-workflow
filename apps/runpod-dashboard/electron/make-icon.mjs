// Renders build/icon.png (1024×1024) — electron-builder derives icon.icns / icon.ico from it.
// Usage: node electron/make-icon.mjs
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })

// macOS-style rounded square; chip glyph in the PocketPT primary on the app's surface color.
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2a2a"/>
      <stop offset="1" stop-color="#161616"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#bg)"/>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="6"/>
  <g stroke="#00B8EC" stroke-width="34" stroke-linecap="round">
    ${[-150, -50, 50, 150].map((o) => `
      <line x1="${512 + o}" y1="236" x2="${512 + o}" y2="300"/>
      <line x1="${512 + o}" y1="724" x2="${512 + o}" y2="788"/>
      <line x1="236" y1="${512 + o}" x2="300" y2="${512 + o}"/>
      <line x1="724" y1="${512 + o}" x2="788" y2="${512 + o}"/>`).join('')}
  </g>
  <rect x="300" y="300" width="424" height="424" rx="56" fill="#1E1E1E" stroke="#00B8EC" stroke-width="34"/>
  <rect x="392" y="392" width="240" height="240" rx="28" fill="#00B8EC"/>
  <rect x="392" y="392" width="240" height="240" rx="28" fill="#ffffff" fill-opacity="0.12"/>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`)
await page.screenshot({ path: out, omitBackground: true })
await browser.close()
console.log(`wrote ${out}`)
