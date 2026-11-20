// Visor de prueba de acd: abrir un PDF, detectar y revisar anclas, marcar a
// mano y ver la cita de lo que se selecciona.

import 'pdfjs-dist/web/pdf_viewer.css'
import './style.css'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  acceptCandidates, addAnchor, anchorsOf, builtinSchemes, cite, createMap, detect, formatRef, fromPdfjs,
  getScheme, parseRef, refAt, removeAnchor, suggestAt, updateAnchor, validateMap,
  type Anchor, type Candidate, type CanonMap, type PageBox, type Position, type TextItem,
} from 'acd'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// --- Estado -------------------------------------------------------------------

interface PageView {
  num: number
  div: HTMLDivElement
  gutter: HTMLDivElement
  guides: HTMLDivElement
  width: number
  height: number
  rendered: boolean
}

let doc: pdfjs.PDFDocumentProxy | null = null
let loading: pdfjs.PDFDocumentLoadingTask | null = null
let pdfName = 'documento'
let storeKey = ''
let map: CanonMap = createMap(builtinSchemes)
let schemeId = 'ordinatio'
let candidates: Candidate[] = []
let marking = false
let text: { boxes: PageBox[]; items: TextItem[] } | null = null
let views: PageView[] = []

// --- Abrir el PDF -------------------------------------------------------------

/** URL de un recurso estático, en local y en GitHub Pages (que sirve desde /acd/). */
function asset(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, location.href).href
}

async function openPdf(data: ArrayBuffer, name: string): Promise<void> {
  void loading?.destroy()
  loading = pdfjs.getDocument({
    data,
    cMapUrl: asset('pdfjs/cmaps/'),
    standardFontDataUrl: asset('pdfjs/standard_fonts/'),
    wasmUrl: asset('pdfjs/wasm/'),
    iccUrl: asset('pdfjs/iccs/'),
  })
  doc = await loading.promise
  pdfName = name.replace(/\.pdf$/i, '')
  storeKey = `acd:${doc.fingerprints[0] ?? name}`
  map = loadStored() ?? createMap(builtinSchemes, { fingerprint: doc.fingerprints[0] ?? undefined, pages: doc.numPages })
  candidates = []
  text = null
  $('drop').hidden = true
  for (const id of ['detect', 'mark', 'save-map']) ($(id) as HTMLButtonElement).disabled = false
  await layoutPages()
  refresh()
}

/** Mapa guardado en este navegador; los esquemas siempre los del paquete. */
function loadStored(): CanonMap | null {
  try {
    const raw = localStorage.getItem(storeKey)
    if (!raw) return null
    const m = { ...(JSON.parse(raw) as CanonMap), schemes: builtinSchemes }
    return validateMap(m).length === 0 ? m : null
  } catch {
    return null
  }
}

function store(): void {
  try { localStorage.setItem(storeKey, JSON.stringify({ ...map, schemes: undefined })) } catch { /* sin almacenamiento */ }
}

// --- Hojas --------------------------------------------------------------------

/** Ancho de la hoja: hasta 760 px, dejando sitio al margen de anclas. */
function pageWidth(): number {
  return Math.max(360, Math.min(760, $('viewer').clientWidth - 230))
}

async function layoutPages(): Promise<void> {
  const host = $('pages')
  host.innerHTML = ''
  views = []
  if (!doc) return
  const width = pageWidth()
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) void renderPage(views[Number((e.target as HTMLElement).dataset.page) - 1]!)
  }, { root: $('viewer'), rootMargin: '600px 0px' })
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const [x0 = 0, , x1 = 0] = page.view
    const vp = page.getViewport({ scale: width / (x1 - x0) })
    const div = document.createElement('div')
    div.className = 'page'
    div.dataset.page = String(n)
    div.style.width = `${vp.width}px`
    div.style.height = `${vp.height}px`
    const num = document.createElement('span')
    num.className = 'num'
    num.textContent = String(n)
    const guides = document.createElement('div')
    const gutter = document.createElement('div')
    gutter.className = 'gutter'
    div.append(num, guides, gutter)
    host.append(div)
    const v: PageView = { num: n, div, gutter, guides, width: vp.width, height: vp.height, rendered: false }
    views.push(v)
    div.addEventListener('click', (e) => onPageClick(v, e))
    div.addEventListener('mousemove', (e) => onPageHover(v, e))
    observer.observe(div)
  }
}

