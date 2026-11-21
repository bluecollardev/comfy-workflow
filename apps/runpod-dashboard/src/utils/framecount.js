/** Does a DPX sequence tile hold the frame count the V11 EDL expects for its element? `match` is the EDL lookup answer ({ match, element? }), `frames` how many frames the tile has. null = nothing to say (not in the EDL, ambiguous, no count); otherwise { ok, frames, expected, diff }. */
export function frameCheck(match, frames) {
  const el = match && (match.match === 'exact' || match.match === 'shot-element') ? match.element : null
  const exp = el ? Number(el.frames_in_cut) : NaN
  if (!Number.isFinite(exp) || exp <= 0 || !Number.isFinite(frames) || frames <= 0) return null
  return { ok: frames === exp, frames, expected: exp, diff: frames - exp }
}
