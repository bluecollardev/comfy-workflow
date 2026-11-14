<template>
  <ol class="stepper" :data-testid="`${testid}-steps`">
    <li v-for="(s, i) in steps" :key="i" class="stepper-item" :class="{ active: active === i + 1, done: s.done }" :data-done="!!s.done">
      <button type="button" class="stepper-btn" :class="{ blocked: s.blocked }" :title="s.blocked ? (s.why || '') : ''" :aria-current="active === i + 1 ? 'step' : undefined" :data-testid="`${testid}-step`" :data-step="i + 1" :data-active="active === i + 1" @click="$emit('go', i + 1)">
        <span class="stepper-dot"><i v-if="s.done" class="fa-solid fa-check"></i><template v-else>{{ i + 1 }}</template></span>
        <span class="stepper-label">{{ s.label }}</span>
      </button>
    </li>
  </ol>
</template>

<script setup>
/** StepperNav: the numbered steps of a wizard window (Import Round, Run). A finished step is green with a check; the active one is blue; each is a button (`blocked` steps are dimmed and say why). `go` carries the step number; the page decides whether it may go there. */
defineProps({ steps: { type: Array, required: true }, active: { type: Number, default: 1 }, testid: { type: String, default: 'wizard' } })
defineEmits(['go'])
</script>

<style scoped>
.stepper { display: flex; list-style: none; padding: 0 0 1.75rem; margin: 0 0 2rem; border-bottom: 1px solid rgba(255, 255, 255, 0.15); }
.stepper-item { flex: 1; position: relative; text-align: center; }
.stepper-item:not(:last-child)::after { content: ''; position: absolute; top: 15px; left: calc(50% + 22px); width: calc(100% - 44px); height: 2px; background: rgba(255, 255, 255, 0.2); }
.stepper-item.done:not(:last-child)::after { background: var(--bs-success); }
.stepper-btn { background: none; border: 0; padding: 0; color: var(--bs-secondary-color); display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; cursor: pointer; }
.stepper-btn.blocked { opacity: 0.55; }
.stepper-btn:hover .stepper-dot { border-color: #508cff; }
.stepper-btn:hover .stepper-label { text-decoration: underline; }
.stepper-dot { width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.3); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 0.85rem; background: transparent; }
.stepper-item.active:not(.done) .stepper-dot { border-color: #508cff; background: #508cff; color: #fff; box-shadow: 0 0 0 4px rgba(80, 140, 255, 0.25); }
.stepper-item.done .stepper-dot { border-color: var(--bs-success); background: var(--bs-success); color: #fff; }
.stepper-item.done.active .stepper-dot { box-shadow: 0 0 0 4px rgba(25, 135, 84, 0.3); }
.stepper-item.active .stepper-label { color: var(--bs-body-color); font-weight: 600; }
.stepper-item.done .stepper-label { color: var(--bs-body-color); }
.stepper-label { font-size: 0.85rem; }
</style>
