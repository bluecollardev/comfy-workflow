import { usePodsStore } from '../stores/pods'
import { useUiStore } from '../stores/ui'
import { useToastStore } from '../stores/toast'
import { volumesAPI } from '../api/volumes'
import { t } from '../i18n'

/** The Sync window is a network volume's (docs/ADR-067): a pod's card, the Auto sync banner and the Queue open it for the volume this pod is on. */
export async function openSyncForPod(podId) {
  const ui = useUiStore(), pod = usePodsStore().pods.find((p) => p.id === podId)
  let vol = pod?.volume_id ? { id: pod.volume_id, name: pod.volume_name || pod.volume_id } : null
  if (!vol) { try { const v = (await volumesAPI.list() || []).find((x) => (x.pods || []).some((p) => p.id === podId)); if (v) vol = { id: v.id, name: v.name } } catch { /* said below */ } }
  if (!vol) { useToastStore().error(t('syncTargets.noVolumeForPod', { name: pod?.name || podId })); return }
  ui.syncFor = { volumeId: vol.id, volumeName: vol.name }
}
