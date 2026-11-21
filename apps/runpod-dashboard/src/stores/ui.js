import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

// Cross-component UI state: which global modals are open, and a counter the
// Repositories pane bumps so other views re-fetch the attached list.
// Accounts and Repositories live in one Connect modal (third-party things to connect):
// `accountsOpen` / `repositoriesOpen` open it on that tab, so callers read as before.
export const useUiStore = defineStore('ui', () => {
  const connectOpen = ref(false)
  const connectTab = ref('mcp')   // 'mcp' | 'slack' | 'repositories' (the Git accounts are on the Repositories tab; the old key 'accounts' is read as that)
  const importOpen = ref(false)   // the Import Shot Pack modal (docs/ADR-008), opened by the pod card's primary button
  const importPod = ref(null)     // { id, name } of the pod whose card opened it: where the import is synced afterwards
  const importSource = ref('')    // '' = ask (always), 'folder' or 'panama': the source of Import Shot Pack (docs/ADR-015)
  const importShown = ref(0)      // times it was shown: the pane stays mounted while hidden and reloads on it
  const repositoriesVersion = ref(0)
  const configOpen = ref(false)
  const welcomeOpen = ref(false)  // the one-time 'import a configuration file or start from scratch' question on a new installation (docs/ADR-023)
  const configFocus = ref('')     // a section of Default Configuration to scroll to when it opens ('adapters', 'claude', 'import')
  const volumesOpen = ref(false)
  const sharedOpen = ref(false)    // the Shared chooser: Volumes or Models (ADR-042)
  const modelsOpen = ref(false)    // the Models window: Hugging Face search, load onto the Shared volume
  const importRoundPreset = ref('')   // Import Round opens with this round chosen (re-import)
  const importRoundOpen = ref(false)  // Import Round (ADR-038)
  const runFlowsFor = ref(null)       // { pod_id } the Queue asks the pod's card to open its Run Workflows window (a render run's Open)
  const outputsFor = ref(null)        // { pod_id, play? } a window asks the pod's card to open its Outputs window (and the viewer on a sequence)
  const queueListLoaded = ref(false), queueListError = ref(''), queueRetry = ref(0)   // the Queue window's own first fetch (the banner under the nav bar reads them)
  const openPublish = ref(false)      // the pod's Outputs window opened by outputsFor opens its Publish window too
  const openFolder = ref('')          // the pod's Outputs window opened by outputsFor starts in this volume folder (deliver/<shot>/<vNNN>) in its folder scope; an Auto-publish row's View In Outputs sets it
  const QTAB_KEY = 'runpod-manager.queue-tab'
  const mapTab = (v) => (v === 'autopublish' ? 'publishing' : v || 'overview')   // Auto-publish lives under Publishing: an old remembered value or a deep link maps there
  const failureFocus = ref('')   // a failed job's link to its failure row
  const queueTab = ref((() => { try { return mapTab(localStorage.getItem(QTAB_KEY)) } catch { return 'overview' } })())   // the Queue window's tab: remembered; a link names its own
  watch(queueTab, (v) => { if (v === 'autopublish') { if (queueTab.value !== 'publishing') queueTab.value = 'publishing'; return } try { localStorage.setItem(QTAB_KEY, v) } catch { /* storage blocked */ } })
  const queueFocus = ref('')          // a section of the Queue to scroll to when it opens ('autopublish')
  const queueOpen = ref(false)        // the Queue window
  const queueStarting = ref([])       // rounds Import Round is queueing right now (the Queue says so while it reads and plans)
  const queueStartError = ref('')     // why the last import could not be queued
  const queueVersion = ref(0)         // bumped when an import was queued, so the open Queue reloads at once
  const historyOpen = ref(false)  // the History window: pod events, spend, jobs, ComfyUI runs
  const volumeDc = ref('')        // a datacenter the Volumes window preselects for a new volume (the pod form's "Create a volume in ...")
  // Help: the hints under the form's group headings, off by default; a per-viewer choice remembered in this browser.
  const hints = ref(false)
  try { hints.value = localStorage.getItem('runpod-manager.hints') === 'on' } catch { /* storage blocked: hints off */ }
  watch(hints, (v) => { try { localStorage.setItem('runpod-manager.hints', v ? 'on' : 'off') } catch { /* storage blocked */ } })
  watch(connectTab, (v) => { if (v === 'accounts') connectTab.value = 'repositories' })   // the old key
  const accountsOpen = computed({ get: () => connectOpen.value && connectTab.value === 'repositories', set: (v) => { if (v) connectTab.value = 'repositories'; connectOpen.value = v } })
  const repositoriesOpen = computed({ get: () => connectOpen.value && connectTab.value === 'repositories', set: (v) => { if (v) connectTab.value = 'repositories'; connectOpen.value = v } })
  return { failureFocus, queueTab, queueListLoaded, queueListError, queueRetry, openPublish, openFolder, queueFocus, outputsFor, runFlowsFor, connectOpen, importOpen, importPod, importSource, importShown, connectTab, accountsOpen, repositoriesOpen, repositoriesVersion, configOpen, welcomeOpen, configFocus, volumesOpen, sharedOpen, modelsOpen, importRoundOpen, importRoundPreset, queueOpen, queueStarting, queueStartError, queueVersion, historyOpen, volumeDc, hints }
})
