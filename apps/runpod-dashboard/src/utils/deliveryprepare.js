/** Prepare For Delivery settings (ADR-055 section 12): the Default Configuration's `delivery_prepare` block, as the window edits and reads it. The core owns the validation; this fills, compares and shapes. */
export const DELIVERY_DEFAULTS = Object.freeze({ out_dir: '_delivery_v11', colour_code: 'user-defined', gamma: 2.6, fps_source: 'clip-name', fps: 23.976, timecode_source: 'edl', frame_position: 'set', skip_existing: false })
export const COLOUR_CODES = ['user-defined', 'linear'], FPS_SOURCES = ['clip-name', 'fixed'], TC_SOURCES = ['edl', 'zero'], FRAME_POSITIONS = ['set', 'keep']
/** The block with every field present: what the stored one says, the defaults for the rest (an older configuration has no block). */
export const deliveryFill = (o) => ({ ...DELIVERY_DEFAULTS, ...(o && typeof o === 'object' && !Array.isArray(o) ? o : {}) })
/** True when every field is the default: an untouched block is not added to what a save sends. */
export const deliveryIsDefault = (o) => { const f = deliveryFill(o); return Object.keys(DELIVERY_DEFAULTS).every((k) => f[k] === DELIVERY_DEFAULTS[k]) }
/** What a save sends: numbers as numbers, the folder trimmed. */
export const deliveryBody = (o) => { const f = deliveryFill(o); return { out_dir: String(f.out_dir ?? '').trim(), colour_code: f.colour_code, gamma: Number(f.gamma), fps_source: f.fps_source, fps: Number(f.fps), timecode_source: f.timecode_source, frame_position: f.frame_position, skip_existing: !!f.skip_existing } }
/** The frame rate a clip is delivered at under these settings: always `fps` when fixed, else 24 for a `_24_` clip name and `fps` for the rest. */
export const deliveryFps = (o, clip) => { const f = deliveryFill(o); return f.fps_source === 'fixed' ? Number(f.fps) : /_24_/.test(clip || '') ? 24 : Number(f.fps) }
/** The start timecode under these settings: zero when they say so, else the EDL's (or zero when it gave none). */
export const deliveryTc = (o, edlTc) => (deliveryFill(o).timecode_source === 'zero' ? '00:00:00:00' : edlTc || '00:00:00:00')
