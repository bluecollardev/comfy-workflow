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
