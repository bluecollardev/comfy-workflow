import { defineStore } from 'pinia'
import { ref } from 'vue'

// Cross-component UI state: which global modals are open, and a counter the
// Repositories modal bumps so other views re-fetch the attached list.
export const useUiStore = defineStore('ui', () => {
  const accountsOpen = ref(false)
  const repositoriesOpen = ref(false)
  const repositoriesVersion = ref(0)
  const configOpen = ref(false)
  return { accountsOpen, repositoriesOpen, repositoriesVersion, configOpen }
})
