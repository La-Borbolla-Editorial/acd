import { expect, test } from 'vitest'
import { acceptCandidates, addAnchor, bekker, createMap, detect, fixOcrDigits, fromPdfjs, wordNumber, ordinatio, refAt, stephanus, type PageBox, type TextItem } from '../src/index.js'

const W = 600
const H = 800
const LOREM = 'Ad primum dico quod ista ratio non concludit propositum'

/** Hoja sintética: cabecera, 30 líneas de cuerpo, número de página al pie y marcas en el margen o en el texto. */
function page(n: number, margin: Record<number, string> = {}, inline: Record<number, string> = {}): TextItem[] {
  const items: TextItem[] = [
    { page: n, str: 'ORDINATIO II, DIST. 3', x: 220, y: 20, width: 160, height: 10 },
    { page: n, str: String(100 + n), x: 295, y: 770, width: 10, height: 10 },
  ]
  for (let i = 0; i < 30; i++) {
    const y = 60 + i * 22
    const indent = i % 7 === 0 ? 20 : 0
    const text = inline[i] ? `${inline[i]} ${LOREM}` : LOREM
    items.push({ page: n, str: text, x: 100 + indent, y, width: 400 - indent, height: 10 })
    if (margin[i]) items.push({ page: n, str: margin[i]!, x: 60, y, width: 18, height: 10 })
  }
  return items
}

const boxes = (n: number): PageBox[] => Array.from({ length: n }, (_, i) => ({ page: i + 1, width: W, height: H }))

function start() {
  return addAnchor(createMap([ordinatio, stephanus]), { scheme: 'ordinatio', page: 1, y: 0, set: { liber: 'II', dist: '3', q: '1', n: '28' }, origin: 'manual' })
}

test('detecta números en el margen e ignora cabecera y pie', () => {
  const items = [...page(1, { 2: '29', 15: '30' }), ...page(2, { 4: '31', 20: '32' })]
  const c = detect(start(), 'ordinatio', boxes(2), items)
  expect(c.map((x) => [x.page, x.text, x.status, x.confidence])).toEqual([
    [1, 'II d. 3 q. 1 n. 29', 'ok', 0.9],
    [1, 'II d. 3 q. 1 n. 30', 'ok', 0.9],
    [2, 'II d. 3 q. 1 n. 31', 'ok', 0.9],
    [2, 'II d. 3 q. 1 n. 32', 'ok', 0.9],
  ])
  expect(c[0]!.y).toBeCloseTo((60 + 2 * 22) / H)
})

test('una marca fuera de secuencia queda como sospechosa y no contamina las siguientes', () => {
  const items = page(1, { 2: '29', 8: '92', 15: '30', 25: '31' })
  const c = detect(start(), 'ordinatio', boxes(1), items)
  expect(c.map((x) => [x.found, x.status])).toEqual([['29', 'ok'], ['92', 'suspicious'], ['30', 'ok'], ['31', 'ok']])
  expect(c[2]!.confidence).toBe(0.9)
})

test('un salto en la numeración baja la confianza', () => {
  const c = detect(start(), 'ordinatio', boxes(1), page(1, { 2: '29', 15: '35' }))
  expect(c.map((x) => x.confidence)).toEqual([0.9, 0.6])
})

test('marcas entre corchetes dentro del texto', () => {
  const c = detect(start(), 'ordinatio', boxes(1), page(1, {}, { 3: 'dicitur [29]', 18: 'patet [n. 30]' }))
  expect(c.map((x) => [x.where, x.text, x.confidence])).toEqual([
    ['inline', 'II d. 3 q. 1 n. 29', 1],
    ['inline', 'II d. 3 q. 1 n. 30', 1],
  ])
})

test('marcas al principio de línea, entre paréntesis o corchetes; a media línea, los paréntesis no cuentan', () => {
  const c = detect(start(), 'ordinatio', boxes(1), page(1, {}, { 3: '(29)', 10: 'ut dictum est (31)', 18: '[30]' }))
  expect(c.map((x) => [x.where, x.found, x.text])).toEqual([
    ['lineStart', '(29)', 'II d. 3 q. 1 n. 29'],
    ['lineStart', '[30]', 'II d. 3 q. 1 n. 30'],
  ])
})

test('errores típicos del OCR en los números', () => {
  expect(fixOcrDigits('(I) With Distinction 3')).toBe('(1) With Distinction 3')
  expect(fixOcrDigits('(4!) From what')).toBe('(41) From what')
  expect(fixOcrDigits('([19) I do not')).toBe('(119) I do not')
  expect(fixOcrDigits('( IE8) Therefore')).toBe('(188) Therefore')
  expect(fixOcrDigits('(13E)The same')).toBe('(138)The same')
  expect(fixOcrDigits('l2')).toBe('12')
  // No toca lo que no parece un número.
  expect(fixOcrDigits('(SE) y (Is)')).toBe('(SE) y (Is)')
  const c = detect(start(), 'ordinatio', boxes(1), page(1, {}, { 3: '(29)', 10: '(3O)The', 18: '(3l)' }))
  expect(c.map((x) => x.text)).toEqual(['II d. 3 q. 1 n. 29', 'II d. 3 q. 1 n. 30', 'II d. 3 q. 1 n. 31'])
})

