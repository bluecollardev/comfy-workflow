import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { importsAPI } from '../api/imports'
import { errorText, useToastStore } from './toast'
import { t } from '../i18n'

/**
 * The Connect › Import tab (docs/ADR-008): the adapters, a folder, the plan an adapter made for it, and what
 * applying it did. Nothing is written until Import; Dry run shows what would happen first.
 */
export const useImportsStore = defineStore('imports', () => {
  const toast = useToastStore()
  const adapters = ref([])
  const folder = ref('')
  const adapter = ref('')        // '' = the best approved match
  const plan = ref(null)
  const result = ref(null)       // the last apply (dry or real)
  const overwrite = ref(false)
  const planning = ref(false)
  const applying = ref(false)
  const error = ref(null)
  const preview = ref(null)      // what "Write an adapter with Claude" would send, shown before anything is sent
  const drafting = ref(false)
  const reading = ref(null)      // { id, sha256, text } while an adapter's source is open for approval

  const needsApproval = computed(() => adapters.value.filter((a) => !a.builtin && !a.approved))

  async function loadAdapters() {
    try { adapters.value = (await importsAPI.adapters()) || [] } catch (e) { error.value = errorText(e) }
  }

  async function makePlan() {
    if (!folder.value) return
    planning.value = true; error.value = null; plan.value = null; result.value = null
    try { plan.value = await importsAPI.plan(folder.value, adapter.value) } catch (e) { error.value = errorText(e) } finally { planning.value = false }
  }

  async function run(dryRun) {
    if (!plan.value) return
    applying.value = true; error.value = null
    try {
      result.value = await importsAPI.apply(plan.value, { dryRun, overwrite: overwrite.value })
      if (!dryRun) {
        if (result.value.ok) toast.success(t('import.toastDone', { n: (result.value.counts.copied || 0) + (result.value.counts.replaced || 0) + (result.value.counts.linked || 0) }))
        else toast.info(t('import.toastProblems'))
      }
    } catch (e) { error.value = errorText(e) } finally { applying.value = false }
  }

  async function read(id) {
    try { reading.value = await importsAPI.source(id) } catch (e) { error.value = errorText(e) }
  }
  async function approve(id) {
    try { await importsAPI.approve(id); reading.value = null; toast.success(t('import.toastApproved', { id })); await loadAdapters() } catch (e) { error.value = errorText(e) }
  }

  async function previewDraft() {
    if (!folder.value) return
    error.value = null
    try { preview.value = await importsAPI.draftPreview(folder.value) } catch (e) { error.value = errorText(e) }
  }
  /** Send the previewed material to Claude; the reply is saved as an unapproved adapter and opened for reading. */
  async function sendDraft() {
    drafting.value = true; error.value = null
    try {
      const r = await importsAPI.draft(folder.value)
      preview.value = null
      toast.success(t('import.toastDrafted', { id: r.adapter.id }))
      await loadAdapters()
      await read(r.adapter.id)
    } catch (e) { error.value = errorText(e); preview.value = null } finally { drafting.value = false }
  }

  return { preview, drafting, previewDraft, sendDraft, adapters, folder, adapter, plan, result, overwrite, planning, applying, error, reading, needsApproval, loadAdapters, makePlan, run, read, approve }
})
