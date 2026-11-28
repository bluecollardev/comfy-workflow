<template>
  <BModal :model-value="modelValue" :title="volumeId ? $t('sync.title', { name: volumeName }) : $t('sync.titleBucket', { name: volumeName })" size="lg" lazy scrollable data-testid="sync-modal" :ok-title="okTitle" :ok-variant="okVariant" :ok-disabled="okDisabled" :cancel-title="started ? $t('sync.close') : $t('picker.cancel')" cancel-variant="outline-light" @ok="onOk" @update:model-value="emit('update:modelValue', $event)" @show="open">
    <template v-if="!syncAPI.available">
      <BAlert :model-value="true" variant="info" class="mb-0" data-testid="sync-unavailable"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('sync.unavailable') }}</BAlert>
    </template>
    <template v-else>
    <SyncRoute v-model:from="from" v-model:to="to" :locked="running || jobsCount > 0" :volume-id="volumeId" :volumes="lists.volumes" :pods="runningPods" :carry-pods="carryPods" @loaded="onLoaded" />
    <div v-if="bucketTargets.length" class="border rounded p-2 mb-3" data-testid="sync-run-on-block">
      <label class="form-label small fw-semibold mb-1" for="sync-run-on">{{ $t('syncTargets.runOn') }}</label>
      <select id="sync-run-on" v-model="runOn" class="form-select form-select-sm" style="max-width: 22rem" :disabled="running || jobsCount > 0" data-testid="sync-run-on">
        <option v-for="p in carryPods" :key="p.id" :value="p.id" data-testid="sync-run-on-option">{{ p.name }}</option>
      </select>
    </div>
    <template v-if="showPod && !started">
      <BAlert :model-value="true" variant="warning" data-testid="sync-confirm"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ $t('sync.confirm') }}</BAlert>
      <div class="mb-3">
        <BFormRadioGroup v-model="direction" :options="[{ value: 'push', text: $t('sync.push') }, { value: 'pull', text: $t('sync.pull') }]" button-variant="outline-light" size="sm" buttons data-testid="sync-direction" />
      </div>
      <div v-if="direction === 'push'" class="d-flex align-items-center gap-3 mb-2">
        <BFormCheckbox v-model="plates" switch data-testid="sync-plates">{{ $t('sync.plates') }}</BFormCheckbox>
        <BFormInput v-if="plates" v-model.trim="approvedBy" size="sm" style="max-width: 16rem" :placeholder="$t('sync.approvedBy')" data-testid="sync-approved-by" />
      </div>
      <div v-if="direction === 'push' && shared && plan.some((s) => s.key === 'comfy-shared')" class="mb-2" data-testid="sync-shared">
        <div class="small fw-semibold mb-1">{{ $t('sync.sharedTitle') }}</div>
        <div class="d-flex flex-wrap gap-3">
          <div v-for="d in SHARED" :key="d" class="form-check form-check-inline">
            <input :id="`sync-shared-${d}`" type="checkbox" class="form-check-input" :checked="(shared || []).includes(d)" :data-testid="`sync-shared-${d}`" @change="toggleShared(d, $event.target.checked)" />
            <label class="form-check-label" :for="`sync-shared-${d}`">{{ $t(`config.syncShared_${d}`) }}</label>
          </div>
        </div>
        <div class="form-text">{{ $t('sync.sharedHelp') }}</div>
      </div>
      <div v-if="direction === 'push' && plan.some((s) => s.key === 'project')" class="mb-2">
        <BFormCheckbox v-model="skipRenders" switch data-testid="sync-skip-renders">{{ $t('sync.skipRenders') }}</BFormCheckbox>
        <div class="form-text">{{ $t('sync.skipRendersHelp') }}</div>
        <BFormCheckbox v-model="skipTests" switch class="mt-2" data-testid="sync-skip-tests">{{ $t('sync.skipTests') }}</BFormCheckbox>
        <div class="form-text">{{ $t('sync.skipTestsHelp') }}</div>
      </div>
      <div v-if="direction === 'push' && folderSteps.length" class="mb-2 border rounded p-2" data-testid="sync-exclude">
        <div class="fw-semibold small mb-1">{{ $t('sync.leaveOut') }}</div>
        <div v-if="canalv2 && !isOut(canalv2.step, canalv2.name)" class="mb-2"><BButton size="sm" variant="outline-warning" data-testid="sync-exclude-canalv2" @click="tick(canalv2.step, canalv2.name, true)"><i class="fa-solid fa-ban me-1"></i>{{ $t('sync.leaveOutChip', { name: canalv2.name }) }}</BButton></div>
        <div v-for="st in folderSteps" :key="st.key" class="mb-2" data-testid="sync-exclude-step" :data-step="st.key">
          <div class="small text-body-secondary">{{ st.key }}</div>
          <div v-if="stepSaved(st.key).length" class="small mb-1" data-testid="sync-exclude-step-saved" :data-step="st.key"><span class="text-body-secondary">{{ $t('sync.stepSavedTitle', { step: st.key }) }}:</span> <span v-for="p in stepSaved(st.key)" :key="p" class="font-monospace me-2">{{ p }} <span class="badge text-bg-secondary">{{ $t('sync.savedTag') }}</span></span></div>
          <div class="d-flex flex-wrap gap-x-3 gap-y-1" style="column-gap: 1.25rem">
            <div v-for="f in st.folders" :key="f.name" class="d-flex align-items-center gap-1 small">
              <input :id="`sync-ex-${st.key}-${f.name}`" type="checkbox" class="form-check-input mt-0" :checked="isOut(st.key, f.name)" :disabled="isStepSaved(st.key, f.name)" data-testid="sync-exclude-folder" :data-step="st.key" :data-name="f.name" @change="tick(st.key, f.name, $event.target.checked)" />
              <label :for="`sync-ex-${st.key}-${f.name}`" class="mb-0 font-monospace">{{ f.name }}</label>
              <span v-if="f.link" class="text-body-secondary" data-testid="sync-exclude-link" :data-name="f.name" :title="f.target || ''"><i class="fa-solid fa-link me-1"></i><span class="badge text-bg-secondary">{{ $t('sync.linkTag') }}</span><span v-if="f.note" class="ms-1" data-testid="sync-exclude-link-note">{{ f.note }}</span></span>
              <span v-if="isStepSaved(st.key, f.name)" class="badge text-bg-secondary" data-testid="sync-exclude-saved">{{ $t('sync.savedTag') }}</span>
              <template v-if="meas[`${st.key}/${f.name}`]?.busy"><BSpinner small /><BButton variant="link" size="sm" class="p-0" data-testid="sync-measure-cancel" :data-name="f.name" @click="cancelMeasure(st.key, f.name)">{{ $t('sync.measureCancel') }}</BButton></template>
              <span v-else-if="meas[`${st.key}/${f.name}`]?.link" class="text-body-secondary" data-testid="sync-measure-link" :data-name="f.name">{{ $t('sync.measureLink', { target: meas[`${st.key}/${f.name}`].target || f.target || '' }) }}</span>
              <span v-else-if="meas[`${st.key}/${f.name}`]?.bytes != null" class="text-body-secondary" data-testid="sync-measure-size" :data-name="f.name">{{ formatBytes(meas[`${st.key}/${f.name}`].bytes) }}</span>
              <span v-else-if="meas[`${st.key}/${f.name}`]?.error" class="text-danger" data-testid="sync-measure-error">{{ $t('sync.measureFailed') }}</span>
              <BButton v-else variant="link" size="sm" class="p-0" data-testid="sync-measure" :data-step="st.key" :data-name="f.name" @click="measure(st.key, f.name)">{{ $t('sync.measure') }}</BButton>
            </div>
          </div>
        </div>
        <div class="d-flex gap-2 align-items-start mb-1">
          <div class="flex-grow-1" style="max-width: 22rem"><BFormInput v-model="newPattern" size="sm" class="font-monospace" :placeholder="$t('sync.patternPlaceholder')" data-testid="sync-exclude-add" @keydown.enter.prevent="addPattern" /><div v-if="patternError" class="text-danger small" data-testid="sync-exclude-error">{{ $t(`sync.${patternError}`) }}</div></div>
          <BButton size="sm" variant="outline-light" data-testid="sync-exclude-add-button" @click="addPattern">{{ $t('sync.patternAdd') }}</BButton>
        </div>
        <div v-if="savedPatterns.length || runPatterns.length" class="small mb-1" data-testid="sync-exclude-patterns">
          <div v-for="p in savedPatterns" :key="`s-${p}`" class="d-flex align-items-center gap-2" data-testid="sync-exclude-pattern" data-saved="true"><span class="font-monospace">{{ p }}</span><span class="badge text-bg-secondary">{{ $t('sync.savedTag') }}</span></div>
          <div v-for="p in runPatterns" :key="`r-${p}`" class="d-flex align-items-center gap-2" data-testid="sync-exclude-pattern" data-saved="false"><span class="font-monospace">{{ p }}</span><BButton variant="link" size="sm" class="p-0 text-danger" data-testid="sync-exclude-remove" :data-pattern="p" @click="removePattern(p)">{{ $t('sync.patternRemove') }}</BButton></div>
        </div>
        <div v-if="!deleteUnsupported" class="border-top pt-2 mt-2" data-testid="sync-exclude-delete-block">
          <BFormCheckbox v-model="delDelete" class="small" data-testid="sync-exclude-delete">{{ $t('sync.excludeDelete') }}</BFormCheckbox>
          <div class="form-text text-danger" data-testid="sync-exclude-delete-warning">{{ $t('sync.excludeDeleteWarn') }}</div>
          <div v-if="delDelete && delPreview !== null && !delPreview.length" class="small text-body-secondary mt-1" data-testid="sync-delete-nothing">{{ $t('sync.deleteNothing') }}</div>
          <div v-if="delDelete && delPreview && delPreview.length" class="border border-danger rounded p-2 mt-2 small" data-testid="sync-delete-preview">
            <div class="fw-semibold text-danger mb-1"><i class="fa-solid fa-trash me-1"></i>{{ $t('sync.deletePreviewTitle') }}</div>
            <div v-for="(w, i) in delPreview" :key="i" class="font-monospace text-break" data-testid="sync-delete-path">{{ $t('sync.deleteItem', { path: w.path, size: w.bytes == null ? $t('sync.sizeUnknown') : formatBytes(w.bytes) }) }}</div>
            <div class="mt-1" data-testid="sync-delete-total">{{ $t('sync.deleteTotal', { size: delTotal == null ? $t('sync.sizeUnknown') : formatBytes(delTotal) }) }}</div>
            <div class="d-flex align-items-center gap-2 mt-2 flex-wrap"><label class="mb-0" for="sync-delete-by">{{ $t('sync.deleteApprovedBy') }}</label><BFormInput id="sync-delete-by" v-model.trim="delApproved" size="sm" style="max-width: 16rem" data-testid="sync-delete-approved-by" /></div>
            <div v-if="!delApproved" class="text-warning" data-testid="sync-delete-approved-hint">{{ $t('sync.deleteNeedsName') }}</div>
            <BFormCheckbox v-model="delConfirm" class="mt-1" data-testid="sync-delete-confirm">{{ $t('sync.deleteConfirm') }}</BFormCheckbox>
          </div>
        </div>
        <BFormCheckbox v-model="remember" class="small mt-2" data-testid="sync-exclude-remember">{{ $t('sync.remember') }}</BFormCheckbox>
        <div class="form-text" data-testid="sync-exclude-help">{{ $t('sync.leaveOutHelp') }}</div>
        <div v-if="rememberError" class="text-danger small" data-testid="sync-exclude-remember-error">{{ rememberError }}</div>
      </div>
      <div v-if="transport.kind === 'ssh'" class="mb-2" data-testid="sync-existing">
        <div class="fw-semibold small mb-1">{{ $t('sync.existingTitle') }}</div>
        <div v-for="m in EXISTING" :key="m" class="form-check">
          <input :id="`sync-existing-${m}`" v-model="existing" type="radio" name="sync-existing" class="form-check-input" :value="m" :data-testid="`sync-existing-${m}`" />
          <label class="form-check-label" :for="`sync-existing-${m}`">{{ $t(`sync.existing_${m}`) }} <span class="form-text d-block mt-0">{{ $t(`sync.existingHelp_${m}`) }}</span></label>
        </div>
      </div>
      <div v-if="!planError && plan.length" class="small mb-2" data-testid="sync-plan-counts">
        <template v-if="counts.pending"><BSpinner small class="me-2 flex-shrink-0" />{{ $t('sync.counting') }}</template>
        <template v-else-if="counts.all.total_files != null">{{ $t(skipping ? 'sync.planCountsWithout' : 'sync.planCounts', { files: fmtN(shownCounts.total_files), bytes: formatBytes(shownCounts.total_bytes) }) }}</template>
        <template v-else>{{ $t('sync.noCount') }}</template>
      </div>
      <BAlert v-if="overCap" :model-value="true" variant="danger" class="small py-2" data-testid="sync-over-capacity"><i class="fa-solid fa-hard-drive me-2"></i>{{ $t(capSrc.free_bytes != null ? 'sync.overCapacity' : 'sync.overCapacityNoFree', { send: formatBytes(sendBytes), capacity: formatBytes(capSrc.capacity_bytes), free: formatBytes(capSrc.free_bytes) }) }}</BAlert>
      <BAlert v-else-if="lowSpace" :model-value="true" variant="warning" class="small py-2" data-testid="sync-low-space"><i class="fa-solid fa-hard-drive me-2"></i>{{ $t('sync.lowSpace', { left: formatBytes(capSrc.free_bytes - sendBytes) }) }}</BAlert>
      <div v-if="planError" class="text-danger small mb-2" data-testid="sync-plan-error">{{ planError }}</div>
      <BAlert :model-value="true" :variant="transport.kind === 'none' ? 'danger' : 'info'" class="small py-2" data-testid="sync-transport"><i :class="transport.kind === 'none' ? 'fa-solid fa-ban' : 'fa-solid fa-route'" class="me-2"></i>{{ transport.kind === 'none' ? transport.reason : $t('sync.transport', { how: transport.reason }) }}</BAlert>
      <CollapsibleSection v-if="!planError" id="sync-folders" :title="$t('sync.foldersTitle')" testid="sync-folders" :default-open="false">
        <template #badge><span class="badge text-bg-secondary fw-normal" data-testid="sync-folders-count">{{ $t(plan.length === 1 ? 'sync.foldersCountOne' : 'sync.foldersCount', { n: plan.length }) }}</span></template>
        <table class="table table-sm small mb-0" data-testid="sync-plan">
          <thead class="text-body-secondary"><tr><th>{{ $t('sync.folder') }}</th><th>{{ $t('sync.from') }}</th><th>{{ $t('sync.to') }}</th></tr></thead>
          <tbody>
            <tr v-for="s in plan" :key="s.key" data-testid="sync-step"><td>{{ s.key }}</td><td class="font-monospace text-break">{{ direction === 'push' ? s.local : s.remote }}</td><td class="font-monospace text-break">{{ direction === 'push' ? s.remote : s.local }}</td></tr>
            <tr v-if="!plan.length"><td colspan="3" class="text-body-secondary">{{ $t('sync.nothing') }}</td></tr>
          </tbody>
        </table>
      </CollapsibleSection>
    </template>
    <template v-else-if="showPod && started">
      <BAlert v-if="running" :model-value="true" variant="info" class="small py-2"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('sync.background') }}</BAlert>
      <div class="d-flex align-items-center gap-2 mb-2">
        <BSpinner v-if="running" small />
        <span data-testid="sync-status">{{ status }}</span>
      </div>
      <BProgress :value="progress.value" :max="100" height="8px" variant="warning" :striped="running || progress.indeterminate" :animated="running || progress.indeterminate" class="mb-2" data-testid="sync-bar" :data-indeterminate="progress.indeterminate ? 'true' : undefined" />
      <div v-if="detail" class="small text-body-secondary mb-2 text-break" data-testid="sync-detail">{{ detail }}</div>
      <div class="d-flex gap-3 small mb-2" data-testid="sync-counts">
        <span><i class="fa-solid fa-folder me-1"></i>{{ $t('sync.countSteps', { step: progress.step, steps: progress.steps }) }}</span>
        <span class="text-success"><i class="fa-solid fa-check me-1"></i>{{ $t('sync.countFiles', { n: fileCount }) }}</span>
        <span v-if="skippedCount != null" class="text-body-secondary" data-testid="sync-skipped"><i class="fa-solid fa-forward me-1"></i>{{ $t('sync.countSkipped', { n: fmtN(skippedCount) }) }}</span>
        <span :class="problems.length ? 'text-danger' : 'text-body-secondary'"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('sync.countErrors', { n: problems.length }) }}</span>
      </div>
      <BAlert v-if="fullError" :model-value="true" variant="danger" class="small py-2" data-testid="sync-volume-full" :data-code="fullError.code"><div class="fw-semibold"><i class="fa-solid fa-hard-drive me-2"></i>{{ $t(fullError.code === 'disk_full' ? 'sync.diskFullTitle' : 'sync.volumeFullTitle') }}</div><div data-testid="sync-volume-full-text">{{ fullError.text }}</div><div v-if="(fullError.not_done || []).length" class="mt-1" data-testid="sync-not-done">{{ $t('sync.notDone') }} <span v-for="k in fullError.not_done" :key="k" class="font-monospace me-2" data-testid="sync-not-done-step">{{ k }}</span></div></BAlert>
      <div v-if="deleteEvents.length" class="mb-2" data-testid="sync-deletes">
        <div v-for="(e, i) in deleteEvents" :key="i" class="small" :class="e.state === 'failed' ? 'text-danger' : e.state === 'removed' ? 'text-success' : 'text-body-secondary'" data-testid="sync-delete-event" :data-state="e.state"><i class="fa-solid me-1" :class="e.state === 'failed' ? 'fa-circle-xmark' : e.state === 'removed' ? 'fa-trash-can' : 'fa-spinner'"></i>{{ e.state === 'failed' ? $t('sync.deleteFailed', { path: e.path, error: e.text || '' }) : e.state === 'removed' ? (e.bytes == null ? $t('sync.deleteRemovedNoSize', { path: e.path }) : $t('sync.deleteRemoved', { path: e.path, size: formatBytes(e.bytes) })) : $t('sync.deleteRemoving', { path: e.path }) }}</div>
      </div>
      <div v-if="symlinks.length" class="mb-2" data-testid="sync-symlinks">
        <div class="small text-warning" data-testid="sync-symlink-count"><i class="fa-solid fa-link me-1"></i>{{ $t(symlinks.length === 1 ? 'sync.symlinkCountOne' : 'sync.symlinkCountMany', { n: symlinks.length }) }}</div>
        <template v-if="symlinks.length <= 3"><div v-for="(l, i) in symlinks" :key="i" class="small text-warning" data-testid="sync-symlink">{{ l.text || $t('sync.symlinkRow', { path: l.path, target: l.target }) }}</div></template>
        <details v-else data-testid="sync-symlink-group"><summary class="small text-warning">{{ $t('sync.linkTag') }} ({{ symlinks.length }})</summary><div v-for="(l, i) in symlinks" :key="i" class="small text-warning" data-testid="sync-symlink">{{ l.text || $t('sync.symlinkRow', { path: l.path, target: l.target }) }}</div></details>
      </div>
      <div v-if="skippedSteps.length" class="mb-2" data-testid="sync-steps">
        <div class="small fw-semibold mb-1">{{ $t('sync.stepsTitle') }}</div>
        <div v-for="(s, i) in skippedSteps" :key="i" class="small text-body-secondary" data-testid="sync-step-skipped" :data-key="s.key"><i class="fa-solid fa-forward me-1"></i>{{ s.reason ? $t('sync.stepSkipped', { key: s.key, reason: s.reason }) : $t('sync.stepSkippedNoReason', { key: s.key }) }}</div>
      </div>
      <div v-if="problems.length" class="mb-2" data-testid="sync-errors">
        <div class="small fw-semibold text-danger mb-1">{{ $t('sync.errors') }}</div>
        <div v-for="(e, i) in problems" :key="i" class="small text-danger font-monospace text-break">{{ e.key }}: {{ e.text }}</div>
      </div>
      <div class="small fw-semibold mb-1">{{ $t('sync.files') }}</div>
      <div ref="fileList" class="small font-monospace bg-body-tertiary rounded p-2 mb-2" style="max-height: 30vh; overflow: auto" data-testid="sync-files">
        <div v-for="f in files" :key="f.n" class="text-break" data-testid="sync-file"><i class="fa-solid fa-check text-success me-1"></i>{{ f.key }}/{{ f.path }}</div>
        <div v-if="!fileCount" class="text-body-secondary">{{ $t('sync.noFilesYet') }}</div>
      </div>
      <details>
        <summary class="small text-body-secondary">{{ $t('sync.rawOutput') }}</summary>
        <pre ref="out" class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="max-height: 40vh; overflow: auto; white-space: pre-wrap" data-testid="sync-output"><div v-for="l in lines" :key="l.n">{{ l.text }}</div></pre>
      </details>
    </template>
    <BAlert v-if="volumesError" :model-value="true" variant="warning" class="small py-2" data-testid="sync-volumes-error"><i class="fa-solid fa-triangle-exclamation me-2"></i>{{ volumesError }}</BAlert>
    <BAlert v-for="(m, i) in targetErrors" :key="`te-${i}`" :model-value="true" variant="danger" class="small py-2" data-testid="sync-target-start-error"><i class="fa-solid fa-circle-xmark me-2"></i>{{ m }}</BAlert>
    <template v-if="!jobsCount && opened">
      <template v-if="from.type === 'pod' && pod.id && !podRunShown">
        <SyncPlanCard v-for="id in to.storages" :key="`vs:${id}:${cardGen}`" kind="volumesync" :card-key="`vs:${id}`" :title="$t('syncTargets.storageTarget', { name: storageName(id) })" :request="{ volume_id: volumeId, storage_id: id, pod_id: pod.id }" @state="onCard(`vs:${id}`, $event)" />
      </template>
      <template v-if="runOn">
        <SyncPlanCard v-for="id in bucketTargets" :key="`${bsKey(id)}:${cardGen}`" kind="bucketsync" :card-key="bsKey(id)" :title="$t('syncTargets.bucketTarget', { name: storageName(id) })" :request="{ source: bucketSource, target: { storage_id: id }, run_on: { pod_id: runOn } }" @state="onCard(bsKey(id), $event)" />
      </template>
      <SyncPlanCard v-if="downloadOn" :key="`ss:${from.type}:${from.id}:${cardGen}`" kind="sourcesync" :card-key="`ss:${from.type}:${from.id}`" :title="$t('syncTargets.download', { name: sourceName })" :request="sourceRequest" :editable-dest="from.type === 'storage'" @state="onCard(`ss:${from.type}:${from.id}`, $event)" />
    </template>
    <SyncJobs ref="jobsRef" @running="jobsRunning = $event" @count="jobsCount = $event" />
    </template>
    <div v-if="pod.id" class="mt-3"><BButton size="sm" variant="outline-light" data-testid="sync-view-logs" @click="logsOpen = true"><i class="fa-solid fa-scroll me-1"></i>{{ $t('syncs.viewLogs') }}</BButton></div>
    <SyncLogsModal v-if="logsOpen" v-model="logsOpen" :pod-id="pod.id" :pod-name="pod.name" />
  </BModal>
