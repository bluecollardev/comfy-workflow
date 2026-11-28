<template>
  <div v-if="apModel" class="mb-3" data-testid="bh-autopublish-options">
    <AutoPublishSettings v-model="apModel" :validate="apValidate" @changed="loadAp" />
    <div v-if="apError" class="text-danger small mt-1" data-testid="bh-autopublish-save-error">{{ apError }}</div>
  </div>
</template>

<script setup>
/** BhAutoPublish: Auto-publish (ADR-050), on the BH exchange row under Publishing, written by the window's one Save (its switch and Turn Off act at once). */
import { computed, onMounted, ref } from 'vue'
import AutoPublishSettings from './AutoPublishSettings.vue'
import { mountsAPI } from '../api/mounts'
import { apFill, settingsProblem as apProblem } from '../utils/autopublish'
import { errorText } from '../stores/toast'
import { useWindowSave } from '../utils/windowsave'

onMounted(loadAp)
// The Auto-publish options (docs/ADR-050, moved here from Default Configuration > Publishing): the configuration's auto_publish, edited in place and saved by putting the full loaded configuration back.
const apModel = ref(null), apValidate = ref(false), apError = ref('')
let apSnap = ''
const apDirty = computed(() => !!apModel.value && JSON.stringify(apModel.value) !== apSnap)
/** The same rule as the Default Configuration had: the approver's name travels only with rendering on a pod, and only when that is on. */
function apBody(apv) { const o = { ...apv }; if (!((o.generate?.enabled && (o.generate.where === 'pod' || o.generate.start_pod || o.generate.colour_in)) || o.require_review === false)) delete o.approved_by; return o }
async function loadAp() {
  try {
    const p = await mountsAPI.get()
    if (p?.config?.auto_publish) {
      const m = apFill(p.config.auto_publish)
      if (m.generate) m.approved_by = p.config.auto_publish.standing?.approved_by || (() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })()
      apModel.value = m; apSnap = JSON.stringify(m)
    }
  } catch { /* the block stays as it was */ }
}
async function saveAp() {
  apError.value = ''; apValidate.value = false
  if (apModel.value.enabled && apProblem(apModel.value)) { apValidate.value = true; return false }
  try {
    const cur = (await mountsAPI.get())?.config || {}   // never a partial put: the full loaded configuration with only auto_publish changed
    await mountsAPI.save({ ...cur, auto_publish: apBody(apModel.value) })
    await loadAp(); return true
  } catch (e) { apError.value = errorText(e); return false }
}
useWindowSave(() => apDirty.value, saveAp)
</script>
