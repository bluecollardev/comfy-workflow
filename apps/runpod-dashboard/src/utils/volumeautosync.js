import { autosyncAPI } from '../api/autosync'
import { t } from '../i18n'

/**
 * A volume's Auto Sync as two tick boxes (docs/ADR-069 amendment): "On Change to This PC" (the pull flag: new outputs come down) and "On Change from This PC" (the push flag: my changes go up).
 * One setting, one name: `enabled` is on while either flag is. The same form is read on the volume's own row and on the This PC row.
 */
export const blankForm = () => ({ enabled: false, pull: false, push: false, approved_by: '', saving: false, saved: false, error: '' })
export function fillForm(form, s) {
  const x = s || {}
  form.enabled = !!x.enabled; form.pull = !!x.enabled && x.pull !== false; form.push = !!x.enabled && !!x.push
  form.approved_by = x.approved_by || (() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })()
}
export function setFlag(form, flag, on) {
  form.saved = false
  form[flag] = on
  form.enabled = form.pull || form.push
}
/** Save through autosync.setVolume; the name is required while either flag is on. Returns the saved settings, or null with form.error set. */
export async function saveForm(volumeId, form) {
  form.saved = false; form.error = ''
  if (form.enabled && !form.approved_by.trim()) { form.error = t('autosync.needName'); return null }
  form.saving = true
  try {
    const r = await autosyncAPI.setVolume(volumeId, { enabled: !!form.enabled, pull: !!form.pull, push: !!form.push, approved_by: form.approved_by.trim() })
    if (form.approved_by.trim()) { try { localStorage.setItem('runpod-manager.approved-by', form.approved_by.trim()) } catch { /* storage blocked */ } }
    form.saved = true
    return r
  } catch (e) { form.error = e?.response?.data?.detail || e?.message || String(e); return null } finally { form.saving = false }
}
