// Collapse and expand of DPX sequences and of file groups in the Outputs gallery (Lucas, 2026-11-21: a run of 362 files on CanalV2-fix-v020-a "is a lot to preview at once"; "all can be expanded"; "we have to click show more so many times").
// A collapsed sequence is ONE tile (its one poster is SequenceThumb's own lazy first-frame preview); expanding lists its frames and loads nothing per frame. Groups (utils/videogroups.js) behave the same way.
// Paging: rows with no media (DPX frames, Data, Other, Temp) 200 at a time, groups with previews 48 at a time; the next page loads by itself when the end of the list scrolls near the viewport (PageSentinel.vue),
// Show More stays as the fallback without IntersectionObserver, Show All renders every row (media is mounted lazily near the viewport and the player cap holds).
// The choice lasts as long as the window (module state); the mode and the temp toggle are mirrored to localStorage, guarded, as per-viewer conveniences.
import { reactive } from 'vue'

export const AUTO_MAX = 12      // a sequence of more frames than this starts collapsed in 'auto'
export const GROUP_OPEN_MAX = 4 // a group of this many files or fewer starts expanded in 'auto', a bigger one collapsed
export const PAGE = 200         // rows listed per page when they carry no media (DPX frames, Data, Other, Temp)
export const PAGE_MEDIA = 48    // rows listed per page in a group with previews (Videos, Images, Audio)
export const HAS_IO = typeof IntersectionObserver !== 'undefined'
const KEY = 'outputs.dpx.mode'
const TEMP_KEY = 'outputs.temp.show'
const INCOMPLETE_KEY = 'outputs.incomplete.show'

/** Whether a sequence of `frames` frames is expanded, given the mode ('auto' | 'expanded' | 'collapsed') and its own override (true | false | undefined). A person's click on one sequence wins over the mode. */
export const expandedOf = (mode, override, frames) => (typeof override === 'boolean' ? override : mode === 'expanded' ? true : mode === 'collapsed' ? false : frames <= AUTO_MAX)
/** The same for a group of `count` files: in 'auto' it starts expanded at GROUP_OPEN_MAX files or fewer. */
export const groupExpandedOf = (mode, override, count) => (typeof override === 'boolean' ? override : mode === 'expanded' ? true : mode === 'collapsed' ? false : count <= GROUP_OPEN_MAX)

const readMode = () => { try { const v = globalThis.localStorage?.getItem(KEY); return v === 'expanded' || v === 'collapsed' ? v : 'auto' } catch { return 'auto' } }
const writeMode = (m) => { try { if (m === 'auto') globalThis.localStorage?.removeItem(KEY); else globalThis.localStorage?.setItem(KEY, m) } catch { /* private window or blocked storage: the choice just lasts this window */ } }
const readTemp = () => { try { return globalThis.localStorage?.getItem(TEMP_KEY) === '1' } catch { return false } }
const writeTemp = (on) => { try { if (on) globalThis.localStorage?.setItem(TEMP_KEY, '1'); else globalThis.localStorage?.removeItem(TEMP_KEY) } catch { /* the choice just lasts this window */ } }

const readIncomplete = () => { try { return globalThis.localStorage?.getItem(INCOMPLETE_KEY) === '1' } catch { return false } }
const writeIncomplete = (on) => { try { if (on) globalThis.localStorage?.setItem(INCOMPLETE_KEY, '1'); else globalThis.localStorage?.removeItem(INCOMPLETE_KEY) } catch { /* the choice just lasts this window */ } }

export const dpxView = reactive({ mode: readMode(), override: {}, pages: {}, all: {} })
export const isExpanded = (tile) => expandedOf(dpxView.mode, dpxView.override[tile.key], tile.frames?.length || 0)
export const toggleSeq = (tile) => { dpxView.override[tile.key] = !isExpanded(tile) }
/** Video, image, audio and temp-file groups share the mode and the Collapse All / Expand All buttons; each has its own override, page and Show All by key. `showTemp`: ComfyUI's temp files are hidden unless it is on. */
export const groupView = reactive({ override: {}, pages: {}, all: {}, showTemp: readTemp(), showIncomplete: readIncomplete() })
/** Collapse All / Expand All: the mode for every sequence and every group; every single choice, page and Show All is forgotten. */
export const setAll = (mode) => { dpxView.mode = mode; dpxView.override = {}; dpxView.pages = {}; dpxView.all = {}; groupView.override = {}; groupView.pages = {}; groupView.all = {}; writeMode(mode) }
export const setShowTemp = (on) => { groupView.showTemp = !!on; writeTemp(!!on) }
/** Incomplete sequences (short of the EDL's cut, utils/incomplete.js) are hidden unless Show Incomplete is on; display only. */
export const setShowIncomplete = (on) => { groupView.showIncomplete = !!on; writeIncomplete(!!on) }

export const pageOf = (tile) => dpxView.pages[tile.key] || 1
export const shownFrames = (tile) => { const f = tile.frames || []; return dpxView.all[tile.key] ? f : f.slice(0, pageOf(tile) * PAGE) }
export const showMore = (tile) => { dpxView.pages[tile.key] = pageOf(tile) + 1 }
export const showAll = (tile) => { dpxView.all[tile.key] = true }

export const groupExpanded = (g) => groupExpandedOf(dpxView.mode, groupView.override[g.key], g.count)
export const toggleGroup = (g) => { groupView.override[g.key] = !groupExpanded(g) }
/** How many rows a page of this group holds: 48 where the rows carry a preview (videos, images), 200 where they do not (audio, data, other, temp). */
export const groupPageSize = (g) => (g.kind === 'fgroup' && ['video', 'image'].includes(g.cat) ? PAGE_MEDIA : PAGE)
export const groupPage = (g) => groupView.pages[g.key] || 1
export const shownFiles = (g) => { const f = g.files || []; return groupView.all[g.key] ? f : f.slice(0, groupPage(g) * groupPageSize(g)) }
export const groupMore = (g) => { groupView.pages[g.key] = groupPage(g) + 1 }
export const groupShowAll = (g) => { groupView.all[g.key] = true }