async function renderPage(v: PageView): Promise<void> {
  if (v.rendered || !doc) return
  v.rendered = true
  const page = await doc.getPage(v.num)
  const [x0 = 0, , x1 = 0] = page.view
  const scale = v.width / (x1 - x0)
  const vp = page.getViewport({ scale })
  const ratio = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width * ratio)
  canvas.height = Math.floor(vp.height * ratio)
  canvas.style.width = `${vp.width}px`
  canvas.style.height = `${vp.height}px`
  v.div.prepend(canvas)
  await page.render({ canvas, viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise
  const layer = document.createElement('div')
  layer.className = 'textLayer'
  v.div.style.setProperty('--total-scale-factor', String(scale))
  v.div.style.setProperty('--scale-round-x', '1px')
  v.div.style.setProperty('--scale-round-y', '1px')
  canvas.after(layer)
  await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: vp }).render()
}

// --- Dibujar anclas y candidatos ------------------------------------------------

function refresh(): void {
  const scheme = getScheme(map, schemeId)
  const anchors = anchorsOf(map, schemeId)
  for (const v of views) {
    v.gutter.innerHTML = ''
    v.guides.innerHTML = ''
    v.div.classList.toggle('marking', marking)
  }
  for (const a of anchors) {
    const v = views[a.page - 1]
    if (!v) continue
    addPin(v, a.y, a.stop ? 'fin del texto' : formatRef(scheme, a.set), `anchor ${a.origin}${a.stop ? ' stop' : ''}`, 'anchor', () => anchorMenu(a))
  }
  for (const c of candidates) {
    const v = views[c.page - 1]
    if (!v) continue
    const label = c.status === 'ok' ? formatRef(scheme, c.set) : `${c.found}${c.correction ? ` → ${formatRef(scheme, c.correction.set)}` : ' ?'}`
    addPin(v, c.y, label, c.status === 'ok' ? 'cand' : 'sus', c.status === 'ok' ? 'cand' : 'sus', () => candidateMenu(c))
  }
  // Resumen del mapa
  const manual = anchors.filter((a) => a.origin === 'manual').length
  $('map-summary').textContent = !doc
    ? 'Abre un PDF para empezar.'
    : anchors.length === 0
      ? 'Sin anclas. Marca primero dónde empieza el texto: la detección busca desde la primera ancla, y así se salta el estudio introductorio.'
      : `${anchors.length} anclas en «${scheme.name}» (${manual} a mano, ${anchors.length - manual} detectadas). La detección busca desde la primera.`
  $('clear-anchors').hidden = anchors.length === 0
  // Candidatos
  $('cand-section').hidden = candidates.length === 0 && !text
  const ok = candidates.filter((c) => c.status === 'ok')
  const sus = candidates.filter((c) => c.status === 'suspicious')
  $('cand-summary').textContent = candidates.length
    ? `${ok.length} por revisar como seguras, ${sus.length} sospechosas.`
    : text ? 'Nada pendiente.' : ''
  const list = $('cand-list')
  list.innerHTML = ''
  for (const c of [...sus, ...ok.filter((c) => c.confidence < 0.8)]) {
    const li = document.createElement('li')
    const label = document.createElement('span')
    label.textContent = c.status === 'ok' ? formatRef(scheme, c.set) : `${c.found}${c.correction ? ` → ${formatRef(scheme, c.correction.set)}` : ''}`
    label.style.color = c.status === 'ok' ? 'var(--ok)' : 'var(--sus)'
    const where = document.createElement('span')
    where.className = 'where'
    where.textContent = `hoja ${c.page} · ${Math.round(c.confidence * 100)} %`
    li.append(label, where)
    li.addEventListener('click', () => scrollToPos(c))
    list.append(li)
  }
}

function addPin(v: PageView, y: number, label: string, cls: string, guideCls: string, onClick: () => void): void {
  const pin = document.createElement('div')
  pin.className = `pin ${cls}`
  pin.style.top = `${y * v.height}px`
  pin.textContent = label
  pin.title = label
  pin.addEventListener('click', (e) => { e.stopPropagation(); onClick(); placePop(pin) })
  v.gutter.append(pin)
  const guide = document.createElement('div')
  guide.className = `guide ${guideCls === 'anchor' ? '' : guideCls}`
  guide.style.top = `${y * v.height}px`
  v.guides.append(guide)
}

