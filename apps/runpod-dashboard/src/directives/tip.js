// v-tip="'Label'": a tooltip that shows at once on hover or keyboard focus (the browser's own title tooltip waits about a second and is not shown in every window), styled like the app, above modals.
// The label is also the element's aria-label, so an icon-only button has a name for screen readers.
let box = null, timer = null
const ensure = () => { if (box) return box; box = document.createElement('div'); box.className = 'app-tip'; box.setAttribute('role', 'tooltip'); box.style.display = 'none'; document.body.appendChild(box); return box }
function hide() { clearTimeout(timer); if (box) box.style.display = 'none' }
function show(node) {
  const text = node.getAttribute('data-tip'); if (!text) return
  const b = ensure(); b.textContent = text; b.style.display = 'block'
  const r = node.getBoundingClientRect(), w = b.offsetWidth, h = b.offsetHeight
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)
  const below = r.bottom + 6 + h < window.innerHeight
  b.style.left = `${left}px`; b.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`
}
const enter = (e) => { const node = e.currentTarget; clearTimeout(timer); timer = setTimeout(() => { if (node.isConnected) show(node) }, 120) }   // the element is kept: currentTarget is gone once the event has been handled
const set = (node, v) => { const text = String(v ?? ''); node.setAttribute('data-tip', text); if (text) node.setAttribute('aria-label', text) }
export const vTip = {
  mounted(node, b) { set(node, b.value); node.addEventListener('mouseenter', enter); node.addEventListener('focus', enter); node.addEventListener('mouseleave', hide); node.addEventListener('blur', hide); node.addEventListener('click', hide) },
  updated(node, b) { set(node, b.value) },
  unmounted(node) { node.removeEventListener('mouseenter', enter); node.removeEventListener('focus', enter); node.removeEventListener('mouseleave', hide); node.removeEventListener('blur', hide); node.removeEventListener('click', hide); hide() },
}

/**
 * Every icon-only button gets the app's tooltip, whatever its author wrote: a button with no text, only an icon, whose name is in `title` or `aria-label`,
 * is taken over the first time the pointer or the keyboard reaches it (its `title` moves into the tooltip so the browser's slow one does not also show).
 * A button that uses v-tip, or has text, is left to itself. A disabled button gets no pointer events: wrap it in a `.tipwrap` span with v-tip.
 */
const isIconOnly = (el) => !el.textContent.trim() && !!el.querySelector('i, svg')
function adopt(e) {
  const el = e.target instanceof Element ? e.target.closest('button, a.btn') : null
  if (!el || el.hasAttribute('data-tip') || el.dataset.autotip || !isIconOnly(el)) return
  const label = el.getAttribute('title') || el.getAttribute('aria-label') || ''
  if (!label) return
  el.dataset.autotip = '1'
  set(el, label); el.removeAttribute('title')
  el.addEventListener('mouseenter', enter); el.addEventListener('focus', enter); el.addEventListener('mouseleave', hide); el.addEventListener('blur', hide); el.addEventListener('click', hide)
  enter({ currentTarget: el })
}
export function installAutoTips() { document.addEventListener('mouseover', adopt, true); document.addEventListener('focusin', adopt, true) }