</template>

<script setup>
/**
 * SyncModal — from a card's Sync button: a confirmation naming what will be copied, then the run with
 * rsync's output streamed from the main process. Push copies the folders mapped on this PC onto the
 * pod's volume (plates only with a named yes); Pull brings renders back. The run outlives this window:
 * reopening shows the job's state; the card shows it as an action in flight.
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { syncAPI } from '../api/sync'
import { usePodsStore } from '../stores/pods'
import { barValue, detailParts, fold, formatBytes, fresh } from '../sync-progress'
import { t } from '../i18n'
import SyncLogsModal from './SyncLogsModal.vue'
import SyncRoute from './SyncRoute.vue'
import SyncPlanCard from './SyncPlanCard.vue'
import SyncJobs from './SyncJobs.vue'
import CollapsibleSection from './CollapsibleSection.vue'
import { volumesAPI } from '../api/volumes'
import { volumesyncAPI } from '../api/volumesync'
import { sourcesyncAPI } from '../api/sourcesync'
import { bucketsyncAPI } from '../api/bucketsync'
import { useConfirmStore } from '../stores/confirm'
import { podsAPI } from '../api/pods'
import { mountsAPI } from '../api/mounts'
import { errorText } from '../stores/toast'
import { excludeProblem, listProblem, folderPattern, isCanalV2 } from '../utils/syncexclude'

const props = defineProps({ modelValue: Boolean, volumeId: { type: String, default: '' }, volumeName: { type: String, default: '' }, source: { type: Object, default: null } })
const emit = defineEmits(['update:modelValue'])
const pods = usePodsStore()

const direction = ref('push')
// From and To (docs/ADR-067): this pod to this PC is the window as it was; a storage ticked next to it adds a Storage target section; a volume or a storage as the source downloads to this PC.
const confirm = useConfirmStore()
const from = ref({ type: 'volume', id: props.volumeId })
const to = ref({ pc: true, storages: [], volumes: [] })
const lists = ref({ volumes: [], storages: [] }), volumesError = ref('')
const cards = ref({})              // card key -> { phase, plan_id, plan, ready }
const startedKeys = ref([])        // cards whose job started: their section gives way to the job
const targetErrors = ref([])
const jobsRef = ref(null), jobsRunning = ref(false), jobsCount = ref(0), cardGen = ref(0)
const opened = ref(false)             // From is settled (the pod or the volume): sections plan only after that
const podId = ref('')               // the running pod on this volume that a pod sync uses (the From's dropdown)
const pod = computed(() => pods.pods.find((p) => p.id === podId.value) || { id: '', name: '' })
/** The running pods on this volume that have SSH: the volume's own list (RunPod), else the pods that say they are on it. */
const runningPods = computed(() => {
  if (!props.volumeId) return []
  const onVol = new Set((lists.value.volumes.find((v) => v.id === props.volumeId)?.pods || []).map((p) => p.id))
  return pods.pods.filter((p) => p.status === 'running' && p.ssh_command && (onVol.has(p.id) || p.volume_id === props.volumeId))
})
/** Running pods with SSH, on any volume: one of them carries a bucket to bucket copy (Run On). */
const carryPods = computed(() => pods.pods.filter((p) => p.status === 'running' && p.ssh_command))
const runOn = ref('')
watch(carryPods, (l) => { if (!l.some((p) => p.id === runOn.value)) runOn.value = l[0]?.id || '' }, { immediate: true })
const bucketTargets = computed(() => (from.value.type !== 'pod' ? to.value.storages : []))   // bucket to bucket: a volume, a storage or the BH bucket to storages
const showPod = computed(() => from.value.type === 'pod' && to.value.pc && !!pod.value.id)
const podRunShown = computed(() => showPod.value && started.value)
const downloadOn = computed(() => from.value.type !== 'pod' && to.value.pc)
const storageName = (id) => (id === 'panama-s3' ? t('syncTargets.bhBucket') : lists.value.storages.find((s) => s.id === id)?.name || id)
const sourceName = computed(() => (from.value.type === 'volume' ? (lists.value.volumes.find((v) => v.id === from.value.id)?.name || from.value.id) : storageName(from.value.id)))
const bucketSource = computed(() => (from.value.type === 'volume' ? { type: 'volume', volume_id: from.value.id } : { type: 'storage', storage_id: from.value.id }))
const sourceRequest = computed(() => ({ source: from.value.type === 'volume' ? { type: 'volume', volume_id: from.value.id } : { type: 'storage', storage_id: from.value.id } }))
const onLoaded = (l) => { lists.value = { ...lists.value, storages: l.storages } }
watch(from, (f) => { if (f.type === 'pod') podId.value = f.id }, { deep: true })
function onCard(key, st) { if (st) cards.value = { ...cards.value, [key]: st }; else { const { [key]: _gone, ...rest } = cards.value; cards.value = rest } }
const bsKey = (id) => `bs:${from.value.type}:${from.value.id}:${id}`
const activeKeys = computed(() => new Set([...(from.value.type === 'pod' && pod.value.id ? to.value.storages.map((id) => `vs:${id}`) : []), ...(runOn.value ? bucketTargets.value.map(bsKey) : []), ...(downloadOn.value ? [`ss:${from.value.type}:${from.value.id}`] : [])]))
const openCards = computed(() => Object.entries(cards.value).filter(([k]) => activeKeys.value.has(k) && !startedKeys.value.includes(k)))
const readyCards = computed(() => openCards.value.filter(([, c]) => c.ready))
const anyListing = computed(() => openCards.value.some(([, c]) => c.phase === 'listing'))
const logsOpen = ref(false)   // the Sync logs window (docs/ADR-046)
const plates = ref(false)
const approvedBy = ref('')
const SHARED = ['input', 'models', 'output', 'workflows']
const shared = ref(null)   // the ComfyUI-Shared subfolders this run carries: this pod's own configuration, else the default's, until changed here
const EXISTING = ['update', 'size', 'checksum', 'replace']
const existing = ref('update')   // what to do with a file already on the pod; the default sends what differs in size or time (rsync's own check)
const skipTests = ref(true)   // Binc's 80_TEST-BUCKET stays home too
const skipRenders = ref(true)   // the shots' existing renders stay behind on a push; Pull brings renders back
const plan = ref([])
const transport = ref({ kind: 'none', reason: '' })
const planError = ref(null)
const counts = ref({ pending: false, all: {}, without_renders: undefined })   // from the listing passes: what the push would send, both ways
// the figure follows the switch: with the renders skipped, what the push sends without them (a pull, or no project step, has one figure)
const skipping = computed(() => (skipRenders.value || skipTests.value) && counts.value.without_renders?.total_files != null)
const shownCounts = computed(() => (skipping.value ? counts.value.without_renders : counts.value.all))
// files in scope that are already on the pod (or left out by the same rule): the listing's scope less what it would send
// Capacity (the core's listing pass): a push larger than the volume is refused before anything is copied; the window says so and keeps Start off.
const capSrc = computed(() => { const c = shownCounts.value || {}; return c.over_capacity !== undefined || c.capacity_bytes != null ? c : counts.value })
const sendBytes = computed(() => Number(shownCounts.value?.total_bytes) || 0)
const overCap = computed(() => direction.value === 'push' && !!capSrc.value.over_capacity)
const lowSpace = computed(() => { const c = capSrc.value; return direction.value === 'push' && !c.over_capacity && c.free_bytes != null && c.capacity_bytes > 0 && (c.free_bytes - sendBytes.value) / c.capacity_bytes < 0.05 })
const skippedCount = computed(() => { const c = shownCounts.value; return c?.scanned_files != null && c.total_files != null ? Math.max(0, c.scanned_files - c.total_files) : null })
const fmtN = (x) => Number(x).toLocaleString('en-US')
let countRun = 0
async function loadCounts() {
  const mine = ++countRun
  counts.value = { pending: true, all: {}, without_renders: undefined }
  try { const r = await syncAPI.count(request()); if (mine === countRun) counts.value = { pending: false, ...r } }
  catch { if (mine === countRun) counts.value = { pending: false, all: {}, without_renders: undefined } }
}
// Leave out (v1.5.0): folders and patterns a push never sends. The saved patterns (the pod's configuration, else the Default's) are always in force and listed; the ticks and patterns added here are this run's, sent as `exclude` on the count and the run.
const folderSteps = ref([])          // [{ key, local, folders: [{ name }] }] from the core; empty (the section hidden) on a core without it
const savedPatterns = ref([])
const runPatterns = ref([])          // this run's patterns, folder ticks included (as /name/)
const newPattern = ref(''), patternError = ref(''), remember = ref(false), rememberError = ref('')
const meas = ref({})                 // `${step}/${name}` -> { busy, bytes, error, id }
const isSaved = (p) => savedPatterns.value.includes(p)
const covers = (p, name) => p === `/${name}/` || p === `${name}/`
const stepSaved = (step) => (folderSteps.value.find((s) => s.key === step)?.saved || []).filter((p) => !savedPatterns.value.includes(p))   // per-folder defaults (the global ones are listed below)
const isStepSaved = (step, name) => isSaved(folderPattern(name)) || (folderSteps.value.find((s) => s.key === step)?.saved || []).some((p) => covers(p, name))
const isOut = (step, name) => isStepSaved(step, name) || runPatterns.value.includes(folderPattern(name))
const canalv2 = computed(() => { for (const st of folderSteps.value) { const f = st.folders.find((x) => isCanalV2(x.name)); if (f) return { step: st.key, name: f.name } } return null })
function tick(step, name, on) { const p = folderPattern(name); runPatterns.value = on ? (runPatterns.value.includes(p) ? runPatterns.value : [...runPatterns.value, p]) : runPatterns.value.filter((x) => x !== p) }
function addPattern() {
  const p = newPattern.value.trim(), bad = excludeProblem(p)
  if (bad) { patternError.value = bad; return }
  if (runPatterns.value.length + savedPatterns.value.length >= 100) { patternError.value = 'excludeMany'; return }
  patternError.value = ''
  if (!runPatterns.value.includes(p) && !isSaved(p)) runPatterns.value = [...runPatterns.value, p]
  newPattern.value = ''
}
const removePattern = (p) => { runPatterns.value = runPatterns.value.filter((x) => x !== p) }
let measureSeq = 0
async function measure(step, name) {
  const k = `${step}/${name}`, id = `m${++measureSeq}-${Date.now()}`
  meas.value = { ...meas.value, [k]: { busy: true, id } }
  try { const r = await syncAPI.measure({ pod_id: pod.value.id, step, name, id }); if (meas.value[k]?.id === id) meas.value = { ...meas.value, [k]: r?.link ? { link: true, target: r.target || '' } : { bytes: r?.bytes ?? 0 } } }
  catch { if (meas.value[k]?.id === id) { const { [k]: _gone, ...rest } = meas.value; meas.value = { ...rest, ...(meas.value[k]?.cancelled ? {} : { [k]: { error: true } }) } } }
}
function cancelMeasure(step, name) { const k = `${step}/${name}`, m = meas.value[k]; if (!m) return; syncAPI.measureCancel(m.id); const { [k]: _gone, ...rest } = meas.value; meas.value = rest }
async function loadFolders() {
  try { const r = await syncAPI.folders({ pod_id: pod.value.id }); folderSteps.value = (r.steps || []).filter((s) => (s.folders || []).length) } catch { folderSteps.value = [] }
}
async function loadSavedPatterns() {
  try {
    const own = await podsAPI.config(pod.value.id)
    const d = await mountsAPI.get(), own2 = own && Object.keys(own).length ? own : null
    savedPatterns.value = Array.isArray(own2?.sync_exclude) ? [...own2.sync_exclude] : own2 ? [] : Array.isArray(d?.config?.sync_exclude) ? [...d.config.sync_exclude] : []
    const sd = own2 && own2.sync_exclude_delete !== undefined ? own2.sync_exclude_delete : d?.config?.sync_exclude_delete
    savedDelete.value = !!sd; delDelete.value = !!sd
  } catch { savedPatterns.value = [] }
}
/** Remember for this pod: the pattern list goes into the pod's own configuration, the rest of it unchanged (the pod's, else the Default's as it is). */
async function rememberPatterns() {
  rememberError.value = ''
  try {
    const own = await podsAPI.config(pod.value.id)
    const base = own && Object.keys(own).length ? own : (await mountsAPI.get())?.config || {}   // (no own configuration: null, or empty)
    await podsAPI.setConfig(pod.value.id, { ...base, sync_exclude: [...new Set([...savedPatterns.value, ...runPatterns.value])], ...(delDelete.value || savedDelete.value ? { sync_exclude_delete: delDelete.value } : {}) })
    savedPatterns.value = [...new Set([...savedPatterns.value, ...runPatterns.value])]; runPatterns.value = []; savedDelete.value = delDelete.value
  } catch (e) { rememberError.value = t('sync.rememberFailed', { error: errorText(e) }) }
}
// Also remove from the volume (v1.5.0): what is already there and matches the left-out folders, deleted by the core's targeted removal (never rsync --delete-excluded). Needs a name and an explicit tick; never for a pull.
const delDelete = ref(false), delConfirm = ref(false), savedDelete = ref(false), deleteUnsupported = ref(false)
const delApproved = ref((() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })())
const delSrc = computed(() => { const c = shownCounts.value || {}; return c.would_delete !== undefined ? c : counts.value })
const delPreview = computed(() => (Array.isArray(delSrc.value.would_delete) ? delSrc.value.would_delete : null))
const delTotal = computed(() => (delSrc.value.would_delete_bytes !== undefined ? delSrc.value.would_delete_bytes : delPreview.value && delPreview.value.every((w) => w.bytes != null) ? delPreview.value.reduce((n, w) => n + w.bytes, 0) : null))
const deleting = computed(() => direction.value === 'push' && delDelete.value && !!delPreview.value?.length)
const symlinks = ref([])      // `symlink` warnings: a link in a push is copied as a link, not its contents
const deleteEvents = ref([])   // `delete` events of the run, one per path: removing -> removed or failed
const started = ref(false)   // a run is showing (in flight or finished): the confirmation gives way to it
const running = ref(false)
const out = ref(null)

