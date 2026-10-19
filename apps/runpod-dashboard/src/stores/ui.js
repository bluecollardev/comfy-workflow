import { reactive } from 'vue'

// Cross-component UI state: which global modals are open, and a counter the
// Repositories modal bumps so other views re-fetch the attached list.
export const ui = reactive({
  accountsOpen: false,
  repositoriesOpen: false,
  repositoriesVersion: 0,
  configOpen: false,
  mountsVersion: 0,
})
