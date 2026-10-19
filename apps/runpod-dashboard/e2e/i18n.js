// The specs read text from the same language file the UI uses: `t('pod.stop')`, `t('pod.idleAfter', { n: 5 })`.
import en from '../src/locales/en.json' with { type: 'json' }

export function t(key, params = {}) {
  const value = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), en)
  if (typeof value !== 'string') throw new Error(`no language key ${key}`)
  return value.replace(/\{(\w+)\}/g, (_, k) => (k in params ? String(params[k]) : `{${k}}`))
}