// The run's events, folded as they arrive rather than kept and re-scanned: a push of the project tree is tens of
// thousands of lines, and filtering, reversing and joining them all again on every one froze the window.
const KEEP_FILES = 500, KEEP_LINES = 2000
const files = ref([])          // the last KEEP_FILES that landed, { n, key, path }
const fileCount = ref(0)
const problems = ref([])       // every rsync complaint, { key, text }
const lines = ref([])          // the raw output's last KEEP_LINES, { n, text }
const last = ref(null)         // the latest step, result or error: what the status says
const fullError = ref(null)    // an error event with code volume_full or disk_full: a banner, not a generic failure
const skippedSteps = ref([])   // steps skipped with a warning (their local source is missing), { key, reason }
const local = ref(fresh())     // the progress state, when the store has none for this pod (a run started elsewhere)
let n = 0
function reset() { symlinks.value = []; deleteEvents.value = []; files.value = []; fileCount.value = 0; problems.value = []; lines.value = []; last.value = null; fullError.value = null; skippedSteps.value = []; local.value = fresh(); n = 0 }
let scrollQueued = false
function ingest(ev) {
  if (ev.kind === 'result') { last.value = ev; running.value = false; pods.syncEnded(pod.value.id); return }
  if (ev.kind === 'skipped' || ((ev.kind === 'warning' || ev.kind === 'problem') && (ev.code === 'skipped' || ev.skipped))) {   // a step whose local source is missing: shown grey with its reason, not counted as an error
    skippedSteps.value.push({ key: ev.key || '', reason: ev.reason || ev.text || '' })
    if (ev.text != null) { lines.value.push({ n: ++n, text: ev.text }); if (lines.value.length > KEEP_LINES) lines.value.shift() }
    return
  }
  if (ev.kind === 'warning' && ev.code === 'symlink') {   // amber, listed and counted; not an error
    symlinks.value.push({ key: ev.key || '', path: ev.path || '', target: ev.target || '', text: ev.text || '' })
    if (ev.text != null) { lines.value.push({ n: ++n, text: ev.text }); if (lines.value.length > KEEP_LINES) lines.value.shift() }
    return
  }
  if (ev.kind === 'delete') {   // the targeted removal before any copy: one row per path
    const i = deleteEvents.value.findIndex((e) => e.path === ev.path)
    if (i >= 0) deleteEvents.value[i] = { ...ev }; else deleteEvents.value.push({ ...ev })
    if (ev.text != null) { lines.value.push({ n: ++n, text: ev.text }); if (lines.value.length > KEEP_LINES) lines.value.shift() }
    return
  }
  fold(local.value, ev)
  if (ev.kind === 'error' && (ev.code === 'volume_full' || ev.code === 'disk_full')) fullError.value = ev
  if (ev.kind === 'step' || ev.kind === 'listing' || ev.kind === 'error') last.value = ev
  if (ev.kind === 'error') { running.value = false; pods.syncEnded(pod.value.id) }
  if (ev.kind === 'file') { fileCount.value += 1; files.value.push({ n: ++n, key: ev.key, path: ev.path }); if (files.value.length > KEEP_FILES) files.value.shift() }
  if (ev.kind === 'problem' || ev.kind === 'error') problems.value.push({ key: ev.key, text: ev.text })
  const text = ev.kind === 'listing' ? `== listing ${ev.key}` : ev.kind === 'step' ? `== ${ev.key}: ${ev.local} -> ${ev.remote}` : ev.kind === 'step-done' ? `== ${ev.key}: ${ev.code === 0 ? 'done' : 'exit ' + ev.code}` : ev.text
  if (text != null) { lines.value.push({ n: ++n, text }); if (lines.value.length > KEEP_LINES) lines.value.shift() }
  if (!scrollQueued) { scrollQueued = true; nextTick(() => { scrollQueued = false; for (const el of [out.value, fileList.value]) if (el) el.scrollTop = el.scrollHeight }) }
}

