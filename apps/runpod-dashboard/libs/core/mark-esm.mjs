// Marks libs/core/dist as ESM (the core is ES modules): where it travels without the app's package.json
// (the packaged app's resources/core, which MCP clients launch through) the nearest package.json decides how .js loads.
import { cpSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dist', 'package.json'), '{ "type": "module" }\n')
// The adapter runner and the built-in adapters are plain modules the child process runs (docs/ADR-008); they travel with the core.
cpSync(join(dirname(fileURLToPath(import.meta.url)), 'runtime'), join(dirname(fileURLToPath(import.meta.url)), 'dist', 'runtime'), { recursive: true })
