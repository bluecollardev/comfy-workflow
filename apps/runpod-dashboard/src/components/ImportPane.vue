<template>
  <div data-testid="import-pane">
    <p class="text-body-secondary small">{{ $t('import.intro') }}</p>

    <BAlert v-if="store.error" :model-value="true" variant="danger" dismissible class="mb-3" data-testid="import-error" @update:model-value="store.error = null">{{ store.error }}</BAlert>

    <div class="small mb-3" data-testid="import-target">
      <span class="text-body-secondary">{{ $t('import.target') }}</span>
      <code v-if="target" class="ms-2" data-testid="import-target-path">{{ target }}</code>
      <span v-else class="ms-2 text-warning" data-testid="import-target-unmapped"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('import.targetUnmapped') }}</span>
    </div>

    <BRow class="g-2 align-items-end mb-2">
      <BCol md="8">
        <BFormGroup :label="$t('import.folder')" label-for="import-folder" class="mb-0">
          <div class="d-flex gap-1">
            <BFormInput id="import-folder" v-model.trim="store.folder" size="sm" class="font-monospace" :placeholder="$t('import.folderPlaceholder')" data-testid="import-folder" @keydown.enter.prevent="attach" />
            <BButton size="sm" variant="outline-light" class="text-nowrap" data-testid="import-browse" @click="picker = true"><i class="fa-regular fa-folder-open me-1"></i>{{ $t('import.browse') }}</BButton>
          </div>
        </BFormGroup>
      </BCol>
      <BCol md="4">
        <BFormGroup :label="$t('import.adapter')" label-for="import-adapter" class="mb-0">
          <BFormSelect id="import-adapter" v-model="store.adapter" :options="adapterOptions" size="sm" data-testid="import-adapter" />
        </BFormGroup>
      </BCol>
    </BRow>
    <BButton size="sm" variant="primary" :disabled="!store.folder || store.planning" data-testid="import-plan" @click="attach">
      <BSpinner v-if="store.planning" small class="me-1" /><i v-else class="fa-solid fa-list-check me-1"></i>{{ store.planning ? $t('import.planning') : $t('import.plan') }}
    </BButton>

    <BButton size="sm" variant="outline-light" class="ms-2" :disabled="!!store.folder === false && claudeSet" :title="claudeSet ? $t('import.claudeHint') : $t('import.claudeNoKey')" data-testid="import-claude" @click="claudeClick"><i class="fa-solid fa-wand-magic-sparkles me-1"></i>{{ $t('import.claude') }}</BButton>
    <div v-if="!claudeSet" class="small mt-2" data-testid="import-claude-nokey"><i class="fa-solid fa-key me-1 text-warning"></i>{{ $t('import.claudeNoKeyLine') }} <a href="#" class="fw-semibold" data-testid="import-claude-setkey" @click.prevent="openKey">{{ $t('import.claudeSetKey') }}</a></div>
    <div v-else-if="!store.folder" class="small text-body-secondary mt-2" data-testid="import-claude-needfolder">{{ $t('import.claudeNeedFolder') }}</div>

    <div v-if="store.draft" class="card mt-3" data-testid="import-draft" :data-valid="store.draftValid ? 'true' : 'false'">
      <div class="card-body small">
        <div class="d-flex align-items-center flex-wrap gap-2 mb-2">
          <strong>{{ $t('import.draftTitle') }}</strong> <code data-testid="import-draft-id">{{ store.draft.id }}</code>
          <span class="text-body-secondary">{{ $t('import.draftRound', { n: store.draft.round }) }}</span>
          <BBadge :variant="store.draft.valid ? 'success' : 'danger'" class="fw-normal" data-testid="import-draft-structure">{{ store.draft.valid ? $t('import.draftStructureOk') : $t('import.draftStructureBad') }}</BBadge>
          <BBadge :variant="store.draft.tested ? (store.draft.tested.ok ? 'success' : 'danger') : 'secondary'" class="fw-normal" data-testid="import-draft-tested">{{ store.draft.tested ? (store.draft.tested.ok ? $t('import.draftTestedOk') : $t('import.draftTestedBad')) : $t('import.draftNotTested') }}</BBadge>
          <BBadge v-if="store.draftValid" variant="success" data-testid="import-draft-valid">{{ $t('import.draftValid') }}</BBadge>
        </div>
        <div v-for="(e, i) in [...store.draft.errors, ...(store.draft.tested && !store.draft.tested.ok ? store.draft.tested.errors : [])]" :key="i" class="text-danger" data-testid="import-draft-error"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ e }}</div>
        <div v-if="store.draft.tested?.ok" class="text-body-secondary mb-1" data-testid="import-draft-plan">{{ $t('import.draftPlan', { n: store.draft.tested.summary.copies, size: size(store.draft.tested.summary.bytes) }) }}</div>
        <div class="d-flex flex-wrap gap-2 my-2">
          <BButton v-if="!draftApproved" size="sm" variant="outline-light" class="text-nowrap" data-testid="import-draft-read" @click="store.read(store.draft.id)"><i class="fa-solid fa-eye me-1"></i>{{ $t('import.read') }}</BButton>
          <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="!draftApproved || store.testing || !store.folder" :title="draftApproved ? $t('import.draftTestHint') : $t('import.draftTestNeedsApproval')" data-testid="import-draft-test" @click="store.testDraft()">
            <BSpinner v-if="store.testing" small class="me-1" /><i v-else class="fa-solid fa-flask me-1"></i>{{ $t('import.draftTest') }}
          </BButton>
          <BButton v-if="store.draftValid" size="sm" variant="primary" class="text-nowrap" data-testid="import-draft-use" @click="useDraft"><i class="fa-solid fa-check me-1"></i>{{ $t('import.draftUse') }}</BButton>
          <BButton size="sm" variant="link" class="text-nowrap ms-auto" data-testid="import-draft-drop" @click="store.dropDraft()">{{ $t('import.draftDrop') }}</BButton>
        </div>
        <BFormGroup :label="$t('import.draftPrompt')" label-for="import-draft-instruction" class="mb-1">
          <BFormTextarea id="import-draft-instruction" v-model="store.instruction" rows="2" :placeholder="$t('import.draftPromptPlaceholder')" data-testid="import-draft-instruction" />
        </BFormGroup>
        <BButton size="sm" variant="primary" :disabled="store.drafting || !claudeSet" data-testid="import-draft-rewrite" @click="store.sendDraft()">
          <BSpinner v-if="store.drafting" small class="me-1" /><i v-else class="fa-solid fa-wand-magic-sparkles me-1"></i>{{ store.drafting ? $t('import.claudeWriting') : $t('import.draftRewrite') }}
        </BButton>
        <span class="text-body-secondary ms-2">{{ $t('import.draftLoopHint') }}</span>
      </div>
    </div>

    <BFormCheckbox :model-value="store.describeOn" switch class="mt-3 small" :title="claudeSet ? $t('import.describeHint') : $t('import.claudeNoKey')" :disabled="!claudeSet" data-testid="import-describe-on" @update:model-value="store.setDescribeOn">{{ $t('import.describeOn') }}</BFormCheckbox>

    <div v-if="store.describing || store.description || store.describeError" class="card mt-2" data-testid="import-about">
      <div class="card-body small">
        <div class="d-flex align-items-center gap-2 mb-1">
          <strong>{{ $t('import.about') }}</strong>
          <BBadge variant="secondary" class="fw-normal" :title="$t('import.aboutBadgeHint')">{{ $t('import.aboutBadge') }}</BBadge>
          <BButton v-if="!store.describing" size="sm" variant="outline-light" class="ms-auto text-nowrap" data-testid="import-describe-again" @click="store.describeFolder()"><i class="fa-solid fa-rotate me-1"></i>{{ $t('import.describeAgain') }}</BButton>
        </div>
        <div v-if="store.describing" class="text-body-secondary" data-testid="import-about-loading"><BSpinner small class="me-2" />{{ $t('import.describing') }}</div>
        <p v-else-if="store.description" class="mb-1" data-testid="import-about-text">{{ store.description.description }}</p>
        <div v-else class="text-warning" data-testid="import-about-error"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('import.describeFailed', { error: store.describeError }) }}</div>
        <div v-if="store.description" class="text-body-secondary" data-testid="import-about-sent">{{ $t('import.describeSent', { files: store.description.sent.files, dirs: store.description.sent.dirs, texts: store.description.sent.texts.length, model: store.description.model }) }}</div>
      </div>
    </div>

    <div v-if="store.plan" class="card mt-3" data-testid="import-plan-card">
      <div class="card-body">
        <div class="d-flex align-items-center gap-2 mb-2">
          <strong data-testid="import-plan-title">{{ $t('import.planTitle', { name: store.plan.adapter.name }) }}</strong>
          <code class="small text-body-secondary" data-testid="import-plan-adapter">{{ store.plan.adapter.id }}</code>
          <BBadge :variant="store.plan.fenced ? 'success' : 'warning'" class="fw-normal" :title="store.plan.fenced ? $t('import.fencedHint') : $t('import.notFencedHint')" data-testid="import-fenced">{{ store.plan.fenced ? $t('import.fenced') : $t('import.notFenced') }}</BBadge>
        </div>
        <table class="table table-sm small mb-2" data-testid="import-kinds">
          <tbody>
            <tr v-for="(v, kind) in store.plan.summary.by_kind" :key="kind" data-testid="import-kind" :data-kind="kind">
              <td>{{ $t(`import.kinds.${kind}`) }}</td><td class="text-end">{{ $t('import.files', { n: v.files }) }}</td><td class="text-end">{{ size(v.bytes) }}</td>
            </tr>
          </tbody>
        </table>
        <div class="small text-body-secondary mb-2" data-testid="import-summary">
          {{ $t('import.toCopy', { n: store.plan.summary.copies, size: size(store.plan.summary.bytes) }) }} · {{ $t('import.leftInPlace', { n: store.plan.summary.notes }) }}
        </div>
        <div v-if="store.plan.findings.length" class="mb-2" data-testid="import-findings">
          <h6 class="small text-uppercase text-body-secondary mb-1">{{ $t('import.findings') }}</h6>
          <div v-for="(f, i) in store.plan.findings" :key="i" class="small" :class="f.level === 'problem' ? 'text-danger' : f.level === 'warn' ? 'text-warning' : 'text-body-secondary'" data-testid="import-finding" :data-level="f.level">
            <i class="fa-solid me-1" :class="f.level === 'info' ? 'fa-circle-info' : 'fa-triangle-exclamation'"></i>{{ f.text }}
          </div>
        </div>
        <div class="d-flex align-items-center flex-wrap gap-3">
          <BFormCheckbox v-model="store.overwrite" switch :title="$t('import.overwriteHint')" data-testid="import-overwrite">{{ $t('import.overwrite') }}</BFormCheckbox>
          <div class="ms-auto d-flex gap-2">
            <BButton size="sm" variant="outline-light" :disabled="store.applying" data-testid="import-dry" @click="store.run(true)">{{ $t('import.dryRun') }}</BButton>
            <BButton size="sm" variant="primary" :disabled="store.applying || !target" data-testid="import-run" @click="store.run(false)">
              <BSpinner v-if="store.applying" small class="me-1" />{{ store.applying ? $t('import.running') : $t('import.run') }}
            </BButton>
          </div>
        </div>
      </div>
    </div>

    <div v-if="store.result" class="card mt-3" data-testid="import-result" :data-ok="store.result.ok ? 'true' : 'false'" :data-dry="store.result.dry_run ? 'true' : 'false'">
      <div class="card-body small">
        <strong>{{ store.result.dry_run ? $t('import.resultDry') : $t('import.resultDone') }}</strong>
        <div class="d-flex flex-wrap gap-2 mt-2">
          <BBadge v-for="(n, k) in store.result.counts" :key="k" :variant="bad.includes(k) ? 'danger' : 'secondary'" class="fw-normal" :data-testid="`import-count-${k}`">{{ n }} {{ $t(`import.counts.${k}`) }}</BBadge>
        </div>
        <div v-if="problems.length" class="mt-2" data-testid="import-problems">
          <div class="text-uppercase text-body-secondary mb-1">{{ $t('import.problems') }}</div>
          <div v-for="p in problems" :key="p.i" class="text-danger" data-testid="import-problem">{{ p.detail || p.status }}</div>
        </div>
        <div v-if="store.result.record" class="text-body-secondary mt-2 font-monospace" data-testid="import-record">{{ $t('import.record', { path: store.result.record }) }}</div>
      </div>
    </div>

    <h6 class="mt-4 small text-uppercase text-body-secondary">{{ $t('import.adapters') }}</h6>
    <div v-for="a in store.adapters" :key="a.id" class="d-flex align-items-center gap-2 py-1 border-bottom" data-testid="import-adapter-row" :data-id="a.id">
      <div class="flex-grow-1 lh-sm"><span class="fw-semibold">{{ a.name }}</span> <code class="small text-body-secondary">{{ a.id }}</code>
        <small v-if="a.error" class="text-danger d-block">{{ a.error }}</small></div>
      <BBadge v-if="a.builtin" variant="secondary" class="fw-normal" data-testid="import-adapter-builtin">{{ $t('import.builtIn') }}</BBadge>
      <BBadge v-else :variant="a.approved ? 'success' : 'warning'" class="fw-normal" data-testid="import-adapter-state">{{ a.approved ? $t('import.approved') : $t('import.notApproved') }}</BBadge>
      <BButton v-if="!a.builtin && !a.approved" size="sm" variant="outline-light" class="text-nowrap" data-testid="import-adapter-read" @click="store.read(a.id)"><i class="fa-solid fa-eye me-1"></i>{{ $t('import.read') }}</BButton>
    </div>
    <div v-if="!store.adapters.some((a) => !a.builtin)" class="small text-body-secondary mt-2" data-testid="import-none">{{ $t('import.none') }}</div>

    <BModal :model-value="!!store.reading" :title="store.reading?.id" size="lg" scrollable lazy data-testid="import-source-modal" @update:model-value="(v) => { if (!v) store.reading = null }">
      <template v-if="store.reading">
        <BAlert :model-value="true" variant="info" class="small">{{ $t('import.approveHint') }}</BAlert>
        <pre class="small p-2 rounded border bg-body" style="max-height: 50vh; overflow: auto" data-testid="import-source">{{ store.reading.text }}</pre>
        <div class="small text-body-secondary font-monospace">{{ $t('import.sha', { sha: store.reading.sha256 }) }}</div>
      </template>
      <template #footer>
        <BButton variant="outline-light" size="sm" @click="store.reading = null">{{ $t('import.close') }}</BButton>
        <BButton variant="primary" size="sm" data-testid="import-approve" @click="store.approve(store.reading.id)">{{ $t('import.approve') }}</BButton>
      </template>
    </BModal>

    <BModal :model-value="!!store.preview" :title="$t('import.claudeTitle')" size="lg" scrollable lazy data-testid="import-claude-modal" @update:model-value="(v) => { if (!v) store.preview = null }">
      <template v-if="store.preview">
        <BAlert :model-value="true" variant="warning" class="small"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('import.claudeLeaves') }}</BAlert>
        <div class="small mb-2" data-testid="import-claude-counts">{{ $t('import.claudeSends', { files: store.preview.total_files, dirs: store.preview.dirs.length, texts: store.preview.texts.length }) }}</div>
        <div v-for="x in store.preview.texts" :key="x.path" class="small font-monospace" data-testid="import-claude-text">{{ x.path }} <span class="text-body-secondary">({{ $t('import.claudeBytes', { sent: x.sent_bytes, bytes: x.bytes }) }})</span></div>
        <BFormGroup :label="$t('import.draftPrompt')" label-for="import-claude-instruction" class="mt-2 mb-0">
          <BFormTextarea id="import-claude-instruction" v-model="store.instruction" rows="2" :placeholder="$t('import.draftPromptPlaceholder')" data-testid="import-claude-instruction" />
        </BFormGroup>
        <pre class="small p-2 mt-2 rounded border bg-body" style="max-height: 30vh; overflow: auto" data-testid="import-claude-dirs">{{ store.preview.dirs.map((d) => `${d.path}/  ${d.files}`).join('\n') }}</pre>
      </template>
      <template #footer>
        <BButton variant="outline-light" size="sm" @click="store.preview = null">{{ $t('import.cancel') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="store.drafting" data-testid="import-claude-send" @click="store.sendDraft()"><BSpinner v-if="store.drafting" small class="me-1" />{{ store.drafting ? $t('import.claudeWriting') : $t('import.claudeSend') }}</BButton>
      </template>
    </BModal>

    <FolderPicker v-model="picker" :title="$t('import.pickTitle')" :start="store.folder" memory-key="import" @choose="(p) => { store.folder = p; attach() }" />
  </div>
</template>

<script setup>
/**
 * ImportPane — inside the Import Shot Pack modal (docs/ADR-008, docs/IMPORT-ADAPTERS.md): pick a folder, let an adapter plan where its
 * files go in ComfyUI-Shared, read the plan (by kind, with findings), Dry run, then Import. Your own adapters are listed
 * with Read and approve; an unapproved or changed one never runs.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useImportsStore } from '../stores/imports'
import { useMountsStore } from '../stores/mounts'
import { useUiStore } from '../stores/ui'
import { useSettingsStore } from '../stores/settings'
import { t } from '../i18n'
import FolderPicker from './FolderPicker.vue'

const props = defineProps({ active: Boolean })
const store = useImportsStore()
const mounts = useMountsStore()
const ui = useUiStore()
const settingsStore = useSettingsStore()
const claudeSet = computed(() => !!settingsStore.keyInfo.anthropic_key_set)
const draftApproved = computed(() => !!store.adapters.find((a) => a.id === store.draft?.id)?.approved)
/** The draft passes: pick it for the folder and put the loop away. */
const useDraft = () => { store.adapter = store.draft.id; store.dropDraft(); store.makePlan(claudeSet.value) }
/** No key: the button takes you to the field for it (Default Configuration) instead of sitting there dead. */
const openKey = () => { ui.importOpen = false; ui.configOpen = true }
const claudeClick = () => { if (!claudeSet.value) openKey(); else if (store.folder) store.previewDraft() }
const attach = () => store.makePlan(claudeSet.value)   // plan the attached folder; Claude describes it when a key is set
const picker = ref(false)
const bad = ['conflict', 'hash-mismatch', 'error']

const target = computed(() => mounts.folders.find((f) => f.key === 'comfy-shared')?.local || '')
const adapterOptions = computed(() => [{ value: '', text: t('import.adapterAuto') }, ...store.adapters.filter((a) => a.approved).map((a) => ({ value: a.id, text: a.name }))])
const problems = computed(() => (store.result?.results || []).filter((r) => bad.includes(r.status)).slice(0, 20))
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)

// Lazy tab: the pane mounts when its tab is shown, so load on mount; the `active` watch covers a re-show without a remount.
const load = () => { store.loadAdapters(); settingsStore.load(); if (!mounts.config) mounts.load() }
onMounted(load)
watch(() => props.active, (on) => { if (on) load() })
watch(() => ui.importShown, load)   // the modal keeps the pane mounted while hidden: a file saved to the adapters folder meanwhile shows on the next open
</script>
