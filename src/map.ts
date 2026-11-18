// Crear, validar y modificar un mapa canónico.

import { FORMAT, type Anchor, type CanonMap, type Scheme } from './types.js'
import { isValid, normalizeValue } from './values.js'

export function createMap(schemes: Scheme[], pdf?: CanonMap['pdf']): CanonMap {
  return { format: FORMAT, ...(pdf ? { pdf } : {}), schemes, anchors: [] }
}

export function getScheme(map: Pick<CanonMap, 'schemes'>, id: string): Scheme {
  const s = map.schemes.find((x) => x.id === id)
  if (!s) throw new Error(`El mapa no tiene el esquema «${id}».`)
  return s
}

/** Errores del mapa, en castellano; lista vacía si es válido. */
export function validateMap(map: unknown): string[] {
  const errors: string[] = []
  const m = map as Partial<CanonMap> | null
  if (!m || typeof m !== 'object') return ['El mapa no es un objeto.']
  if (m.format !== FORMAT) errors.push(`Formato desconocido: «${String(m.format)}» (se espera «${FORMAT}»).`)
  if (!Array.isArray(m.schemes)) return [...errors, 'Falta la lista de esquemas.']
  if (!Array.isArray(m.anchors)) return [...errors, 'Falta la lista de anclas.']
  const ids = new Set<string>()
  for (const s of m.schemes) {
    if (ids.has(s.id)) errors.push(`Esquema repetido: «${s.id}».`)
    ids.add(s.id)
    const keys = s.levels.map((l) => l.key)
    if (new Set(keys).size !== keys.length) errors.push(`El esquema «${s.id}» repite claves de nivel.`)
    s.levels.forEach((l, i) => {
      if (l.resetOn && keys.indexOf(l.resetOn) < 0) errors.push(`«${s.id}.${l.key}» se reinicia con un nivel que no existe: «${l.resetOn}».`)
      else if (l.resetOn && keys.indexOf(l.resetOn) >= i) errors.push(`«${s.id}.${l.key}» solo puede reiniciarse con un nivel superior.`)
      if (l.interpolate && l.values === 'text') errors.push(`«${s.id}.${l.key}» no se puede interpolar: es texto libre.`)
    })
    for (const mk of s.markers ?? []) {
      try { new RegExp(mk.pattern) } catch { errors.push(`Patrón inválido en «${s.id}»: ${mk.pattern}`) }
    }
  }
  m.anchors.forEach((a, i) => {
    const where = `Ancla ${i + 1}`
    const s = m.schemes!.find((x) => x.id === a.scheme)
    if (!s) return errors.push(`${where}: esquema desconocido «${a.scheme}».`)
    if (!Number.isInteger(a.page) || a.page < 1) errors.push(`${where}: hoja inválida.`)
    if (typeof a.y !== 'number' || a.y < 0 || a.y > 1) errors.push(`${where}: la altura debe ir de 0 a 1.`)
    for (const [k, v] of Object.entries(a.set ?? {})) {
      const l = s.levels.find((x) => x.key === k)
      if (!l) errors.push(`${where}: nivel desconocido «${k}».`)
      else if (!isValid(l.values, v)) errors.push(`${where}: «${v}» no es un valor válido de «${k}».`)
    }
  })
  return errors
}

let counter = 0
function newId(): string {
  counter += 1
  return `a${Date.now().toString(36)}${counter.toString(36)}`
}

/** Añade un ancla normalizando sus valores («ii» → «II»). Lanza si algún valor no vale. */
export function addAnchor(map: CanonMap, anchor: Omit<Anchor, 'id'> & { id?: string }): CanonMap {
  const s = getScheme(map, anchor.scheme)
  const set: Record<string, string> = {}
  for (const [k, v] of Object.entries(anchor.set)) {
    const l = s.levels.find((x) => x.key === k)
    if (!l) throw new Error(`El esquema «${s.id}» no tiene el nivel «${k}».`)
    const n = normalizeValue(l.values, v)
    if (n === null) throw new Error(`«${v}» no es un valor válido de «${k}».`)
    set[k] = n
  }
  return { ...map, anchors: [...map.anchors, { ...anchor, id: anchor.id ?? newId(), set }] }
}

export function removeAnchor(map: CanonMap, id: string): CanonMap {
  return { ...map, anchors: map.anchors.filter((a) => a.id !== id) }
}

export function updateAnchor(map: CanonMap, id: string, patch: Partial<Omit<Anchor, 'id'>>): CanonMap {
  return { ...map, anchors: map.anchors.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
}
