<template>
  <span v-if="review" class="approve-control d-inline-flex align-items-center gap-1" data-testid="autopublish-control" :data-shot="shot" :data-version="version" @click.stop>
    <template v-if="review.approved">
      <span class="badge text-bg-success fw-normal" data-testid="autopublish-approved">{{ $t('autopublish.approve.approvedBy', { name: review.approved.approved_by }) }}</span>
      <span role="button" tabindex="0" class="text-danger small" data-testid="autopublish-revoke" @click.stop="revoke" @keydown.enter.stop="revoke">{{ $t('autopublish.approve.revoke') }}</span>
    </template>
    <span v-else role="button" tabindex="0" class="badge text-bg-secondary fw-normal" data-testid="autopublish-approve" @click.stop="mark" @keydown.enter.stop="mark">{{ $t('autopublish.approve.mark') }}</span>
    <span v-if="err" class="text-danger small" data-testid="autopublish-approve-error">{{ err }}</span>
  </span>
</template>

<script setup>
/** ApproveControl: Mark approved / Approved by <name> with Revoke for one review version (docs/ADR-050 amendment). A person's yes with a name; Revoke asks first. Hidden when the core has no Auto-publish or does not know this version. */
import { computed, ref } from 'vue'
import { useAutopublishStore } from '../stores/autopublish'
import { useNamePromptStore } from '../stores/nameprompt'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { versionTag } from '../utils/autopublish'

const props = defineProps({ shot: { type: String, required: true }, version: { type: [Number, String], required: true } })
const ap = useAutopublishStore(), prompt = useNamePromptStore(), confirm = useConfirmStore()
const err = ref('')
const review = computed(() => (ap.old || !ap.requireApproval ? null : ap.reviewFor(props.shot, props.version)))   // no Approve unless approval is required (a core where every eligible review is published has Hold instead)
async function mark() {
  err.value = ''
  const r = await prompt.ask({ title: t('autopublish.approve.markTitle'), message: t('autopublish.approve.markMessage', { shot: props.shot, version: versionTag(props.version) }), okLabel: t('autopublish.approve.mark'), submit: async ({ name }) => { try { await ap.approve(props.shot, Number(props.version), name); return '' } catch (e) { return errorText(e) } } })
  void r
}
async function revoke() {
  err.value = ''
  if (!(await confirm.ask(t('autopublish.approve.revokeConfirm', { shot: props.shot, version: versionTag(props.version) }), { okLabel: t('autopublish.approve.revoke') }))) return
  try { await ap.revoke(props.shot, Number(props.version)) } catch (e) { err.value = errorText(e) }
}
</script>
