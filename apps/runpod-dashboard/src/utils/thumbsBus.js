import { reactive } from 'vue'
/** What the DPX sequence previews tell the Outputs modal: how many are waiting for a click (the automatic cap was reached) and a "Load all previews" tick the tiles watch. */
export const previewBus = reactive({ capped: 0, tick: 0, cacheVer: 0, loadAll: false, batch: false, batchTotal: 0, stopTick: 0, counts: { idle: 0, loading: 0, capped: 0, ready: 0, empty: 0, error: 0, nobase: 0 } })
/** `counts` is how many sequence tiles are in each state right now (each tile keeps it up to date); `batch` is true while "Generate all previews" runs, `batchTotal` how many it started with. */
/** `loadAll` stays true after "Load all previews" for as long as the Outputs modal is open: a tile that scrolls into view later loads at once instead of asking for another click. */
