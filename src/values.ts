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

// Números escritos en palabras, como aparecen en encabezados: «Libro segundo»,
// «Book Two», «Distinctio tertia». Castellano, inglés y latín, del 1 al 20.
const WORDS: Record<string, number> = {}
function words(n: number, ...ws: string[]) { for (const w of ws) WORDS[w] = n }
words(1, 'primero', 'primer', 'primera', 'uno', 'una', 'one', 'first', 'primus', 'prima', 'primum', 'unus', 'unica', 'unicus')
words(2, 'segundo', 'segunda', 'dos', 'two', 'second', 'secundus', 'secunda', 'secundum', 'duo')
words(3, 'tercero', 'tercer', 'tercera', 'tres', 'three', 'third', 'tertius', 'tertia', 'tertium')
words(4, 'cuarto', 'cuarta', 'cuatro', 'four', 'fourth', 'quartus', 'quarta', 'quartum', 'quattuor')
words(5, 'quinto', 'quinta', 'cinco', 'five', 'fifth', 'quintus', 'quinque')
words(6, 'sexto', 'sexta', 'seis', 'six', 'sixth', 'sextus', 'sex')
words(7, 'séptimo', 'septimo', 'séptima', 'septima', 'siete', 'seven', 'seventh', 'septimus', 'septem')
words(8, 'octavo', 'octava', 'ocho', 'eight', 'eighth', 'octavus', 'octo')
words(9, 'noveno', 'novena', 'nono', 'nueve', 'nine', 'ninth', 'nonus', 'nona', 'novem')
words(10, 'décimo', 'decimo', 'décima', 'decima', 'diez', 'ten', 'tenth', 'decimus', 'decem')
words(11, 'undécimo', 'undecimo', 'decimoprimero', 'once', 'eleven', 'eleventh', 'undecimus', 'undecima')
words(12, 'duodécimo', 'duodecimo', 'decimosegundo', 'doce', 'twelve', 'twelfth', 'duodecimus', 'duodecima')
words(13, 'decimotercero', 'trece', 'thirteen', 'thirteenth', 'tertius decimus')
words(14, 'decimocuarto', 'catorce', 'fourteen', 'fourteenth')
words(15, 'decimoquinto', 'quince', 'fifteen', 'fifteenth')
words(16, 'decimosexto', 'dieciséis', 'dieciseis', 'sixteen', 'sixteenth')
words(17, 'decimoséptimo', 'decimoseptimo', 'diecisiete', 'seventeen', 'seventeenth')
words(18, 'decimoctavo', 'dieciocho', 'eighteen', 'eighteenth')
words(19, 'decimonoveno', 'decimonono', 'diecinueve', 'nineteen', 'nineteenth')
words(20, 'vigésimo', 'vigesimo', 'veinte', 'twenty', 'twentieth', 'vicesimus', 'vicesima')

/** Número escrito en palabras, o `null`. */
export function wordNumber(s: string): number | null {
  return WORDS[s.trim().toLowerCase()] ?? null
}
