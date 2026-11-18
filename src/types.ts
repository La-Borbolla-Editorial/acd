// Formato del mapa canónico de un PDF.
//
// Un ESQUEMA describe cómo se cita una obra: una jerarquía de niveles
// (libro > distinción > cuestión > número; página Bekker > columna > línea).
// Un ANCLA dice: «desde este punto del PDF rige este valor» para uno o más
// niveles. Lo que el ancla no dice se hereda del ancla anterior, salvo que un
// nivel superior haya cambiado y el inferior se reinicie (ver `Level.resetOn`).
//
// Todo es JSON serializable: un mapa se guarda junto al PDF y se identifica por
// su hash.

/**
 * Valores que admite un nivel:
 * - `arabic`: 1, 2, 3…
 * - `roman` / `ROMAN`: i, ii… / I, II…
 * - una lista: valores enumerados en orden (['a','b','c','d','e'] en Stephanus).
 * - `text`: texto libre, sin orden (no se puede sugerir ni detectar secuencia).
 */
export type ValueKind = 'arabic' | 'roman' | 'ROMAN' | 'text' | readonly string[]

export interface Level {
  /** Clave del nivel en las anclas y referencias: `n`, `dist`, `line`. */
  key: string
  /** Rótulo que se antepone al valor al escribir la cita: `d.`, `n.`, `§`. */
  label?: string
  values: ValueKind
  /** Separador antes de este nivel al escribir la cita. Por omisión, un espacio. */
  sep?: string
  /**
   * Nivel cuyo cambio reinicia este. Por omisión, el nivel inmediatamente
   * superior. Un nivel superior más alto permite numeraciones continuas: en la
   * Ordinatio el número corre a través de las cuestiones y se reinicia con la
   * distinción (`resetOn: 'dist'`). `null`: no se reinicia nunca.
   */
  resetOn?: string | null
  /**
   * Interpolar entre dos anclas por la posición vertical: si una ancla dice
   * «línea 5» y la siguiente «línea 10», a medio camino rige la 7. Solo para
   * niveles ordenados.
   */
  interpolate?: boolean
}

/**
 * Patrón para detectar marcas impresas de este esquema en el PDF. `pattern` es
 * el código de una expresión regular con grupos con nombre iguales a las claves
 * de los niveles: `n\.\s*(?<n>\d+)`.
 */
export interface Marker {
  pattern: string
  /**
   * Dónde buscarlo. Por omisión, todos:
   * - `margin`: el fragmento entero, fuera del cuerpo del texto («29», «327a»).
   * - `inline`: entre corchetes en cualquier punto del texto («[29]»).
   * - `lineStart`: entre corchetes o paréntesis al principio de una línea
   *   («(29) Ad primum…»). Los paréntesis solo cuentan ahí: a media línea
   *   suelen ser otra cosa.
   */
  where?: MarkerPlace[]
}

export type MarkerPlace = 'margin' | 'inline' | 'lineStart'

/**
 * Encabezado que abre una división de la obra: «[Question 2», «QUAESTIO II»,
 * «Distinctio 3». `pattern` se busca al principio de una línea que parezca
 * encabezado (letra más grande que el cuerpo, o línea corta y centrada), sin
 * distinguir mayúsculas. Puede tener un grupo con nombre igual a `level`; si
 * no lo tiene o el número no se lee, se toma el valor siguiente al vigente.
 */
export interface Heading {
  level: string
  pattern: string
}

export interface Scheme {
  id: string
  name: string
  levels: Level[]
  markers?: Marker[]
  headings?: Heading[]
}

/** Punto del PDF: hoja (desde 1) y altura relativa desde arriba (0 a 1). */
export interface Position {
  page: number
  y: number
  /** Columna en hojas a dos columnas (0, 1…). Por omisión, 0. */
  column?: number
}

export interface Anchor extends Position {
  id?: string
  scheme: string
  /** Valores que fija esta ancla, por clave de nivel. */
  set: Record<string, string>
  origin: 'manual' | 'detected'
  /** Confianza de la detección, de 0 a 1. */
  confidence?: number
}

export const FORMAT = 'acd/0.1'

export interface CanonMap {
  format: typeof FORMAT
  pdf?: { sha256?: string; fingerprint?: string; pages?: number }
  schemes: Scheme[]
  anchors: Anchor[]
}

/** Referencia canónica: valor por clave de nivel. Los niveles sin valor no aparecen. */
export type Ref = Record<string, string>

/** Una parte de la referencia, en el orden del esquema. */
export interface RefPart {
  key: string
  label?: string
  value: string
}
