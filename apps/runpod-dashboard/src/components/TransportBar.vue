<template>
  <div class="transport" :data-testid="tid">
    <div class="scrub position-relative">
      <div class="buffered" aria-hidden="true"><span v-for="(b, i) in buffered" :key="i" :style="{ left: `${b[0] * 100}%`, width: `${(b[1] - b[0]) * 100}%` }"></span></div>
      <input type="range" class="form-range" :min="0" :max="max" :step="step" :value="pos" :disabled="max <= 0" :data-testid="`${tid}-slider`" :aria-label="$t('outputs.player.seek')" @input="$emit('scrub', Number($event.target.value))" />
    </div>
    <div class="d-flex align-items-center gap-2 flex-wrap small">
      <BButton variant="outline-light" size="sm" :data-testid="`${tid}-prev`" :disabled="atStart" :title="$t('outputs.player.stepBack')" @click="$emit('step', -1)"><i class="fa-solid fa-backward-step"></i></BButton>
      <BButton variant="primary" size="sm" :data-testid="`${tid}-play`" :data-playing="playing ? 'true' : 'false'" :disabled="!canPlay" :title="`${$t(playing ? 'outputs.player.pause' : 'outputs.player.play')} (Space)`" @click="$emit('toggle')"><i class="fa-solid" :class="playing ? 'fa-pause' : 'fa-play'"></i></BButton>
      <BButton variant="outline-light" size="sm" :data-testid="`${tid}-next`" :disabled="atEnd" :title="$t('outputs.player.stepForward')" @click="$emit('step', 1)"><i class="fa-solid fa-forward-step"></i></BButton>
      <span class="font-monospace text-body-secondary" :data-testid="`${tid}-frame`">{{ label }}</span>
      <span v-if="status" class="text-warning" :data-testid="`${tid}-status`">{{ status }}</span>
      <span class="ms-auto d-flex align-items-center gap-2 flex-wrap">
        <select v-if="speed !== null" class="form-select form-select-sm w-auto" :value="speed" :data-testid="`${tid}-speed`" :title="$t('outputs.player.speed')" @change="$emit('update:speed', Number($event.target.value))"><option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}x</option></select>
        <select class="form-select form-select-sm w-auto" :value="fps" :data-testid="`${tid}-fps`" :title="$t('outputs.player.fps')" @change="$emit('update:fps', Number($event.target.value))"><option v-for="f in FPS_OPTIONS" :key="f" :value="f">{{ f }} fps</option></select>
        <label class="form-check mb-0 d-flex align-items-center gap-1"><input type="checkbox" class="form-check-input mt-0" :checked="loop" :data-testid="`${tid}-loop`" @change="$emit('update:loop', $event.target.checked)" />{{ $t('outputs.player.loop') }}</label>
        <template v-if="volume !== null">
          <BButton variant="outline-light" size="sm" :data-testid="`${tid}-mute`" :title="$t('outputs.player.mute')" @click="$emit('update:muted', !muted)"><i class="fa-solid" :class="muted || volume === 0 ? 'fa-volume-xmark' : 'fa-volume-high'"></i></BButton>
          <input type="range" class="form-range vol" min="0" max="1" step="0.05" :value="muted ? 0 : volume" :data-testid="`${tid}-volume`" :aria-label="$t('outputs.player.volume')" @input="$emit('update:volume', Number($event.target.value))" />
        </template>
        <BButton v-if="fullscreen" variant="outline-light" size="sm" :data-testid="`${tid}-fullscreen`" :title="$t('outputs.player.fullscreen')" @click="$emit('fullscreen')"><i class="fa-solid fa-expand"></i></BButton>
      </span>
    </div>
  </div>
</template>

<script setup>
/**
 * TransportBar: the one transport UI of the Outputs viewers (video and DPX sequences): a scrubber (with the buffered ranges), step back, Play/Pause, step forward, a time or frame readout, an fps selector, Loop, and for video speed, mute/volume and fullscreen
 * (shown only when their value is given). Presentational: the viewer owns the state and handles the events. `tid` prefixes the test ids.
 */
import { FPS_OPTIONS, SPEEDS } from '../utils/timecode'

defineProps({
  tid: { type: String, required: true },
  playing: { type: Boolean, default: false }, canPlay: { type: Boolean, default: true },
  pos: { type: Number, default: 0 }, max: { type: Number, default: 0 }, step: { type: [Number, String], default: 1 },
  buffered: { type: Array, default: () => [] }, label: { type: String, default: '' }, status: { type: String, default: '' },
  fps: { type: Number, default: 24 }, loop: { type: Boolean, default: true },
  speed: { type: Number, default: null }, volume: { type: Number, default: null }, muted: { type: Boolean, default: false }, fullscreen: { type: Boolean, default: false },
  atStart: { type: Boolean, default: false }, atEnd: { type: Boolean, default: false },
})
defineEmits(['toggle', 'scrub', 'step', 'update:fps', 'update:loop', 'update:speed', 'update:volume', 'update:muted', 'fullscreen'])
</script>

<style scoped>
.transport { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem; }
.buffered { position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; background: rgba(255, 255, 255, 0.08); border-radius: 2px; pointer-events: none; }
.buffered span { position: absolute; top: 0; bottom: 0; background: rgba(80, 140, 255, 0.45); border-radius: 2px; }
.scrub .form-range { position: relative; background: transparent; }
.vol { width: 5rem; }
</style>
