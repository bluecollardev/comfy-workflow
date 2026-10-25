import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { importsAPI } from '../api/imports'
import { syncAPI } from '../api/sync'
import { errorText, useToastStore } from './toast'
import { usePodsStore } from './pods'
import { useUiStore } from './ui'
import { t } from '../i18n'

/**
 * The Import Shot Pack modal (docs/ADR-008): the adapters, a folder, the plan an adapter made for it, and what
 * applying it did. Nothing is written until Import; Dry run shows what would happen first.
 */
export const useImportsStore = defineStore('imports', () => {
  const toast = useToastStore()
  const ui = useUiStore()
  const pods = usePodsStore()
  const adapters = ref([])
  const folder = ref('')
  const adapter = ref('')        // '' = the best match
  const plan = ref(null)
  const result = ref(null)       // the last apply (dry or real)
  const overwrite = ref(false)
  const planning = ref(false)
  const applying = ref(false)
  const error = ref(null)
  const description = ref(null)   // { description, model, sent } Claude wrote for the attached folder
  const describing = ref(false)
  const describeError = ref(null)
  const describeOn = ref(true)     // describe each newly attached folder when an Anthropic key is set; a per-viewer choice kept in this browser
  try { describeOn.value = localStorage.getItem('runpod-manager.import-describe') !== 'off' } catch { /* storage blocked: on */ }


  async function loadAdapters() {
    try { adapters.value = (await importsAPI.adapters()) || [] } catch (e) { error.value = errorText(e) }
  }

  function setDescribeOn(v) {
    describeOn.value = !!v
    try { localStorage.setItem('runpod-manager.import-describe', v ? 'on' : 'off') } catch { /* storage blocked */ }
  }

  /** Claude's description of the shot pack in the attached folder (its names, READMEs and manifests; docs/ADR-008). Never blocks the import. */
  async function describeFolder() {
    if (!folder.value) return
    describing.value = true; describeError.value = null; description.value = null
    const asked = folder.value
    try { const r = await importsAPI.describe(asked); if (asked === folder.value) description.value = r } catch (e) { if (asked === folder.value) describeError.value = errorText(e) } finally { describing.value = false }
  }

  /** Attach a folder: plan it, and when a key is set and the switch is on, have Claude describe it. */
  async function makePlan(claudeKeySet = false) {
    if (!folder.value) return
    planning.value = true; error.value = null; plan.value = null; result.value = null; description.value = null; describeError.value = null
    try { plan.value = await importsAPI.plan(folder.value, adapter.value) } catch (e) { error.value = errorText(e) } finally { planning.value = false }
    if (plan.value && claudeKeySet && describeOn.value) describeFolder()
  }

  async function run(dryRun) {
    if (!plan.value) return
    applying.value = true; error.value = null
    try {
      result.value = await importsAPI.apply(plan.value, { dryRun, overwrite: overwrite.value })
      if (!dryRun) {
        if (result.value.ok) {
          toast.success(t('import.toastDone', { n: (result.value.counts.copied || 0) + (result.value.counts.replaced || 0) + (result.value.counts.linked || 0) }))
          await syncToPod()
        } else toast.info(t('import.toastProblems'))
      }
    } catch (e) { error.value = errorText(e) } finally { applying.value = false }
  }

  /** The configuration toast: "Sync not configured. ... Click here to configure" opens Default Configuration. */
  const configureToast = (body) => toast.warn(body, t('import.syncNotConfigured'), { label: t('import.syncConfigure'), run: () => { ui.importOpen = false; ui.configOpen = true } })

  /** After a good import: sync ComfyUI-Shared to the pod whose card opened this, or say why not (a missing volume is a click away from fixed). */
  async function syncToPod() {
    const pod = ui.importPod
    const d = await importsAPI.syncAfter(pod?.id || null)
    if (d.action === 'skip') {
      if (d.why === 'no-volume') return configureToast(t('import.syncNoVolume'))
      if (d.why === 'simulated') return toast.info(t('import.syncSimulated', { name: pod.name }))
      return toast.info(t('import.syncNoPod'))
    }
    if (!syncAPI.available) return toast.info(t('import.syncInApp'))
    const plan = await syncAPI.plan(d.request)
    if (plan.transport.kind === 'none') return configureToast(t('import.syncNoTransport', { reason: plan.transport.reason || '' }))
    pods.syncStarted(pod.id, plan.steps.length)
    const r = await syncAPI.start(d.request)
    if (!r.ok) { pods.syncEnded(pod.id); return toast.info(t('import.syncBusy', { name: pod.name })) }
    toast.success(t('import.syncStarted', { name: pod.name }))
  }


  return { description, describing, describeError, describeOn, setDescribeOn, describeFolder, adapters, folder, adapter, plan, result, overwrite, planning, applying, error, loadAdapters, makePlan, run }
})