const request = () => ({ pod_id: pod.value.id, direction: direction.value, plates: plates.value, approved_by: direction.value === 'push' && delDelete.value && delApproved.value ? delApproved.value : approvedBy.value, skip_renders: skipRenders.value, skip_tests: skipTests.value, existing: existing.value, ...(direction.value === 'push' && delDelete.value ? { delete_excluded: true } : {}), ...(runPatterns.value.length ? { exclude: [...runPatterns.value] } : {}), ...(shared.value ? { shared: [...shared.value] } : {}) })
async function loadPlan() {
  planError.value = null
  try { const r = await syncAPI.plan(request()); plan.value = r.steps; transport.value = r.transport; if (shared.value === null && r.shared) shared.value = [...r.shared] } catch (e) { plan.value = []; planError.value = e.message }
  if (plan.value.length && transport.value.kind !== 'none') loadCounts()
}
watch([direction, plates, approvedBy], loadPlan)
let excludeTimer = null
watch([skipRenders, skipTests, existing], () => { if (plan.value.length && transport.value.kind !== 'none') loadCounts() })
watch(delDelete, (on) => { delConfirm.value = false; if (plan.value.length && transport.value.kind !== 'none') loadCounts().then(() => { if (on && !counts.value.pending && delPreview.value === null) { deleteUnsupported.value = true; delDelete.value = false } }) })   // a core without the fields answers no would_delete: the option goes away quietly
watch(runPatterns, () => { clearTimeout(excludeTimer); excludeTimer = setTimeout(() => { if (plan.value.length && transport.value.kind !== 'none') loadCounts() }, 300) })   // each tick or pattern re-counts, debounced; a stale count is dropped (countRun)   // the figure is for the switches as set
watch(shared, (v, old) => { if (old) { loadPlan() } }, { deep: true })   // another set of folders is another plan and another count

