import { createI18n } from 'vue-i18n'
import en from './locales/en.json'

// One language file (src/locales/en.json) is the source of every string the UI shows. Components
// use $t('key'), stores use the `t` exported here, and the Playwright specs resolve the same
// keys through e2e/i18n.js, so a wording change is one edit and a translation is one more file.
export const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages: { en } })
export const t = (key, params) => i18n.global.t(key, params)
export const te = (key) => i18n.global.te(key)
