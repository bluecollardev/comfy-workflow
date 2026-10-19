import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The core's own suite, run from the app: `npm run core:test`. Rooted here, so no Vue plugin and no DOM.
export default defineConfig({ root: dirname(fileURLToPath(import.meta.url)), test: { include: ['tests/**/*.test.ts'], environment: 'node' } })