let off = () => {}
let boundId = ''
/** Everything that belongs to the pod of a pod sync: its folders, plan, saved patterns, Auto sync switch and the run's events. Again when the From's pod changes. */
async function bindPod() {
  const id = pod.value.id
  if (!id || boundId === id) return
  boundId = id
  shared.value = null; runPatterns.value = []; meas.value = {}; remember.value = false; rememberError.value = ''; newPattern.value = ''; patternError.value = ''
  delDelete.value = false; delConfirm.value = false; deleteUnsupported.value = false; deleteEvents.value = []
  loadSavedPatterns(); loadFolders()
  await loadPlan()
  off()   // a second opening must not listen twice
  // Listen first, then ask for the job's state: everything the main process sent before it answered is in that
  // answer (one ordered channel), so the live events count only once the answer has been folded in.
  let primed = false
  off = syncAPI.onEvent((ev) => { if (ev.id === id && primed) ingest(ev) })
  const state = await syncAPI.state(id)
  reset(); for (const ev of state.events) ingest(ev)
  running.value = state.running; started.value = state.running || state.events.length > 0
  primed = true
}
watch(() => pod.value.id, () => bindPod())
async function open() {
  to.value = { pc: true, storages: [], volumes: [] }; startedKeys.value = []; targetErrors.value = []; cards.value = {}; jobsCount.value = 0; jobsRunning.value = false; cardGen.value++
  opened.value = false; boundId = ''; podId.value = ''; started.value = false; running.value = false; reset(); plan.value = []; planError.value = null
  volumesError.value = ''
  try { const v = await volumesAPI.list(); lists.value = { ...lists.value, volumes: Array.isArray(v) ? v : (v?.volumes || []) } } catch (e) { volumesError.value = errorText(e) }
  // From starts as the pod sync when a pod is running on the volume (today's window), else the volume over S3
  const first = runningPods.value[0]
  from.value = props.source ? { type: props.source.type, id: props.source.id } : first ? { type: 'pod', id: first.id } : { type: 'volume', id: props.volumeId }   // a bucket's own Sync button names its source
  podId.value = props.source ? '' : first?.id || ''
  opened.value = true
  await bindPod()
}
onUnmounted(() => { off(); clearTimeout(excludeTimer) })

