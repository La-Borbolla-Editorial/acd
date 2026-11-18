// Esquemas incluidos. Cada usuario puede definir los suyos con la misma forma.

import type { Scheme } from './types.js'

const LETTERS_AE = ['a', 'b', 'c', 'd', 'e'] as const
const COLUMNS_AB = ['a', 'b'] as const

/**
 * Duns Escoto, Ordinatio (ed. Vaticana): «II d. 3 p. 1 q. 1 n. 29».
 * El número corre a través de partes y cuestiones y se reinicia con la
 * distinción. (Hipótesis a confirmar con la edición.)
 */
export const ordinatio: Scheme = {
  id: 'ordinatio',
  name: 'Duns Escoto, Ordinatio',
  levels: [
    { key: 'liber', values: ['prol.', 'I', 'II', 'III', 'IV'] },
    { key: 'dist', label: 'd.', values: 'arabic' },
    { key: 'pars', label: 'p.', values: 'arabic' },
    { key: 'q', label: 'q.', values: 'arabic' },
    { key: 'n', label: 'n.', values: 'arabic', resetOn: 'dist' },
  ],
  markers: [{ pattern: String.raw`(?:n\.\s*)?(?<n>\d{1,4})` }],
}

/** Platón, paginación de Stephanus: «327a», con línea opcional (Burnet): «327a3». */
export const stephanus: Scheme = {
  id: 'stephanus',
  name: 'Platón, Stephanus',
  levels: [
    { key: 'page', values: 'arabic', resetOn: null },
    { key: 'sect', values: LETTERS_AE, sep: '' },
    { key: 'line', values: 'arabic', sep: '', interpolate: true },
  ],
  markers: [
    { pattern: String.raw`(?<page>\d{1,3})\s*(?<sect>[a-e])` },
    { pattern: String.raw`(?<sect>[a-e])`, where: ['margin'] },
  ],
}

/** Aristóteles, paginación de Bekker: «1094a1». */
export const bekker: Scheme = {
  id: 'bekker',
  name: 'Aristóteles, Bekker',
  levels: [
    { key: 'page', values: 'arabic', resetOn: null },
    { key: 'col', values: COLUMNS_AB, sep: '' },
    { key: 'line', values: 'arabic', sep: '', interpolate: true },
  ],
  markers: [
    { pattern: String.raw`(?<page>\d{2,4})\s*(?<col>[ab])(?:\s*(?<line>\d{1,2}))?` },
    { pattern: String.raw`(?<line>[1-9]\d?)`, where: ['margin'] },
  ],
}

/** Obras numeradas por parágrafos: «§ 43». */
export const paragraphs: Scheme = {
  id: 'paragraphs',
  name: 'Parágrafos (§)',
  levels: [{ key: 'para', label: '§', values: 'arabic', resetOn: null }],
  markers: [{ pattern: String.raw`§\s*(?<para>\d{1,4})` }],
}

export const builtinSchemes: Scheme[] = [ordinatio, stephanus, bekker, paragraphs]
