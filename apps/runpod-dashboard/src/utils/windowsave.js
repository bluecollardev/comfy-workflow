import { computed, inject, onBeforeUnmount, provide, ref, shallowReactive, watch } from 'vue'

/** One Save for a whole window: each section registers what is unsaved and how to write it; the window's footer button runs them one after another (they share one configuration file). */
const KEY = Symbol('window-save')

export function provideWindowSave() {
  const parts = shallowReactive(new Set()), saving = ref(false), saved = ref(false), failed = ref(false)
  const register = (isDirty, save) => { const p = { isDirty, save }; parts.add(p); return () => parts.delete(p) }
  const dirty = computed(() => [...parts].some((p) => p.isDirty()))
  watch(dirty, (v) => { if (v) saved.value = false; else failed.value = false })
  async function saveAll() {
    saving.value = true; saved.value = false; failed.value = false
    try {
      for (const p of [...parts]) if (p.isDirty() && !(await p.save())) failed.value = true
      saved.value = !failed.value
    } finally { saving.value = false }
  }
  const reset = () => { saved.value = false; failed.value = false }
  provide(KEY, register)
  return { register, dirty, saving, saved, failed, saveAll, reset }
}

/** In a section of that window: `isDirty()` says whether it has unsaved edits, `save()` resolves true once written (false: it shows why itself). */
export function useWindowSave(isDirty, save) {
  const register = inject(KEY, null)
  if (register) onBeforeUnmount(register(isDirty, save))
}
