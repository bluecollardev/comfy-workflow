import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

// Cross-component UI state: which global modals are open, and a counter the
// Repositories pane bumps so other views re-fetch the attached list.
// Accounts and Repositories live in one Connect modal (third-party things to connect):
// `accountsOpen` / `repositoriesOpen` open it on that tab, so callers read as before.
export const useUiStore = defineStore('ui', () => {
  const connectOpen = ref(false)
  const connectTab = ref('accounts')   // 'accounts' | 'repositories'
  const repositoriesVersion = ref(0)
  const configOpen = ref(false)
  const volumesOpen = ref(false)
  // Help: the hints under the form's group headings, off by default; a per-viewer choice remembered in this browser.
  const hints = ref(false)
  try { hints.value = localStorage.getItem('runpod-manager.hints') === 'on' } catch { /* storage blocked: hints off */ }
  watch(hints, (v) => { try { localStorage.setItem('runpod-manager.hints', v ? 'on' : 'off') } catch { /* storage blocked */ } })
  const accountsOpen = computed({ get: () => connectOpen.value && connectTab.value === 'accounts', set: (v) => { if (v) connectTab.value = 'accounts'; connectOpen.value = v } })
  const repositoriesOpen = computed({ get: () => connectOpen.value && connectTab.value === 'repositories', set: (v) => { if (v) connectTab.value = 'repositories'; connectOpen.value = v } })
  return { connectOpen, connectTab, accountsOpen, repositoriesOpen, repositoriesVersion, configOpen, volumesOpen, hints }
})
