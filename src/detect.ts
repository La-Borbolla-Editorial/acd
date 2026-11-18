// Método 2: detectar las marcas canónicas impresas en el PDF (números en el
// margen, o entre corchetes dentro del texto) y proponerlas como anclas.
//
// No depende de ningún lector de PDF: recibe fragmentos de texto con sus
// coordenadas (ver `pdfjs.ts` para obtenerlos de pdf.js).

import { getScheme } from './map.js'
import { anchorsOf, applySet, comparePos, formatRef } from './resolve.js'
import type { Anchor, CanonMap, MarkerPlace, Ref, Scheme } from './types.js'
import { firstValue, fromRoman, nextValue, normalizeValue, ordinal, valueAt } from './values.js'

/** Fragmento de texto. Coordenadas en unidades del PDF, con origen ARRIBA a la izquierda. */
export interface TextItem {
  page: number
  str: string
  x: number
  y: number
  width: number
  height: number
}

export interface PageBox {
  page: number
  width: number
  height: number
}

export interface DetectOptions {
  /** Fracción superior de la hoja que se ignora (cabeceras, títulos corridos). */
  headerBand?: number
  /** Fracción inferior que se ignora (número de página, pie). */
  footerBand?: number
  /** Largo mínimo de un fragmento para tomarlo como línea del cuerpo del texto. */
  minBodyChars?: number
  /** Distancia mínima, en unidades del PDF, entre el cuerpo y una marca para que cuente como marginal. */
  marginGap?: number
}

export interface Candidate extends Anchor {
  origin: 'detected'
  confidence: number
  /** `suspicious`: rompe la secuencia; hay que revisarla antes de aceptarla. */
  status: 'ok' | 'suspicious'
  where: MarkerPlace | 'heading'
  /** Texto encontrado en el PDF. */
  found: string
  /** En una marca sospechosa: el valor que debería ir ahí, si el hueco lo deja claro. */
  correction?: { set: Record<string, string>; ref: Ref; text: string }
  /** Referencia completa que regiría desde ahí. */
  ref: Ref
  text: string
}

const DEFAULTS: Required<DetectOptions> = { headerBand: 0.06, footerBand: 0.06, minBodyChars: 20, marginGap: 4 }

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!
}

/** Bordes izquierdo y derecho del cuerpo del texto de una hoja, o `null` si no hay cuerpo. */
export function bodyColumn(items: TextItem[], minChars: number): { left: number; right: number } | null {
  const lines = items.filter((it) => it.str.trim().length >= minChars)
  if (lines.length < 3) return null
  // La mayoría de las líneas empiezan en el margen izquierdo y llegan al derecho;
  // las sangrías y los finales de párrafo quedan por dentro.
  return { left: quantile(lines.map((l) => l.x), 0.2), right: quantile(lines.map((l) => l.x + l.width), 0.8) }
}

interface Raw {
  page: number
  y: number
  x: number
  set: Record<string, string>
  where: MarkerPlace | 'heading'
  found: string
  /** Encabezado sin número legible: el nivel toma el valor siguiente al vigente. */
  infer?: string
}

/**
 * Corrige confusiones típicas del OCR en marcas numéricas: «(I)» → «(1)»,
 * «l0» → «10». Solo toca grupos formados únicamente por dígitos y esas letras,
 * y que contengan algún dígito o sean una sola letra.
 */