test('una marca repetida es sospechosa y se propone el valor del hueco', () => {
  const c = detect(start(), 'ordinatio', boxes(1), page(1, {}, { 3: '(29)', 10: '(29)', 18: '(31)', 22: '(3)', 26: '(33)' }))
  expect(c.map((x) => [x.found, x.status, x.correction?.text])).toEqual([
    ['(29)', 'ok', undefined],
    ['(29)', 'suspicious', 'II d. 3 q. 1 n. 30'],
    ['(31)', 'ok', undefined],
    ['(3)', 'suspicious', 'II d. 3 q. 1 n. 32'],
    ['(33)', 'ok', undefined],
  ])
})

test('una marca que contradice un ancla manual es sospechosa', () => {
  let m = start()
  m = addAnchor(m, { scheme: 'ordinatio', page: 1, y: 0.5, set: { n: '40' }, origin: 'manual' })
  const c = detect(m, 'ordinatio', boxes(1), page(1, { 2: '29', 25: '35', 28: '41' }))
  expect(c.map((x) => [x.found, x.status])).toEqual([['29', 'ok'], ['35', 'suspicious'], ['41', 'ok']])
})

test('las marcas que repiten lo vigente se omiten; aceptar las añade al mapa', () => {
  const m = start()
  const c = detect(m, 'ordinatio', boxes(1), page(1, { 1: '28', 5: '29' }))
  expect(c.map((x) => x.found)).toEqual(['29'])
  const after = acceptCandidates(m, c)
  expect(refAt(after, 'ordinatio', { page: 1, y: 0.9 })).toMatchObject({ n: '29' })
})

test('Stephanus: página y letra, y luego solo letras', () => {
  const m = createMap([stephanus])
  const c = detect(m, 'stephanus', boxes(2), [...page(1, { 0: '327a', 10: 'b', 20: 'c' }), ...page(2, { 5: 'd', 15: 'e', 25: '328a' })])
  expect(c.map((x) => x.text)).toEqual(['327a', '327b', '327c', '327d', '327e', '328a'])
  expect(c.every((x) => x.status === 'ok')).toBe(true)
})

test('adaptador de pdf.js: origen abajo → arriba', () => {
  const { box, items } = fromPdfjs(3, [0, 0, 600, 800], [
    { str: '29', transform: [10, 0, 0, 10, 60, 700], width: 12, height: 10 },
    { type: 'beginMarkedContent' },
  ])
  expect(box).toEqual({ page: 3, width: 600, height: 800 })
  expect(items).toEqual([{ page: 3, str: '29', x: 60, y: 90, width: 12, height: 10 }])
})

/** Hoja con encabezados: `heads` va de número de línea a [texto, alto de letra, x]. */
function pageWithHeadings(n: number, heads: Record<number, [string, number, number]>, inline: Record<number, string> = {}): TextItem[] {
  const items = page(n, {}, inline).filter((it) => !Object.keys(heads).some((i) => it.y === 60 + Number(i) * 22))
  for (const [i, [str, h, x]] of Object.entries(heads)) items.push({ page: n, str, x, y: 60 + Number(i) * 22, width: str.length * 6, height: h })
  return items
}

test('encabezados: cambian la cuestión y el número sigue corriendo', () => {
  const items = pageWithHeadings(1, { 8: ['[Question 2', 14, 260] }, { 2: '(29)', 12: '(30)' })
  const c = detect(start(), 'ordinatio', boxes(1), items)
  expect(c.map((x) => [x.where, x.text])).toEqual([
    ['lineStart', 'II d. 3 q. 1 n. 29'],
    ['heading', 'II d. 3 q. 2 n. 29'],
    ['lineStart', 'II d. 3 q. 2 n. 30'],
  ])
})

test('encabezados en romanos, en latín, partidos en dos fragmentos o sin número legible', () => {
  const items = [
    ...pageWithHeadings(1, { 5: ['QUAESTIO II', 14, 250], 15: ['[Question', 14, 250] }),
    // El número en otro cuerpo de letra, en su propio fragmento.
    { page: 1, str: '3', x: 310, y: 60 + 15 * 22 + 2, width: 5, height: 8 },
    ...pageWithHeadings(2, { 5: ['[Question ?', 14, 250] }),
  ]
  const c = detect(start(), 'ordinatio', boxes(2), items)
  expect(c.map((x) => [x.page, x.found, x.ref.q, x.confidence])).toEqual([
    [1, 'QUAESTIO II', '2', 1],
    [1, '[Question 3', '3', 1],
    [2, '[Question', '4', 0.5],
  ])
})

