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
  const adapter = ref('')        // '' = the best approved match
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
  const preview = ref(null)      // what "Write an adapter with Claude" would send, shown before anything is sent
  const drafting = ref(false)
  const reading = ref(null)      // { id, sha256, text } while an adapter's source is open for approval

  const needsApproval = computed(() => adapters.value.filter((a) => !a.builtin && !a.approved))

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
  // The draft loop: the person prompts, Claude writes, the app checks the module's structure; they read and approve it, test it on the
  // folder (the plan it returns is checked too), and prompt again with what was wrong, until both pass.
  const draft = ref(null)   // { id, valid, errors, tested: null | { ok, errors, summary }, model, round }
  const instruction = ref('')

  const draftProblems = () => [...(draft.value?.errors || []), ...(draft.value?.tested && !draft.value.tested.ok ? draft.value.tested.errors : [])]

  /** Send the previewed material and the person's prompt to Claude; the reply is saved as an unapproved adapter and checked. */
  async function sendDraft() {
    drafting.value = true; error.value = null
    const again = !!draft.value
    try {
      const r = await importsAPI.draft(folder.value, { instruction: instruction.value, ...(again ? { id: draft.value.id, errors: draftProblems() } : {}) })
      preview.value = null
      draft.value = { id: r.adapter.id, valid: r.valid, errors: r.errors, tested: null, model: r.model, round: (draft.value?.round || 0) + 1 }
      instruction.value = ''
      toast.success(t('import.toastDrafted', { id: r.adapter.id }))
      await loadAdapters()
    } catch (e) { error.value = errorText(e); preview.value = null } finally { drafting.value = false }
  }

  /** Run the draft on the attached folder (it must be approved first): its plan is checked against the required structure. */
  async function testDraft() {
    if (!draft.value) return
    testing.value = true; error.value = null
    try {
      const p = await importsAPI.plan(folder.value, draft.value.id)
      draft.value = { ...draft.value, tested: { ok: true, errors: [], summary: p.summary } }
      plan.value = p; result.value = null
    } catch (e) { draft.value = { ...draft.value, tested: { ok: false, errors: [errorText(e)], summary: null } } } finally { testing.value = false }
  }
  const testing = ref(false)
  const draftValid = computed(() => !!draft.value?.valid && !!draft.value?.tested?.ok)
  function dropDraft() { draft.value = null; instruction.value = '' }

  return { draft, instruction, testing, draftValid, testDraft, dropDraft, description, describing, describeError, describeOn, setDescribeOn, describeFolder, preview, drafting, previewDraft, sendDraft, adapters, folder, adapter, plan, result, overwrite, planning, applying, error, reading, needsApproval, loadAdapters, makePlan, run, read, approve }
})