async function start() {
  // clear and mark running before the call: a short (simulated) run sends every event before start() returns
  reset(); running.value = true; started.value = true
  pods.syncStarted(pod.value.id)
  const asked = request()
  if (asked.delete_excluded && delApproved.value) { try { localStorage.setItem('runpod-manager.approved-by', delApproved.value) } catch { /* storage blocked */ } }
  if (remember.value && (runPatterns.value.length || delDelete.value !== savedDelete.value)) await rememberPatterns()   // saved first; this run still sends them as its own
  const r = await syncAPI.start(asked)
  if (!r.ok) { running.value = false; started.value = false; pods.syncEnded(pod.value.id) }
}
const cancel = () => syncAPI.cancel(pod.value.id)
function again() { reset(); started.value = false; if (!jobsRunning.value) { jobsRef.value?.clear(); startedKeys.value = []; targetErrors.value = []; cardGen.value++ } }
// The modal's own footer (Lucas, 2026-10-21: the built-in buttons): OK starts the copy, then stops it, then offers another run; Cancel closes, the run goes on in the app.
// With a storage ticked or a volume or storage as the source, one Start starts the pod sync (if This PC is ticked) and every ready target; each is its own job below.
const jobsPhase = computed(() => !podRunShown.value && jobsCount.value > 0)
const okTitle = computed(() => (podRunShown.value ? (running.value ? t('sync.cancelRun') : t('sync.again')) : jobsPhase.value ? t('sync.again') : showPod.value && !to.value.storages.length ? (direction.value === 'push' ? t('sync.startPush') : t('sync.startPull')) : t('syncTargets.start')))
const okVariant = computed(() => (podRunShown.value ? (running.value ? 'outline-danger' : 'outline-light') : jobsPhase.value ? 'outline-light' : 'warning'))
const podOk = computed(() => plan.value.length && transport.value.kind !== 'none' && !(plates.value && !approvedBy.value) && !overCap.value && !(deleting.value && (!delApproved.value || !delConfirm.value)))
const okDisabled = computed(() => {
  if (podRunShown.value) return false
  if (jobsPhase.value) return jobsRunning.value
  if (showPod.value && !podOk.value) return true
  if (anyListing.value) return true
  return !(showPod.value || readyCards.value.length)
})
async function startTargets() {
  const ready = readyCards.value, vs = ready.filter(([k]) => k.startsWith('vs:') || k.startsWith('bs:'))
  if (vs.length) {   // the pod bills while it uploads: say the price and the estimates first (one confirmation for every pod-carried target)
    const first = vs[0][1].plan.pod, price = first?.cost_per_hr
    const est = vs.map(([, c]) => t('syncTargets.estimateItem', { name: c.plan.target?.name || c.plan.storage?.name || '', bytes: formatBytes(c.plan.to_copy.bytes), hours: c.plan.estimate?.hours ?? 0, usd: (c.plan.estimate?.usd ?? 0).toFixed(2) })).join('; ')
    const yes = await confirm.ask(price == null ? t('syncTargets.confirmNoPrice', { n: vs.length, pod: first?.name || '', estimates: est }) : t('syncTargets.confirm', { n: vs.length, pod: first?.name || '', price: price.toFixed(2), estimates: est }), { title: t('syncTargets.confirmTitle'), okLabel: t('syncTargets.start'), danger: false })
    if (!yes) return false
  }
  for (const [key, c] of ready) {
    const isVs = key.startsWith('vs:'), isBs = key.startsWith('bs:'), api = isBs ? bucketsyncAPI : isVs ? volumesyncAPI : sourcesyncAPI
    const name = isBs ? storageName(key.slice(key.lastIndexOf(':') + 1)) : isVs ? storageName(key.slice(3)) : sourceName.value
    try {
      const r = await api.start({ plan_id: c.plan_id })
      startedKeys.value = [...startedKeys.value, key]
      jobsRef.value?.add({ id: r.job_id, ns: isBs ? 'bucketsync' : isVs ? 'volumesync' : 'sourcesync', label: isVs || isBs ? t('syncTargets.jobTo', { name }) : t('syncTargets.jobToPc'), sub: isVs ? '' : t('syncTargets.jobFrom', { name: isBs ? sourceName.value : name }) })
    } catch (e) { targetErrors.value = [...targetErrors.value, `${name}: ${errorText(e)}`] }
  }
  return true
}
async function onStart() {
  targetErrors.value = []
  if (!(await startTargets())) return
  if (showPod.value) await start()
}
function onOk(e) { e.preventDefault(); if (podRunShown.value) { if (running.value) cancel(); else again() } else if (jobsPhase.value) again(); else onStart() }