test('una línea del cuerpo que empieza con «Question» no es encabezado; un encabezado repetido sobra', () => {
  const items = pageWithHeadings(1, { 4: ['[Questions 5 and 6', 14, 230], 6: ['Question 5', 11, 270] }, { 10: 'Question 6 is harder than it looks' })
  const c = detect(start(), 'ordinatio', boxes(1), items)
  expect(c.map((x) => [x.found, x.ref.q])).toEqual([['[Questions 5', '5']])
})

test('una distinción nueva reinicia cuestión y número', () => {
  const items = pageWithHeadings(1, { 8: ['DISTINCTIO 4', 14, 260], 10: ['QUAESTIO 1', 14, 260] }, { 2: '(29)', 12: '(1)' })
  const c = detect(start(), 'ordinatio', boxes(1), items)
  expect(c.map((x) => x.text)).toEqual(['II d. 3 q. 1 n. 29', 'II d. 4', 'II d. 4 q. 1', 'II d. 4 q. 1 n. 1'])
  expect(c.every((x) => x.status === 'ok')).toBe(true)
})

test('una marca en la misma línea que un ancla manual que dice lo mismo sobra', () => {
  // El ancla manual, un poco por debajo de la marca impresa (29).
  const m = addAnchor(createMap([ordinatio]), { scheme: 'ordinatio', page: 1, y: (60 + 2 * 22 + 6) / H, set: { liber: 'II', dist: '3', q: '1', n: '29' }, origin: 'manual' })
  const c = detect(m, 'ordinatio', boxes(1), page(1, {}, { 2: '(29)', 10: '(30)' }))
  expect(c.map((x) => x.found)).toEqual(['(30)'])
})

test('al volver a detectar sobre un mapa con anclas: lo corregido no reaparece y las correcciones usan las anclas', () => {
  const items = page(1, {}, { 2: '(29)', 6: '(3)', 10: '(31)', 14: '(53)', 18: '(33)' })
  let m = start()
  // Ya aceptadas: 29, 31 y 33, y la corrección de «(3)» como 30.
  for (const [line, n] of [[2, '29'], [6, '30'], [10, '31'], [18, '33']] as const) {
    m = addAnchor(m, { scheme: 'ordinatio', page: 1, y: (60 + line * 22) / H, set: { n }, origin: 'detected' })
  }
  const c = detect(m, 'ordinatio', boxes(1), items)
  expect(c.map((x) => [x.found, x.status, x.correction?.set.n])).toEqual([['(53)', 'suspicious', '32']])
})

test('la detección empieza en la primera ancla y se detiene en un ancla de fin', () => {
  const intro = page(1, { 3: '328c', 12: '331c' }) // estudio introductorio que cita la República
  const text = page(2, { 2: '327a', 10: 'b', 20: 'c' })
  const notes = page(3, { 5: 'e' })
  let m = addAnchor(createMap([stephanus]), { scheme: 'stephanus', page: 2, y: 0.05, set: { book: 'I' }, origin: 'manual' })
  m = addAnchor(m, { scheme: 'stephanus', page: 3, y: 0, set: {}, origin: 'manual', stop: true })
  const c = detect(m, 'stephanus', boxes(3), [...intro, ...text, ...notes])
  expect(c.map((x) => [x.page, x.text])).toEqual([[2, 'I, 327a'], [2, 'I, 327b'], [2, 'I, 327c']])
  // Sin anclas, todo el PDF.
  expect(detect(createMap([stephanus]), 'stephanus', boxes(3), [...intro, ...text]).length).toBe(5)
})

test('una marca aislada muy lejos de la anterior es sospechosa', () => {
  const items = [...page(1, { 2: '621a', 10: 'b', 20: 'c' }), ...page(30, { 5: 'd' })]
  const c = detect(createMap([stephanus]), 'stephanus', boxes(30), items)
  expect(c.map((x) => [x.page, x.status])).toEqual([[1, 'ok'], [1, 'ok'], [1, 'ok'], [30, 'suspicious']])
})

test('encabezados de libro y capítulo, también en palabras', () => {
  const items = [
    ...pageWithHeadings(1, { 3: ['LIBRO SEGUNDO', 14, 250], 8: ['Capítulo tercero', 14, 250], 14: ['Chapter 4', 14, 250] }),
    { page: 1, str: '1003a', x: 560, y: 60 + 10 * 22, width: 25, height: 10 },
    // Un centrado que no es número no es encabezado.
    ...pageWithHeadings(2, { 3: ['Libro de los muertos', 14, 230], 9: ['IV', 14, 295] }),
  ]
  const c = detect(createMap([bekker]), 'bekker', boxes(2), items)
  expect(c.map((x) => [x.found, x.text])).toEqual([
    ['LIBRO SEGUNDO', 'II'],
    ['Capítulo tercero', 'II 3'],
    ['1003a', 'II 3, 1003a'],
    ['Chapter 4', 'II 4, 1003a'],
    ['IV', 'IV, 1003a'],
  ])
  expect(wordNumber('Décimo')).toBe(10)
  expect(wordNumber('tertia')).toBe(3)
})
