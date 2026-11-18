import { reactive } from 'vue'
/** What the DPX sequence previews tell the Outputs modal: how many are waiting for a click (the automatic cap was reached) and a "Load all previews" tick the tiles watch. */
export const previewBus = reactive({ capped: 0, tick: 0, cacheVer: 0, loadAll: false })
/** `loadAll` stays true after "Load all previews" for as long as the Outputs modal is open: a tile that scrolls into view later loads at once instead of asking for another click. */
