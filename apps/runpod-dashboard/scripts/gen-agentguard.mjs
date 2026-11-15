// Regenerate libs/core/src/agentguard.script.ts from .claude/hooks/guard-bash.sh (a core test fails when they differ): node scripts/gen-agentguard.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url))
const script = readFileSync(join(here, '..', '..', '..', '.claude', 'hooks', 'guard-bash.sh'), 'utf8')
writeFileSync(join(here, '..', 'libs', 'core', 'src', 'agentguard.script.ts'), `/** The guard script, generated from .claude/hooks/guard-bash.sh (a test asserts they are identical; regenerate with: node scripts/gen-agentguard.mjs). */\nexport const SCRIPT = ${JSON.stringify(script)}\n`)
console.log('agentguard.script.ts written')