export function fixOcrDigits(s: string): string {
  const fix = (g: string) => g.replace(/\s+/g, '').replace(/[lI|![]/g, '1').replace(/[Oo]/g, '0').replace(/[EB]/g, '8').replace(/S/g, '5')
  // Contenido de corchetes o paréntesis: «(I)», «(4!)», «([19)», «( IE8)». Con más
  // de un carácter hace falta algún dígito; solo, únicamente lo que parece un 1.
  let out = s.replace(/([[(])(\s*[\dlIO|![EBSo](?:\s?[\dlIO|![EBSo]){0,3}\s*)([\])])/g, (m, a: string, g: string, b: string) => {
    const t = g.trim()
    return /\d/.test(t) || /^[lI|!]$/.test(t) ? a + fix(t) + b : m
  })
  // Fragmento entero (marca marginal): «l2».
  if (/^[\dlIO|]{1,4}$/.test(out.trim()) && /\d/.test(out)) out = fix(out.trim())
  return out
}

/** Valores de los grupos con nombre, normalizados; `null` si alguno no vale. */
function setFrom(scheme: Scheme, groups: Record<string, string | undefined>): Record<string, string> | null {
  const set: Record<string, string> = {}
  for (const [k, v] of Object.entries(groups)) {
    if (v === undefined) continue
    const l = scheme.levels.find((x) => x.key === k)
    if (!l) continue
    let n = normalizeValue(l.values, fixOcrDigits(v))
    // Un nivel arábigo puede venir en romanos en un encabezado: «QUAESTIO II».
    if (n === null && l.values === 'arabic') {
      const r = fromRoman(v)
      n = r === null ? null : String(r)
    }
    if (n === null) return null
    set[k] = n
  }
  return Object.keys(set).length ? set : null
}

/** Línea de texto: fragmentos a la misma altura, de izquierda a derecha. */
export interface Line {
  page: number
  text: string
  x: number
  y: number
  width: number
  height: number
}

/** Junta los fragmentos de una hoja en líneas (un número en otro cuerpo de letra queda en su línea). */
export function joinLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2))
  const groups: TextItem[][] = []
  for (const it of sorted) {
    const c = it.y + it.height / 2
    const g = groups[groups.length - 1]
    const ref = g?.[0]
    if (g && ref && Math.abs(c - (ref.y + ref.height / 2)) <= 0.6 * Math.max(ref.height, it.height)) g.push(it)
    else groups.push([it])
  }
  return groups.map((g) => {
    g.sort((a, b) => a.x - b.x)
    let text = ''
    for (const it of g) text += (text && !/\s$/.test(text) && !/^\s/.test(it.str) ? ' ' : '') + it.str
    const x = Math.min(...g.map((i) => i.x))
    const right = Math.max(...g.map((i) => i.x + i.width))
    const y = Math.min(...g.map((i) => i.y))
    return { page: g[0]!.page, text: text.replace(/\s+/g, ' ').trim(), x, y, width: right - x, height: Math.max(...g.map((i) => i.height)) }
  })
}

function median(xs: number[]): number {
  return quantile(xs, 0.5)
}

function findRaw(scheme: Scheme, pages: PageBox[], items: TextItem[], o: Required<DetectOptions>): Raw[] {
  const markers = (scheme.markers ?? []).map((m) => ({
    where: m.where ?? (['margin', 'inline', 'lineStart'] as MarkerPlace[]),
    whole: new RegExp(`^(?:${m.pattern})$`),
    inline: new RegExp(`\\[\\s*(?:${m.pattern})\\s*\\]`, 'g'),
    lineStart: new RegExp(`^(?:\\[\\s*(?:${m.pattern})\\s*\\]|\\(\\s*(?:${m.pattern})\\s*\\))`),
  }))
  const headings = (scheme.headings ?? []).map((h) => ({ level: h.level, re: new RegExp(`^(?:${h.pattern})`, 'i') }))
  const out: Raw[] = []
  for (const box of pages) {
    const top = box.height * o.headerBand
    const bottom = box.height * (1 - o.footerBand)
    const onPage = items.filter((it) => it.page === box.page && it.y >= top && it.y + it.height <= bottom && it.str.trim())
    const body = bodyColumn(onPage, o.minBodyChars)
    if (headings.length && body) out.push(...findHeadings(scheme, headings, box, onPage, body, o))
    for (const it of onPage) {
      const original = it.str.trim()
      const s = fixOcrDigits(original)
      const y = it.y / box.height
      const inMargin = body !== null && (it.x + it.width <= body.left - o.marginGap || it.x >= body.right + o.marginGap)
      if (inMargin) {
        for (const m of markers) {
          if (!m.where.includes('margin')) continue
          const g = m.whole.exec(s)?.groups
          const set = g && setFrom(scheme, g)
          if (set) { out.push({ page: box.page, y, x: it.x, set, where: 'margin', found: original }); break }
        }
        continue
      }
      // Al principio de una línea: el fragmento empieza en el borde izquierdo
      // del cuerpo o en la sangría de párrafo, no a media línea.
      const atLineStart = body === null || it.x <= body.left + 40
      let startHit = false
      if (atLineStart) {
        for (const m of markers) {
          if (!m.where.includes('lineStart')) continue
          const hit = m.lineStart.exec(s)
          const set = hit?.groups && setFrom(scheme, hit.groups)
          if (hit && set) {
            out.push({ page: box.page, y, x: it.x, set, where: 'lineStart', found: original.slice(0, hit[0].length) })
            startHit = true
            break
          }
        }
      }
      for (const m of markers) {
        if (!m.where.includes('inline')) continue
        for (const hit of s.matchAll(m.inline)) {
          if (startHit && hit.index === 0) continue // ya contada como inicio de línea
          const set = hit.groups && setFrom(scheme, hit.groups)
          // Posición aproximada dentro del fragmento, proporcional a los caracteres.
          const x = it.x + (it.width * (hit.index ?? 0)) / Math.max(1, s.length)
          if (set) out.push({ page: box.page, y, x, set, where: 'inline', found: hit[0] })
        }
      }
    }
  }
  return out.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
}