const state = computed(() => pods.sync[pod.value.id] || local.value)
const progress = computed(() => { const p = state.value; const v = barValue(p); return { step: p.step, steps: p.steps, value: v ?? 100, indeterminate: v == null } })
/** The line under the bar: the file index, ok and errors, bytes, rate, time left, and the file under way. */
const detail = computed(() => {
  const p = state.value
  if (p.listing || !p.step) return ''
  const parts = detailParts(p, t)
  if (running.value && p.currentFile) parts.push(t('sync.currentFile', { path: p.currentFile, percent: p.filePercent ?? 0 }))
  return parts.join(' · ')
})
const fileList = ref(null)
const status = computed(() => {
  const l = last.value
  if (!l) return t('sync.starting')
  if (l.kind === 'listing') return t('sync.listing', { folder: l.key })
  if (l.kind === 'error') return l.code === 'volume_full' || l.code === 'disk_full' ? t(l.code === 'disk_full' ? 'sync.diskFullTitle' : 'sync.volumeFullTitle') : t('sync.failed', { error: l.text })
  if (l.kind === 'result') {
    const r = l.result
    return r.cancelled ? t('sync.cancelled') : r.failed ? t('sync.failedSteps', { failed: r.failed, steps: r.steps }) : r.warned ? t('sync.finishedWarnings', { steps: r.steps, warned: r.warned }) : t('sync.finished', { steps: r.steps })
  }
  return t('sync.copying', { folder: l.key })
})

function toggleShared(d, on) {
  const have = new Set(shared.value || [])
  if (on) have.add(d); else have.delete(d)
  shared.value = SHARED.filter((x) => have.has(x))
}
</script>
