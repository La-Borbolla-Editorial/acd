// Pruebas con PDFs reales. Los PDFs tienen derechos: viven en fixtures/private/,
// que git ignora, y estas pruebas se saltan si no están.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { addAnchor, createMap, detect, fromPdfjs, ordinatio, stephanus, type PageBox, type TextItem } from '../src/index.js'

async function pdfItems(path: string): Promise<{ boxes: PageBox[]; items: TextItem[] }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(await readFile(path)), verbosity: 0 }).promise
  const boxes: PageBox[] = []
  const items: TextItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const r = fromPdfjs(p, page.view, (await page.getTextContent()).items)
    boxes.push(r.box)
    items.push(...r.items)
  }
  return { boxes, items }
}

const SPADE = 'fixtures/private/ordinatio-II-3-1.pdf'

// Escoto, Ordinatio II d. 3 p. 1 qq. 1-6, trad. Spade: párrafos «(1)»…«(212)»
// al principio de línea, con errores de OCR. Al PDF le falta el texto de 90-93.
test.skipIf(!existsSync(SPADE))('Ordinatio II d. 3 p. 1 (Spade)', async () => {
  const { boxes, items } = await pdfItems(SPADE)
  const map = addAnchor(createMap([ordinatio]), { scheme: 'ordinatio', page: 1, y: 0, set: { liber: 'II', dist: '3', pars: '1', q: '1' }, origin: 'manual' })
  const c = detect(map, 'ordinatio', boxes, items)
  const ok = c.filter((x) => x.status === 'ok' && x.where !== 'heading').map((x) => Number(x.ref.n))
  const missing = Array.from({ length: 212 }, (_, i) => i + 1).filter((n) => !ok.includes(n))
  expect(missing).toEqual([8, 58, 90, 91, 92, 93, 106])
  expect(ok).toEqual([...ok].sort((a, b) => a - b))
  const corrections = c.filter((x) => x.correction).map((x) => [x.found, x.correction!.set.n])
  expect(corrections).toEqual([['(3)', '8'], ['(53)', '58'], ['(105)', '106']])
  // Cambios de cuestión por los encabezados «[Question 2»…; el número sigue corriendo.
  const questions = c.filter((x) => x.where === 'heading').map((x) => [x.page, x.found, x.text])
  expect(questions).toEqual([
    [12, '[Question 2', 'II d. 3 p. 1 q. 2 n. 42'],
    [16, '[Question 3', 'II d. 3 p. 1 q. 3 n. 57'],
    [18, '[Question 4', 'II d. 3 p. 1 q. 4 n. 65'],
    [35, '[Questions 5', 'II d. 3 p. 1 q. 5 n. 128'],
    [38, '[Question 6', 'II d. 3 p. 1 q. 6 n. 141'],
  ])
  expect(c.find((x) => x.found === '(43)')!.text).toBe('II d. 3 p. 1 q. 2 n. 43')
}, 60_000)

const REPUBLICA = 'fixtures/private/platon-republica.pdf'

// Platón, República (trad. castellana): estudio introductorio que cita pasajes
// con números Stephanus, texto desde la hoja 43 con Stephanus en el margen
// derecho, libros que empiezan con un romano centrado, y notas al final.
test.skipIf(!existsSync(REPUBLICA))('República (Stephanus, libros, estudio introductorio)', async () => {
  const { boxes, items } = await pdfItems(REPUBLICA)
  const map = addAnchor(createMap([stephanus]), { scheme: 'stephanus', page: 43, y: 0.49, set: { book: 'I', page: '327', sect: 'a' }, origin: 'manual' })
  const c = detect(map, 'stephanus', boxes, items)
  const ok = c.filter((x) => x.status === 'ok')
  // Nada del estudio introductorio.
  expect(c.every((x) => x.page >= 43)).toBe(true)
  // Los diez libros (el I lo da el ancla).
  expect(c.filter((x) => x.where === 'heading').map((x) => x.ref.book)).toEqual(['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'])
  // Todas las páginas Stephanus salvo los huecos entre libros.
  const pages = new Set(ok.map((x) => Number(x.ref.page)))
  const missing = Array.from({ length: 621 - 327 + 1 }, (_, i) => 327 + i).filter((p) => !pages.has(p))
  expect(missing).toEqual([355, 356, 384, 385, 418, 446, 447, 448, 481, 482, 483, 512, 513, 542, 570, 593, 594])
  expect(ok.at(-1)!.text).toBe('X, 621d')
  // La única sospechosa: una letra suelta en las notas, lejos del final del texto.
  expect(c.filter((x) => x.status === 'suspicious').map((x) => [x.page, x.found])).toEqual([[586, 'e']])
}, 120_000)