/**
 * Encabezados: líneas cortas, con letra más grande que el cuerpo o centradas,
 * que empiezan con el patrón de un encabezado del esquema.
 */
function findHeadings(
  scheme: Scheme,
  headings: { level: string; re: RegExp }[],
  box: PageBox,
  onPage: TextItem[],
  body: { left: number; right: number },
  o: Required<DetectOptions>,
): Raw[] {
  const out: Raw[] = []
  const bodyHeight = median(onPage.filter((it) => it.str.trim().length >= o.minBodyChars).map((it) => it.height))
  const bodyWidth = body.right - body.left
  const bodyCenter = (body.left + body.right) / 2
  for (const line of joinLines(onPage)) {
    if (line.text.length > 80) continue
    const big = line.height >= bodyHeight * 1.2
    const centered = line.width < bodyWidth * 0.7 && Math.abs(line.x + line.width / 2 - bodyCenter) < bodyWidth * 0.1
    if (!big && !centered) continue
    for (const h of headings) {
      const hit = h.re.exec(line.text)
      if (!hit) continue
      const value = hit.groups?.[h.level]
      const set = value === undefined ? {} : setFrom(scheme, { [h.level]: value })
      // Un número ilegible no descarta el encabezado: se infiere el siguiente.
      out.push({
        page: box.page, y: line.y / box.height, x: line.x, set: set ?? {}, where: 'heading', found: hit[0].trim(),
        ...(set && Object.keys(set).length ? {} : { infer: h.level }),
      })
      break
    }
  }
  return out
}

/** Clave comparable de una referencia: el orden de cada nivel (−1 si no tiene valor). */
function key(scheme: Scheme, ref: Ref): number[] {
  return scheme.levels.map((l) => (ref[l.key] === undefined ? -1 : (ordinal(l.values, ref[l.key]!) ?? -1)))
}

function cmpKey(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return 0
}

/** Índices de la subsecuencia estrictamente creciente más larga. */
function longestIncreasing(keys: number[][]): Set<number> {
  const len = keys.map(() => 1)
  const prev = keys.map(() => -1)
  for (let i = 0; i < keys.length; i++) {
    for (let j = 0; j < i; j++) {
      if (cmpKey(keys[j]!, keys[i]!) < 0 && len[j]! + 1 > len[i]!) { len[i] = len[j]! + 1; prev[i] = j }
    }
  }
  let best = -1
  for (let i = 0; i < keys.length; i++) if (best < 0 || len[i]! > len[best]!) best = i
  const chain = new Set<number>()
  for (let i = best; i >= 0; i = prev[i]!) chain.add(i)
  return chain
}