function scrollToPos(p: Position): void {
  const v = views[p.page - 1]
  if (!v) return
  $('viewer').scrollTo({ top: v.div.offsetTop + p.y * v.height - 200, behavior: 'smooth' })
}

// --- Ventanita de acciones ------------------------------------------------------

const pop = $('pop')
let popAnchor: HTMLElement | null = null

function placePop(near: HTMLElement | { x: number; y: number }): void {
  pop.hidden = false
  const r = near instanceof HTMLElement ? near.getBoundingClientRect() : { left: near.x, right: near.x, top: near.y, bottom: near.y }
  popAnchor = near instanceof HTMLElement ? near : null
  const w = pop.offsetWidth
  const h = pop.offsetHeight
  const left = Math.min(window.innerWidth - w - 10, near instanceof HTMLElement ? r.right + 8 : r.left + 10)
  const top = Math.min(window.innerHeight - h - 10, Math.max(10, r.top - 10))
  pop.style.left = `${Math.max(10, left)}px`
  pop.style.top = `${top}px`
  pop.querySelector<HTMLInputElement>('input')?.focus()
}

function closePop(): void {
  pop.hidden = true
  pop.innerHTML = ''
  popAnchor = null
}

function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = `btn small ${cls}`
  b.textContent = label
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick() })
  return b
}

function setPop(title: string, ...children: (HTMLElement | string)[]): void {
  pop.innerHTML = ''
  const h = document.createElement('h3')
  h.textContent = title
  pop.append(h, ...children.map((c) => {
    if (typeof c !== 'string') return c
    const p = document.createElement('p')
    p.textContent = c
    return p
  }))
}

function row(...buttons: HTMLElement[]): HTMLDivElement {
  const d = document.createElement('div')
  d.className = 'row'
  d.append(...buttons)
  return d
}

function anchorMenu(a: Anchor): void {
  const scheme = getScheme(map, schemeId)
  if (a.stop) {
    setPop('Fin del texto', 'Desde aquí no rige ninguna referencia, ni se detecta nada, hasta el ancla siguiente.', `Hoja ${a.page}`,
      row(button('Borrar', () => { map = removeAnchor(map, a.id!); changed() }, 'danger')))
    return
  }
  setPop(
    formatRef(scheme, a.set),
    `Desde aquí rige ${formatRef(scheme, refAt(map, schemeId, a)) || '—'}.`,
    `${a.origin === 'manual' ? 'Marcada a mano' : `Detectada (${Math.round((a.confidence ?? 0) * 100)} %)`} · hoja ${a.page}`,
    row(
      button('Editar', () => editor(a, { title: 'Editar ancla', initial: formatRef(scheme, a.set), save: (set) => { map = updateAnchor(map, a.id!, { set, origin: 'manual' }) } })),
      button('Borrar', () => { map = removeAnchor(map, a.id!); changed() }, 'danger'),
    ),
  )
}

function candidateMenu(c: Candidate): void {
  const scheme = getScheme(map, schemeId)
  const drop = () => { candidates = candidates.filter((x) => x !== c) }
  const accept = (set: Record<string, string>) => { map = acceptCandidates(map, [{ ...c, set }]); drop(); changed() }
  setPop(
    c.status === 'ok' ? 'Propuesta' : 'Propuesta sospechosa',
    `En el PDF: «${c.found}» (${placeName(c.where)}). Regiría ${c.text}.`,
    `Confianza: ${Math.round(c.confidence * 100)} %`,
    row(
      ...(c.correction ? [button(`Aceptar como ${formatRef(scheme, c.correction.set)}`, () => accept(c.correction!.set), 'primary')] : []),
      button(c.status === 'ok' ? 'Aceptar' : 'Aceptar tal cual', () => accept(c.set), c.correction ? '' : 'primary'),
      button('Corregir…', () => editor(c, { title: 'Corregir propuesta', initial: formatRef(scheme, (c.correction ?? c).set), save: (set) => { map = addAnchor(map, { scheme: schemeId, page: c.page, y: c.y, set, origin: 'manual' }); drop() } })),
      button('Descartar', () => { drop(); changed() }, 'danger'),
    ),
  )
}

function placeName(w: Candidate['where']): string {
  return { margin: 'margen', inline: 'entre corchetes', lineStart: 'principio de línea', heading: 'encabezado' }[w]
}

