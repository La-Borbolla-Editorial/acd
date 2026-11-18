// Método 1: al marcar a mano, proponer el valor siguiente.

import { getScheme } from './map.js'
import { applySet, formatRef, refAt } from './resolve.js'
import type { CanonMap, Position, Ref, Scheme } from './types.js'
import { firstValue, nextValue } from './values.js'

export interface Suggestion {
  /** Valores que fijaría el ancla nueva. */
  set: Record<string, string>
  /** Referencia completa que regiría desde ahí. */
  ref: Ref
  text: string
  /** `next`: el nivel más bajo sube uno. `parent`: sube el nivel de arriba. */
  kind: 'next' | 'parent'
}

/** Nivel más bajo con valor en la referencia, o -1. */
function deepest(scheme: Scheme, ref: Ref): number {
  for (let i = scheme.levels.length - 1; i >= 0; i--) if (ref[scheme.levels[i]!.key] !== undefined) return i
  return -1
}

/**
 * Sube el nivel `i` en uno. Si se desborda (327e), sube el de arriba y el
 * nivel vuelve a su primer valor (328a). Los niveles inferiores que se
 * reinician quedan vacíos.
 */
function bump(scheme: Scheme, state: Ref, i: number): Record<string, string> | null {
  const l = scheme.levels[i]!
  const cur = state[l.key]
  if (cur === undefined) return null
  const n = nextValue(l.values, cur)
  if (!n) return null
  if (!n.overflow) return { [l.key]: n.value }
  if (i === 0) return null
  const up = bump(scheme, state, i - 1)
  return up ? { ...up, [l.key]: n.value } : null
}

/** Propuestas para un ancla nueva en `pos`, la más probable primero. */
export function suggestAt(map: Pick<CanonMap, 'schemes' | 'anchors'>, schemeId: string, pos: Position): Suggestion[] {
  const scheme = getScheme(map, schemeId)
  const state = refAt(map, schemeId, pos)
  const out: Suggestion[] = []
  const add = (set: Record<string, string> | null, kind: Suggestion['kind']) => {
    if (!set) return
    const ref = applySet(scheme, state, set)
    const text = formatRef(scheme, ref)
    if (!out.some((s) => s.text === text)) out.push({ set, ref, text, kind })
  }

  const d = deepest(scheme, state)
  if (d < 0) {
    // Mapa vacío: proponer el primer valor del primer nivel ordenado.
    const l = scheme.levels[0]
    const v = l && firstValue(l.values)
    if (l && v) add({ [l.key]: v }, 'next')
    return out
  }

  add(bump(scheme, state, d), 'next')

  // Subir el nivel de arriba con valor: los inferiores que se reinician
  // empiezan en su primer valor; el más bajo, si no se reinicia, sigue.
  for (let p = d - 1; p >= 0; p--) {
    if (state[scheme.levels[p]!.key] === undefined) continue
    const up = bump(scheme, state, p)
    if (!up) break
    const after = applySet(scheme, state, up)
    const set = { ...up }
    for (let i = p + 1; i <= d; i++) {
      const l = scheme.levels[i]!
      if (state[l.key] === undefined) continue
      if (after[l.key] === undefined) {
        const f = firstValue(l.values)
        if (f !== null) set[l.key] = f
      } else if (i === d) {
        const n = nextValue(l.values, after[l.key]!)
        if (n && !n.overflow) set[l.key] = n.value
      }
    }
    add(set, 'parent')
    break
  }
  return out
}
