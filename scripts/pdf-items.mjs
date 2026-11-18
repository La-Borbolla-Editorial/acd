// Extrae los fragmentos de texto de un PDF con pdf.js, en el formato de `detect`.
// Uso: node scripts/pdf-items.mjs archivo.pdf > items.json
import { readFile } from 'node:fs/promises'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { fromPdfjs } from '../dist/index.js'

export async function pdfItems(path) {
  const data = new Uint8Array(await readFile(path))
  const doc = await getDocument({ data, verbosity: 0 }).promise
  const boxes = []
  const items = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const r = fromPdfjs(p, page.view, tc.items)
    boxes.push(r.box)
    items.push(...r.items)
  }
  return { pages: doc.numPages, boxes, items }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await pdfItems(process.argv[2])
  process.stdout.write(JSON.stringify(r))
}