/** Campo para escribir una referencia, con las sugerencias del método 1. */
function editor(pos: Position, o: { title: string; initial: string; save: (set: Record<string, string>) => void; suggestions?: { text: string; set: Record<string, string> }[]; onStop?: () => void }): void {
  const scheme = getScheme(map, schemeId)
  const input = document.createElement('input')
  input.value = o.initial
  input.placeholder = { ordinatio: 'II d. 3 q. 1 n. 29', stephanus: 'I, 327a', bekker: 'I 1, 1094a1', paragraphs: '§ 43' }[scheme.id] ?? '…'
  const err = document.createElement('p')
  err.className = 'err'
  const commit = (value: string) => {
    const set = parseRef(scheme, value)
    if (!set) { err.textContent = `No entiendo «${value}» en «${scheme.name}».`; return }
    try { o.save(set) } catch (e) { err.textContent = (e as Error).message; return }
    closePop()
    changed()
  }
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(input.value) }
    if (e.key === 'Escape') closePop()
  })
  const sugg = document.createElement('div')
  sugg.className = 'sugg'
  for (const s of o.suggestions ?? []) sugg.append(button(`${formatRef(scheme, s.set)}  →  ${s.text}`, () => commit(formatRef(scheme, s.set))))
  const stop = o.onStop ? [button('Aquí termina el texto', () => { o.onStop!(); changed() })] : []
  setPop(o.title, input, err, ...(o.suggestions?.length ? [sugg] : []), row(button('Guardar', () => commit(input.value), 'primary'), button('Cancelar', closePop), ...stop))
  if (!popAnchor) placePop({ x: pageClient(pos).x, y: pageClient(pos).y })
  input.select()
}

function pageClient(p: Position): { x: number; y: number } {
  const r = views[p.page - 1]!.div.getBoundingClientRect()
  return { x: r.left, y: r.top + p.y * r.height }
}

// --- Marcar, señalar, seleccionar ------------------------------------------------

function posIn(v: PageView, clientY: number): Position {
  const r = v.div.getBoundingClientRect()
  return { page: v.num, y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)) }
}

function onPageClick(v: PageView, e: MouseEvent): void {
  if (!marking) return
  const pos = posIn(v, e.clientY)
  const sugg = suggestAt(map, schemeId, pos)
  closePop()
  editor(pos, {
    title: `Nueva ancla · hoja ${v.num}`,
    initial: sugg[0] ? formatRef(getScheme(map, schemeId), sugg[0].set) : '',
    suggestions: sugg,
    save: (set) => { map = addAnchor(map, { scheme: schemeId, ...pos, set, origin: 'manual' }) },
    onStop: () => { map = addAnchor(map, { scheme: schemeId, ...pos, set: {}, origin: 'manual', stop: true }) },
  })
  placePop({ x: e.clientX, y: e.clientY })
}

function onPageHover(v: PageView, e: MouseEvent): void {
  const ref = refAt(map, schemeId, posIn(v, e.clientY))
  const t = formatRef(getScheme(map, schemeId), ref)
  $('here').textContent = `Hoja ${v.num}${t ? ` · aquí rige ${t}` : ''}`
}

function viewAt(clientY: number): PageView | undefined {
  return views.find((v) => {
    const r = v.div.getBoundingClientRect()
    return clientY >= r.top && clientY <= r.bottom
  })
}

function showCitation(): void {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || marking) return
  const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0 && r.height > 0)
  if (rects.length === 0) return
  const first = rects[0]!
  const last = rects[rects.length - 1]!
  // El centro de la primera y la última línea: lo que rige en cada una.
  const a = viewAt(first.top + first.height / 2)
  const b = viewAt(last.top + last.height / 2)
  if (!a || !b) return
  const c = cite(map, schemeId, posIn(a, first.top + first.height / 2), posIn(b, last.top + last.height / 2))
  const el = $('citation')
  el.innerHTML = ''
  if (!c) { el.className = 'muted'; el.textContent = 'Sin referencia: no hay ancla antes de la selección.'; return }
  el.className = 'has'
  const strong = document.createElement('b')
  strong.textContent = c.text
  el.append('Cita: ', strong, `  ·  hoja${a.num === b.num ? ` ${a.num}` : `s ${a.num}–${b.num}`} del PDF`)
  el.title = JSON.stringify({ start: c.start, end: c.end }, null, 1)
}

function setMarking(on: boolean): void {
  marking = on
  $('mark').setAttribute('aria-pressed', String(on))
  refresh()
}

