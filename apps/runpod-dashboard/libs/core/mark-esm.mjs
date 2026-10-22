// Marks libs/core/dist as ESM (the core is ES modules): where it travels without the app's package.json
// (the packaged app's resources/core, which MCP clients launch through) the nearest package.json decides how .js loads.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'dist', 'package.json'), '{ "type": "module" }\n')
