// De una posición del PDF a su referencia canónica, y de una selección a su cita.

import { getScheme } from './map.js'
import type { Anchor, CanonMap, Position, Ref, RefPart, Scheme } from './types.js'
import { ordinal, valueAt } from './values.js'

export function comparePos(a: Position, b: Position): number {
  return a.page - b.page || (a.column ?? 0) - (b.column ?? 0) || a.y - b.y
}

/** Anclas de un esquema en orden de lectura (estable: a igual posición, el orden en que se añadieron). */
export function anchorsOf(map: Pick<CanonMap, 'anchors'>, schemeId: string): Anchor[] {
  return map.anchors
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.scheme === schemeId)
    .sort((x, y) => comparePos(x.a, y.a) || x.i - y.i)
    .map(({ a }) => a)
}

/** Nivel cuyo cambio reinicia el nivel `i`, o `null`. */
function resetter(scheme: Scheme, i: number): string | null {
  const l = scheme.levels[i]!
  if (l.resetOn !== undefined) return l.resetOn
  return i > 0 ? scheme.levels[i - 1]!.key : null
}

/**
 * Aplica los valores de un ancla al estado. Un nivel queda «afectado» si el
 * ancla le da un valor distinto o si se afecta el nivel que lo reinicia; los
 * afectados que el ancla no fija se vacían.
 */
export function applySet(scheme: Scheme, state: Ref, set: Record<string, string>): Ref {
  const out: Ref = { ...state }
  const affected = new Set<string>()
  scheme.levels.forEach((l, i) => {
    const r = resetter(scheme, i)
    if (l.key in set) {
      if (set[l.key] !== state[l.key]) affected.add(l.key)
      out[l.key] = set[l.key]!
    } else if (r !== null && affected.has(r)) {
      affected.add(l.key)
      delete out[l.key]
    }
  })
  return out
}

/** Referencia vigente en una posición (las anclas en ese mismo punto ya rigen). */
export function refAt(map: Pick<CanonMap, 'schemes' | 'anchors'>, schemeId: string, pos: Position): Ref {
  const scheme = getScheme(map, schemeId)
  const anchors = anchorsOf(map, schemeId)
  let state: Ref = {}
  let last: Anchor | null = null
  let next: Anchor | null = null
  for (const a of anchors) {
    if (comparePos(a, pos) <= 0) { state = applySet(scheme, state, a.set); last = a }
    else { next = a; break }
  }
  if (last && next) state = interpolate(scheme, state, last, applySet(scheme, state, next.set), next, pos)
  return state
}

/** Coordenada continua para medir distancias entre anclas: hoja + altura. */
function coord(p: Position): number {
  return p.page + p.y
}

function interpolate(scheme: Scheme, cur: Ref, from: Position, nxt: Ref, to: Position, pos: Position): Ref {
  const span = coord(to) - coord(from)
  if (span <= 0) return cur
  const t = Math.min(1, Math.max(0, (coord(pos) - coord(from)) / span))
  const out = { ...cur }
  scheme.levels.forEach((l, i) => {
    if (!l.interpolate || cur[l.key] === undefined || nxt[l.key] === undefined) return
    // Solo dentro del mismo contexto: todos los niveles superiores iguales.
    if (scheme.levels.slice(0, i).some((u) => cur[u.key] !== nxt[u.key])) return
    const a = ordinal(l.values, cur[l.key]!)
    const b = ordinal(l.values, nxt[l.key]!)
    if (a === null || b === null || b <= a) return
    const v = valueAt(l.values, a + Math.floor(t * (b - a)))
    if (v !== null) out[l.key] = v
  })
  return out
}

/** Partes de la referencia en el orden del esquema. */
export function refParts(scheme: Scheme, ref: Ref): RefPart[] {
  return scheme.levels
    .filter((l) => ref[l.key] !== undefined)
    .map((l) => ({ key: l.key, ...(l.label ? { label: l.label } : {}), value: ref[l.key]! }))
}

function partText(scheme: Scheme, key: string, value: string, withLabel: boolean): string {
  const l = scheme.levels.find((x) => x.key === key)!
  return withLabel && l.label ? `${l.label} ${value}` : value
}

function joinParts(scheme: Scheme, parts: { key: string; text: string }[]): string {
  return parts
    .map((p, i) => (i === 0 ? '' : (scheme.levels.find((l) => l.key === p.key)!.sep ?? ' ')) + p.text)
    .join('')
}

/** Texto por omisión de una referencia: «II d. 3 q. 1 n. 29», «327a», «1094a1». */
export function formatRef(scheme: Scheme, ref: Ref): string {
  return joinParts(scheme, refParts(scheme, ref).map((p) => ({ key: p.key, text: partText(scheme, p.key, p.value, true) })))
}

/**
 * Texto por omisión de un rango: lo común una sola vez. «n. 29–31», «327a–c»,
 * «327e–328a», «II d. 3 q. 1 n. 29–q. 2 n. 3».
 */
export function formatRange(scheme: Scheme, a: Ref, b: Ref, dash = '–'): string {
  const first = scheme.levels.findIndex((l) => a[l.key] !== b[l.key])
  if (first < 0) return formatRef(scheme, a)
  const tail = scheme.levels.slice(first).filter((l) => b[l.key] !== undefined)
  if (tail.length === 0) return formatRef(scheme, a)
  // El rótulo del nivel donde diverge se omite si es el último: «n. 29–31», no «n. 29–n. 31».
  const parts = tail.map((l, i) => ({ key: l.key, text: partText(scheme, l.key, b[l.key]!, !(i === 0 && tail.length === 1)) }))
  return formatRef(scheme, a) + dash + joinParts(scheme, parts)
}

export interface Citation {
  scheme: string
  start: RefPart[]
  end: RefPart[]
  /** Texto por omisión; quien cite puede armar el suyo con `start` y `end`. */
  text: string
}

/** Cita de una selección que va de `start` a `end`. `null` si no hay referencia en el inicio. */
export function cite(map: Pick<CanonMap, 'schemes' | 'anchors'>, schemeId: string, start: Position, end: Position): Citation | null {
  const scheme = getScheme(map, schemeId)
  const a = refAt(map, schemeId, start)
  if (Object.keys(a).length === 0) return null
  const b = refAt(map, schemeId, end)
  return { scheme: schemeId, start: refParts(scheme, a), end: refParts(scheme, b), text: formatRange(scheme, a, b) }
}
