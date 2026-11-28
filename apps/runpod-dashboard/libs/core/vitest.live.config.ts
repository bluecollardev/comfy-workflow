import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Live tests: the REAL Wasabi bucket and network volume, with this machine's keys. Never part of the merge gate: `npm run storage:live`.
export default defineConfig({ root: dirname(fileURLToPath(import.meta.url)), test: { include: ['tests-live/**/*.live.ts'], environment: 'node', testTimeout: 240_000, hookTimeout: 240_000, fileParallelism: false } })
