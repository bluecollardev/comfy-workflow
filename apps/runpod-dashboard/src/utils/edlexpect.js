/**
 * What the V11 EDL expects of a clip, asked ONCE per clip name for the whole app (the frames badge on a tile and the window's decision to hide incomplete sequences share it).
 * `matches` is reactive: a computed that reads expectedFramesOf re-runs when the answer arrives; undefined/null means nothing to compare (pending, not an EDL element, ambiguous, an old core).
 */
import { reactive } from 'vue'
import { edlAPI } from '../api/edl'
import { expectedOf } from './framecount'

export const expectState = reactive({ matches: {} })
const pending = new Map()
/** Start (once) the lookup of a clip name; resolves with the core's answer ({ match, element? }), never rejects. */
export function ensureMatch(name) {
  if (!name) return Promise.resolve(null)
  if (name in expectState.matches) return Promise.resolve(expectState.matches[name])
  if (!pending.has(name)) pending.set(name, edlAPI.lookup({ clip: name }).catch(() => null).then((m) => { expectState.matches[name] = m || { match: 'none' }; return expectState.matches[name] }))
  return pending.get(name)
}
/** The core's answer for a clip name if it has come (reactive read), else null. */
export const matchOf = (name) => (name && expectState.matches[name]) || null
/** The frames the EDL's cut has for that clip, or null when it is not a known EDL element (then nothing can be incomplete). */
export const expectedFramesOf = (name) => { const m = matchOf(name); return m ? expectedOf(m) : null }
