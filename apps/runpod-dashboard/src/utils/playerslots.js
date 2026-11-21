// A hard cap on the video players alive at once in a gallery. Chromium refuses more than a few dozen media players per page ("Blocked attempt to create a WebMediaPlayer as there are too many
// WebMediaPlayers already in existence", hundreds of them in the app log of 2026-11-21 07:56 UTC, from a gallery with a <video> per file). A tile asks for a slot when it is near the viewport and gives it
// back when it leaves; with none free it shows its icon and asks again when one is released.
import { reactive } from 'vue'

export const MAX_PLAYERS = 6
export const slots = reactive({ used: 0 })
export function acquire() { if (slots.used >= MAX_PLAYERS) return false; slots.used++; return true }
export function release() { if (slots.used > 0) slots.used-- }
