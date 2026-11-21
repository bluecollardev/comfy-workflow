// Collapse and expand of DPX sequences in the Outputs gallery (Lucas, 2026-11-21: a run of 362 files on CanalV2-fix-v020-a "is a lot to preview at once").
// A collapsed sequence is ONE tile (its one poster is SequenceThumb's own lazy first-frame preview); expanding lists its frames a page at a time and loads nothing per frame.
// The choice lasts as long as the window (module state); the mode alone is mirrored to localStorage, guarded, as a per-viewer convenience.
import { reactive } from 'vue'

export const AUTO_MAX = 12   // a sequence of more frames than this starts collapsed in 'auto'
export const PAGE = 24       // frames listed per page; Show More adds a page
const KEY = 'outputs.dpx.mode'

/** Whether a sequence of `frames` frames is expanded, given the mode ('auto' | 'expanded' | 'collapsed') and its own override (true | false | undefined). A person's click on one sequence wins over the mode. */
export const expandedOf = (mode, override, frames) => (typeof override === 'boolean' ? override : mode === 'expanded' ? true : mode === 'collapsed' ? false : frames <= AUTO_MAX)

const readMode = () => { try { const v = globalThis.localStorage?.getItem(KEY); return v === 'expanded' || v === 'collapsed' ? v : 'auto' } catch { return 'auto' } }
const writeMode = (m) => { try { if (m === 'auto') globalThis.localStorage?.removeItem(KEY); else globalThis.localStorage?.setItem(KEY, m) } catch { /* private window or blocked storage: the choice just lasts this window */ } }

export const dpxView = reactive({ mode: readMode(), override: {}, pages: {} })
export const isExpanded = (tile) => expandedOf(dpxView.mode, dpxView.override[tile.key], tile.frames?.length || 0)
export const toggleSeq = (tile) => { dpxView.override[tile.key] = !isExpanded(tile) }
/** Collapse All / Expand All: the mode for every sequence; every single choice and page is forgotten. */
export const setAll = (mode) => { dpxView.mode = mode; dpxView.override = {}; dpxView.pages = {}; writeMode(mode) }
export const pageOf = (tile) => dpxView.pages[tile.key] || 1
export const shownFrames = (tile) => (tile.frames || []).slice(0, pageOf(tile) * PAGE)
export const showMore = (tile) => { dpxView.pages[tile.key] = pageOf(tile) + 1 }
