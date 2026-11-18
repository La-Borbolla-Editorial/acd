// Pruebas con PDFs reales. Los PDFs tienen derechos: viven en fixtures/private/,
// que git ignora, y estas pruebas se saltan si no están.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'
import { addAnchor, createMap, detect, fromPdfjs, ordinatio, type PageBox, type TextItem } from '../src/index.js'

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
