// Adaptador para pdf.js sin depender de él: basta la forma de lo que devuelve
// `page.getTextContent()` y el tamaño de la hoja (`page.view` o el viewport a escala 1).

import type { PageBox, TextItem } from './detect.js'

/** Lo que importa de un elemento de `getTextContent().items` en pdf.js. */
export interface PdfjsTextItem {
  str: string
  /** Matriz [a, b, c, d, e, f]: (e, f) es el origen de la línea base, con origen ABAJO a la izquierda. */
  transform: number[]
  width: number
  height: number
}

/**
 * Convierte el texto de una hoja de pdf.js a fragmentos con origen arriba a la
 * izquierda. `view` es `page.view`: [x0, y0, x1, y1] en unidades del PDF.
 */
export function fromPdfjs(page: number, view: number[], items: (PdfjsTextItem | { type: string })[]): { box: PageBox; items: TextItem[] } {
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = view
  const box: PageBox = { page, width: x1 - x0, height: y1 - y0 }
  const out: TextItem[] = []
  for (const it of items) {
    if (!('str' in it)) continue // marcadores de contenido
    const t = it.transform
    const h = it.height || Math.hypot(t[2] ?? 0, t[3] ?? 0)
    out.push({ page, str: it.str, x: (t[4] ?? 0) - x0, y: y1 - (t[5] ?? 0) - h, width: it.width, height: h })
  }
  return { box, items: out }
}
