// Valores de un nivel: orden, primero y siguiente.

import type { ValueKind } from './types.js'

const ROMAN: [number, string][] = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n)
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v }
  return out
}

export function fromRoman(s: string): number | null {
  const t = s.toLowerCase()
  if (!/^[ivxlcdm]+$/.test(t)) return null
  let n = 0
  let i = 0
  for (const [v, sym] of ROMAN) while (t.startsWith(sym, i)) { n += v; i += sym.length }
  return i === t.length && toRoman(n) === t ? n : null
}

/** Posición del valor en el orden del nivel, o `null` si no es válido o no tiene orden. */
export function ordinal(kind: ValueKind, value: string): number | null {
  if (kind === 'text') return null
  if (kind === 'arabic') return /^\d+$/.test(value) ? Number(value) : null
  if (kind === 'roman' || kind === 'ROMAN') return fromRoman(value)
  const i = kind.indexOf(value)
  return i < 0 ? null : i
}

/** Valor en una posición del orden, o `null` si no existe. */
export function valueAt(kind: ValueKind, ord: number): string | null {
  if (kind === 'text' || !Number.isInteger(ord)) return null
  if (kind === 'arabic') return ord >= 0 ? String(ord) : null
  if (kind === 'roman') return ord >= 1 ? toRoman(ord) : null
  if (kind === 'ROMAN') return ord >= 1 ? toRoman(ord).toUpperCase() : null
  return kind[ord] ?? null
}

export function isValid(kind: ValueKind, value: string): boolean {
  return kind === 'text' ? value.trim() !== '' : ordinal(kind, value) !== null
}

export function firstValue(kind: ValueKind): string | null {
  if (kind === 'text') return null
  return Array.isArray(kind) ? (kind[0] ?? null) : valueAt(kind, 1)
}

/** Valor siguiente; `overflow` si es el último de una lista (327e → hay que pasar a 328a). */
export function nextValue(kind: ValueKind, value: string): { value: string; overflow: boolean } | null {
  const o = ordinal(kind, value)
  if (o === null) return null
  const next = valueAt(kind, o + 1)
  if (next !== null) return { value: next, overflow: false }
  const first = firstValue(kind)
  return first === null ? null : { value: first, overflow: true }
}

/** Normaliza lo que se escribe o se lee en el PDF: «ii» en un nivel `ROMAN` → «II». */
export function normalizeValue(kind: ValueKind, value: string): string | null {
  const v = value.trim()
  if (kind === 'text') return v || null
  if (Array.isArray(kind)) return kind.includes(v) ? v : (kind.find((k) => k.toLowerCase() === v.toLowerCase()) ?? null)
  const o = kind === 'arabic' ? ordinal(kind, v) : fromRoman(v)
  return o === null ? null : valueAt(kind, o)
}
