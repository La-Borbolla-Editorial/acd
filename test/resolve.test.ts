import { expect, test } from 'vitest'
import { addAnchor, bekker, cite, createMap, formatRange, ordinatio, parseRef, refAt, stephanus, suggestAt, validateMap, type CanonMap } from '../src/index.js'

function ord(...anchors: [number, number, Record<string, string>][]): CanonMap {
  let m = createMap([ordinatio, stephanus, bekker])
  for (const [page, y, set] of anchors) m = addAnchor(m, { scheme: 'ordinatio', page, y, set, origin: 'manual' })
  return m
}

test('se hereda lo que el ancla no dice', () => {
  const m = ord([10, 0.2, { liber: 'II', dist: '3', pars: '1', q: '1', n: '1' }], [10, 0.6, { n: '2' }], [11, 0.1, { n: '3' }])
  expect(refAt(m, 'ordinatio', { page: 10, y: 0.1 })).toEqual({})
  expect(refAt(m, 'ordinatio', { page: 10, y: 0.2 })).toEqual({ liber: 'II', dist: '3', pars: '1', q: '1', n: '1' })
  expect(refAt(m, 'ordinatio', { page: 10, y: 0.9 })).toMatchObject({ n: '2' })
  expect(refAt(m, 'ordinatio', { page: 12, y: 0.5 })).toMatchObject({ q: '1', n: '3' })
})

test('Ordinatio: el número sigue a través de las cuestiones y se reinicia con la distinción', () => {
  const m = ord([1, 0.1, { liber: 'II', dist: '3', q: '1', n: '29' }], [2, 0.1, { q: '2' }], [3, 0.1, { dist: '4' }])
  expect(refAt(m, 'ordinatio', { page: 2, y: 0.5 })).toEqual({ liber: 'II', dist: '3', q: '2', n: '29' })
  expect(refAt(m, 'ordinatio', { page: 3, y: 0.5 })).toEqual({ liber: 'II', dist: '4' })
})

test('valores normalizados y validación', () => {
  const m = ord([1, 0.1, { liber: 'ii', dist: '3' }])
  expect(m.anchors[0]!.set.liber).toBe('II')
  expect(validateMap(m)).toEqual([])
  expect(() => ord([1, 0.1, { dist: 'tres' }])).toThrow(/no es un valor válido/)
  expect(validateMap({ ...m, anchors: [{ ...m.anchors[0]!, y: 2 }] })).toEqual(['Ancla 1: la altura debe ir de 0 a 1.'])
})

test('cita de una selección, en partes y en texto', () => {
  const m = ord([1, 0.1, { liber: 'II', dist: '3', q: '1', n: '29' }], [1, 0.5, { n: '30' }], [2, 0.3, { n: '31' }])
  const c = cite(m, 'ordinatio', { page: 1, y: 0.2 }, { page: 2, y: 0.4 })!
  expect(c.text).toBe('II d. 3 q. 1 n. 29–31')
  expect(c.start).toEqual([
    { key: 'liber', value: 'II' }, { key: 'dist', label: 'd.', value: '3' },
    { key: 'q', label: 'q.', value: '1' }, { key: 'n', label: 'n.', value: '29' },
  ])
  expect(cite(m, 'ordinatio', { page: 1, y: 0.2 }, { page: 1, y: 0.3 })!.text).toBe('II d. 3 q. 1 n. 29')
  expect(cite(m, 'ordinatio', { page: 1, y: 0.05 }, { page: 1, y: 0.3 })).toBeNull()
})

test('rangos', () => {
  expect(formatRange(stephanus, { page: '327', sect: 'a' }, { page: '327', sect: 'c' })).toBe('327a–c')
  expect(formatRange(stephanus, { page: '327', sect: 'e' }, { page: '328', sect: 'a' })).toBe('327e–328a')
  expect(formatRange(bekker, { page: '1094', col: 'a', line: '1' }, { page: '1094', col: 'a', line: '10' })).toBe('1094a1–10')
  expect(formatRange(ordinatio, { liber: 'II', dist: '3', q: '1', n: '29' }, { liber: 'II', dist: '3', q: '2', n: '33' })).toBe('II d. 3 q. 1 n. 29–q. 2 n. 33')
})

test('interpolación hasta la línea', () => {
  let m = createMap([bekker])
  m = addAnchor(m, { scheme: 'bekker', page: 5, y: 0.1, set: { page: '1094', col: 'a', line: '1' }, origin: 'manual' })
  m = addAnchor(m, { scheme: 'bekker', page: 5, y: 0.5, set: { line: '11' }, origin: 'manual' })
  m = addAnchor(m, { scheme: 'bekker', page: 6, y: 0.1, set: { col: 'b', line: '1' }, origin: 'manual' })
  expect(refAt(m, 'bekker', { page: 5, y: 0.3 })).toEqual({ page: '1094', col: 'a', line: '6' })
  // No se interpola a través de un cambio de columna.
  expect(refAt(m, 'bekker', { page: 5, y: 0.9 })).toEqual({ page: '1094', col: 'a', line: '11' })
  expect(cite(m, 'bekker', { page: 5, y: 0.1 }, { page: 5, y: 0.3 })!.text).toBe('1094a1–6')
})

test('sugerencias al marcar a mano', () => {
  const m = ord([1, 0.1, { liber: 'II', dist: '3', q: '1', n: '29' }])
  expect(suggestAt(m, 'ordinatio', { page: 1, y: 0.5 }).map((s) => [s.text, s.set])).toEqual([
    ['II d. 3 q. 1 n. 30', { n: '30' }],
    ['II d. 3 q. 2 n. 30', { q: '2', n: '30' }],
  ])
  let s = createMap([stephanus])
  s = addAnchor(s, { scheme: 'stephanus', page: 1, y: 0.1, set: { page: '327', sect: 'e' }, origin: 'manual' })
  expect(suggestAt(s, 'stephanus', { page: 1, y: 0.5 })[0]!.text).toBe('328a')
  expect(suggestAt(createMap([ordinatio]), 'ordinatio', { page: 1, y: 0 })[0]!.text).toBe('prol.')
})

test('leer una referencia escrita a mano', () => {
  expect(parseRef(ordinatio, 'n. 30')).toEqual({ n: '30' })
  expect(parseRef(ordinatio, 'ii d.3 q. 2 n.30')).toEqual({ liber: 'II', dist: '3', q: '2', n: '30' })
  expect(parseRef(ordinatio, 'prol. p. 1 q. 1')).toEqual({ liber: 'prol.', pars: '1', q: '1' })
  expect(parseRef(stephanus, '328a')).toEqual({ page: '328', sect: 'a' })
  expect(parseRef(stephanus, '327 c 4')).toEqual({ page: '327', sect: 'c', line: '4' })
  expect(parseRef(bekker, '1094a1')).toEqual({ page: '1094', col: 'a', line: '1' })
  expect(parseRef(ordinatio, 'q. dos')).toBeNull()
  expect(parseRef(ordinatio, '')).toBeNull()
})
