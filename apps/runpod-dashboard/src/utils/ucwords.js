/**
 * Title case for the status and log lines a job shows (the stored text is not changed): every plain word gets a capital letter,
 * names stay exactly as they are (a token with a digit, a capital inside, a hyphen, a slash, a dot or an underscore is a name or a path:
 * `ComfyUI-Pull-vol-a3upg9ey48-1115`, `vae/ae.safetensors`, `1.2`).
 */
export function ucwords(text) {
  return String(text ?? '').replace(/(^|\s)(\(?)([a-z][a-z'’]*)([:;,.!?)]*)(?=\s|$)/g, (_, pre, open, word, tail) => `${pre}${open}${word[0].toUpperCase()}${word.slice(1)}${tail}`)
}