/** Paso entre dos referencias consecutivas: 1 si es la siguiente esperada. */
function step(scheme: Scheme, a: Ref, b: Ref): number {
  const ka = key(scheme, a)
  const kb = key(scheme, b)
  const d = ka.findIndex((v, i) => v !== kb[i])
  if (d < 0) return 0
  const diff = kb[d]! - ka[d]!
  if (ka[d] === -1) return 1 // aparece un nivel que no tenía valor
  // Si cambió un nivel superior, los inferiores deberían empezar de nuevo, o
  // seguir igual si su numeración es continua (el número de la Ordinatio a
  // través de las cuestiones).
  const lowerFresh = scheme.levels.slice(d + 1).every((l, j) => {
    const vb = kb[d + 1 + j]!
    const va = ka[d + 1 + j]!
    return vb === -1 || vb <= (Array.isArray(l.values) ? 0 : 1) || vb === va || vb === va + 1
  })
  return lowerFresh ? diff : diff + 1
}

/**
 * Detecta marcas del esquema y las devuelve como anclas propuestas, en orden
 * de lectura. Las anclas ya presentes en el mapa se toman como ciertas: una
 * marca que las contradice queda como sospechosa. Una marca que repite lo
 * que fija un ancla del mapa se omite; si repite otra marca detectada, es
 * sospechosa (suele ser un error del OCR: «(105)» dos veces).
 */
export function detect(
  map: Pick<CanonMap, 'schemes' | 'anchors'>,
  schemeId: string,
  pages: PageBox[],
  items: TextItem[],
  options: DetectOptions = {},
): Candidate[] {
  const scheme = getScheme(map, schemeId)
  const o = { ...DEFAULTS, ...options }
  const fixed = anchorsOf(map, schemeId)
  const raw = findRaw(scheme, pages, items, o)

  // Recorrido en orden con las anclas fijas intercaladas: referencia tentativa de cada marca.
  type Ev = { fixed: Anchor } | { raw: Raw; idx: number }
  const events: Ev[] = [...fixed.map((a) => ({ fixed: a })), ...raw.map((r, idx) => ({ raw: r, idx }))]
  const posOf = (e: Ev) => ('fixed' in e ? e.fixed : { page: e.raw.page, y: e.raw.y })
  events.sort((a, b) => comparePos(posOf(a), posOf(b)) || ('fixed' in a ? -1 : 0) - ('fixed' in b ? -1 : 0))

  // Segmentos entre anclas fijas; dentro de cada uno, la cadena creciente más larga.
  const tentative: { idx: number; before: Ref; ref: Ref }[][] = [[]]
  const bounds: { low: number[] | null; high: number[] | null }[] = [{ low: null, high: null }]
  let state: Ref = {}
  let fromFixed = true
  for (const e of events) {
    if ('fixed' in e) {
      state = applySet(scheme, state, e.fixed.set)
      fromFixed = true
      const k = key(scheme, state)
      bounds[bounds.length - 1]!.high = k
      tentative.push([])
      bounds.push({ low: k, high: null })
    } else {
      if (e.raw.infer) e.raw.set = inferNext(scheme, state, e.raw.infer)
      const ref = applySet(scheme, state, e.raw.set)
      const same = cmpKey(key(scheme, ref), key(scheme, state)) === 0
      // Lo que ya dice un ancla, o un encabezado que repite otro («Questions 5 and 6» … «Question 5»), sobra.
      if (same && (fromFixed || e.raw.where === 'heading')) continue
      tentative[tentative.length - 1]!.push({ idx: e.idx, before: state, ref })
      state = ref
      fromFixed = false
    }
  }

  const accepted = new Set<number>()
  tentative.forEach((seg, s) => {
    const { low, high } = bounds[s]!
    const inside = seg.filter((t) => {
      const k = key(scheme, t.ref)
      return (!low || cmpKey(k, low) > 0) && (!high || cmpKey(k, high) < 0)
    })
    const chain = longestIncreasing(inside.map((t) => key(scheme, t.ref)))
    inside.forEach((t, i) => { if (chain.has(i)) accepted.add(t.idx) })
  })
  const considered = new Set(tentative.flat().map((t) => t.idx))

  // Segunda pasada: referencias definitivas heredando solo de lo aceptado.
  const out: Candidate[] = []
  const before: Ref[] = []
  state = {}
  for (const e of events) {
    if ('fixed' in e) { state = applySet(scheme, state, e.fixed.set); continue }
    if (!considered.has(e.idx)) continue
    const r = e.raw
    const ref = applySet(scheme, state, r.set)
    const ok = accepted.has(e.idx)
    let confidence = 0.2
    before.push(state)
    if (ok) {
      const st = step(scheme, state, ref)
      confidence = r.infer ? 0.5 : (r.where !== 'margin' ? 0.7 : 0.6) + (st === 1 ? 0.3 : st <= 3 ? 0.1 : 0)
      state = ref
    }
    out.push({
      scheme: schemeId, page: r.page, y: r.y, set: r.set, origin: 'detected',
      confidence: Math.round(confidence * 100) / 100,
      status: ok ? 'ok' : 'suspicious', where: r.where, found: r.found, ref, text: formatRef(scheme, ref),
    })
  }
  out.forEach((c, i) => {
    if (c.status !== 'suspicious') return
    const next = out.slice(i + 1).find((x) => x.status === 'ok' && x.where !== 'heading')
    const fix = next && expectedBetween(scheme, before[i]!, next.ref)
    if (fix) c.correction = fix
  })
  return out
}