// --- Detección -----------------------------------------------------------------

async function extractText(): Promise<{ boxes: PageBox[]; items: TextItem[] }> {
  if (text) return text
  const boxes: PageBox[] = []
  const items: TextItem[] = []
  const btn = $('detect')
  for (let n = 1; n <= doc!.numPages; n++) {
    btn.textContent = `Leyendo ${n}/${doc!.numPages}…`
    const page = await doc!.getPage(n)
    const r = fromPdfjs(n, page.view, (await page.getTextContent()).items)
    boxes.push(r.box)
    items.push(...r.items)
  }
  btn.textContent = 'Detectar'
  text = { boxes, items }
  return text
}

async function runDetect(): Promise<void> {
  if (!doc) return
  ;($('detect') as HTMLButtonElement).disabled = true
  try {
    const t = await extractText()
    candidates = detect(map, schemeId, t.boxes, t.items)
  } finally {
    ;($('detect') as HTMLButtonElement).disabled = false
  }
  refresh()
}

// --- Guardar y cargar ------------------------------------------------------------

function changed(): void {
  closePop()
  store()
  refresh()
}

function saveMap(): void {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${pdfName}.acd.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

async function loadMap(file: File): Promise<void> {
  try {
    const m = JSON.parse(await file.text()) as CanonMap
    const errors = validateMap(m)
    if (errors.length) { alert(`El mapa no es válido:\n${errors.slice(0, 8).join('\n')}`); return }
    map = { ...m, schemes: builtinSchemes }
    candidates = []
    changed()
  } catch (e) {
    alert(`No se pudo leer el mapa: ${(e as Error).message}`)
  }
}

// --- Conexiones ------------------------------------------------------------------

const schemeSel = $('scheme') as HTMLSelectElement
for (const s of builtinSchemes) schemeSel.append(new Option(s.name, s.id))
schemeSel.value = schemeId
schemeSel.addEventListener('change', () => { schemeId = schemeSel.value; candidates = []; refresh() })

$('open-pdf').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) await openPdf(await f.arrayBuffer(), f.name)
})
$('detect').addEventListener('click', () => void runDetect())
$('mark').addEventListener('click', () => setMarking(!marking))
$('save-map').addEventListener('click', saveMap)
$('load-map').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) void loadMap(f)
})
$('accept-sure').addEventListener('click', () => {
  const sure = candidates.filter((c) => c.status === 'ok' && c.confidence >= 0.8)
  map = acceptCandidates(map, sure)
  candidates = candidates.filter((c) => !sure.includes(c))
  changed()
})
$('discard-sus').addEventListener('click', () => { candidates = candidates.filter((c) => c.status === 'ok'); refresh() })
$('clear-anchors').addEventListener('click', () => {
  if (!confirm('¿Borrar todas las anclas de este esquema? No se puede deshacer.')) return
  map = { ...map, anchors: map.anchors.filter((a) => a.scheme !== schemeId) }
  changed()
})

document.addEventListener('mouseup', (e) => { if ((e.target as HTMLElement).closest('#pages')) setTimeout(showCitation, 0) })
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return
  if (e.key === 'm' || e.key === 'M') { if (doc) setMarking(!marking) }
  if (e.key === 'Escape') { closePop(); if (marking) setMarking(false) }
})
document.addEventListener('click', (e) => { if (!pop.hidden && !pop.contains(e.target as Node) && !(e.target as HTMLElement).closest('.pin, .page.marking')) closePop() })

const drop = $('drop')
const viewer = $('viewer')
viewer.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
viewer.addEventListener('dragleave', () => drop.classList.remove('over'))
viewer.addEventListener('drop', async (e) => {
  e.preventDefault()
  drop.classList.remove('over')
  const f = e.dataTransfer?.files[0]
  if (f && /pdf$/i.test(f.type || f.name)) await openPdf(await f.arrayBuffer(), f.name)
})

// ?pdf=URL abre un PDF servido por Vite (útil para probar con fixtures/private).
const fromUrl = new URLSearchParams(location.search).get('pdf')
if (fromUrl) {
  fetch(fromUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
    .then((buf) => openPdf(buf, decodeURIComponent(fromUrl.split('/').pop() ?? 'documento.pdf')))
    .catch((e) => { $('map-summary').textContent = `No se pudo abrir ${fromUrl}: ${(e as Error).message}` })
}
