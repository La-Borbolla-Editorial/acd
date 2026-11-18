// Método 2: detectar las marcas canónicas impresas en el PDF (números en el
// margen, o entre corchetes dentro del texto) y proponerlas como anclas.
//
// No depende de ningún lector de PDF: recibe fragmentos de texto con sus
// coordenadas (ver `pdfjs.ts` para obtenerlos de pdf.js).

import { getScheme } from './map.js'
import { anchorsOf, applySet, comparePos, formatRef } from './resolve.js'
import type { Anchor, CanonMap, Ref, Scheme } from './types.js'
import { normalizeValue, ordinal } from './values.js'

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
  where: 'margin' | 'inline'
  /** Texto encontrado en el PDF. */
  found: string
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
  where: 'margin' | 'inline'
  found: string
}

/** Valores de los grupos con nombre, normalizados; `null` si alguno no vale. */
function setFrom(scheme: Scheme, groups: Record<string, string | undefined>): Record<string, string> | null {
  const set: Record<string, string> = {}
  for (const [k, v] of Object.entries(groups)) {
    if (v === undefined) continue
    const l = scheme.levels.find((x) => x.key === k)
    if (!l) continue
    const n = normalizeValue(l.values, v)
    if (n === null) return null
    set[k] = n
  }
  return Object.keys(set).length ? set : null
}

function findRaw(scheme: Scheme, pages: PageBox[], items: TextItem[], o: Required<DetectOptions>): Raw[] {
  const markers = (scheme.markers ?? []).map((m) => ({
    where: m.where ?? ['margin', 'inline'],
    whole: new RegExp(`^(?:${m.pattern})$`),
    inline: new RegExp(`\\[\\s*(?:${m.pattern})\\s*\\]`, 'g'),
  }))
  const out: Raw[] = []
  for (const box of pages) {
    const top = box.height * o.headerBand
    const bottom = box.height * (1 - o.footerBand)
    const onPage = items.filter((it) => it.page === box.page && it.y >= top && it.y + it.height <= bottom && it.str.trim())
    const body = bodyColumn(onPage, o.minBodyChars)
    for (const it of onPage) {
      const s = it.str.trim()
      const y = it.y / box.height
      const inMargin = body !== null && (it.x + it.width <= body.left - o.marginGap || it.x >= body.right + o.marginGap)
      if (inMargin) {
        for (const m of markers) {
          if (!m.where.includes('margin')) continue
          const g = m.whole.exec(s)?.groups
          const set = g && setFrom(scheme, g)
          if (set) { out.push({ page: box.page, y, x: it.x, set, where: 'margin', found: s }); break }
        }
        continue
      }
      for (const m of markers) {
        if (!m.where.includes('inline')) continue
        for (const hit of s.matchAll(m.inline)) {
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
  // Si cambió un nivel superior, los inferiores deberían empezar de nuevo.
  const lowerFresh = scheme.levels.slice(d + 1).every((l, j) => kb[d + 1 + j] === -1 || kb[d + 1 + j]! <= (Array.isArray(l.values) ? 0 : 1) || kb[d + 1 + j] === ka[d + 1 + j]! + 1)
  return lowerFresh ? diff : diff + 1
}

/**
 * Detecta marcas del esquema y las devuelve como anclas propuestas, en orden
 * de lectura. Las anclas ya presentes en el mapa se toman como ciertas: una
 * marca que las contradice queda como sospechosa. Las marcas que no cambian
 * nada (repiten lo vigente) se omiten.
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
  for (const e of events) {
    if ('fixed' in e) {
      state = applySet(scheme, state, e.fixed.set)
      const k = key(scheme, state)
      bounds[bounds.length - 1]!.high = k
      tentative.push([])
      bounds.push({ low: k, high: null })
    } else {
      const ref = applySet(scheme, state, e.raw.set)
      if (cmpKey(key(scheme, ref), key(scheme, state)) === 0) continue // no cambia nada
      tentative[tentative.length - 1]!.push({ idx: e.idx, before: state, ref })
      state = ref
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
  state = {}
  for (const e of events) {
    if ('fixed' in e) { state = applySet(scheme, state, e.fixed.set); continue }
    if (!considered.has(e.idx)) continue
    const r = e.raw
    const ref = applySet(scheme, state, r.set)
    const ok = accepted.has(e.idx)
    let confidence = 0.2
    if (ok) {
      const st = step(scheme, state, ref)
      confidence = (r.where === 'inline' ? 0.7 : 0.6) + (st === 1 ? 0.3 : st <= 3 ? 0.1 : 0)
      state = ref
    }
    out.push({
      scheme: schemeId, page: r.page, y: r.y, set: r.set, origin: 'detected',
      confidence: Math.round(confidence * 100) / 100,
      status: ok ? 'ok' : 'suspicious', where: r.where, found: r.found, ref, text: formatRef(scheme, ref),
    })
  }
  return out
}

/** Añade al mapa los candidatos aceptados, como anclas detectadas. */
export function acceptCandidates<M extends Pick<CanonMap, 'anchors'>>(map: M, candidates: Candidate[]): M {
  const anchors: Anchor[] = candidates.map((c, i) => ({
    id: `d${c.page}-${Math.round(c.y * 1000)}-${i}`,
    scheme: c.scheme, page: c.page, y: c.y, set: c.set, origin: 'detected', confidence: c.confidence,
  }))
  return { ...map, anchors: [...map.anchors, ...anchors] }
}