/**
 * Si entre dos referencias aceptadas cabe exactamente un valor en el nivel más
 * bajo (n. 7 … n. 9), ese valor es la corrección probable de una marca
 * sospechosa que está en medio.
 */
function expectedBetween(scheme: Scheme, prev: Ref, next: Ref): Candidate['correction'] {
  let d = -1
  for (let i = scheme.levels.length - 1; i >= 0; i--) if (prev[scheme.levels[i]!.key] !== undefined) { d = i; break }
  if (d < 0) return undefined
  const l = scheme.levels[d]!
  // Deben coincidir los niveles que reinician este (en la Ordinatio, hasta la
  // distinción): el número corre a través de las cuestiones.
  const r = l.resetOn !== undefined ? l.resetOn : d > 0 ? scheme.levels[d - 1]!.key : null
  const upto = r === null ? -1 : scheme.levels.findIndex((u) => u.key === r)
  if (scheme.levels.slice(0, upto + 1).some((u) => prev[u.key] !== next[u.key]) || next[l.key] === undefined) return undefined
  const a = ordinal(l.values, prev[l.key]!)
  const b = ordinal(l.values, next[l.key]!)
  if (a === null || b === null || b - a !== 2) return undefined
  const v = valueAt(l.values, a + 1)
  if (v === null) return undefined
  const set = { [l.key]: v }
  const ref = applySet(scheme, prev, set)
  return { set, ref, text: formatRef(scheme, ref) }
}

/** Valor siguiente del nivel, o el primero si no tiene. */
function inferNext(scheme: Scheme, state: Ref, levelKey: string): Record<string, string> {
  const l = scheme.levels.find((x) => x.key === levelKey)
  if (!l) return {}
  const cur = state[levelKey]
  const v = cur === undefined ? firstValue(l.values) : nextValue(l.values, cur)?.value
  return v ? { [levelKey]: v } : {}
}

/** Añade al mapa los candidatos aceptados, como anclas detectadas. */
export function acceptCandidates<M extends Pick<CanonMap, 'anchors'>>(map: M, candidates: Candidate[]): M {
  const anchors: Anchor[] = candidates.map((c, i) => ({
    id: `d${c.page}-${Math.round(c.y * 1000)}-${i}`,
    scheme: c.scheme, page: c.page, y: c.y, set: c.set, origin: 'detected', confidence: c.confidence,
  }))
  return { ...map, anchors: [...map.anchors, ...anchors] }
}
