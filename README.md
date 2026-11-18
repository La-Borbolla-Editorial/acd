# acd: auto-canonical-detection

Mapa canónico de un PDF: de un punto del PDF a su **referencia canónica**
(«II d. 3 q. 1 n. 29», «327a», «1094a1»), igual que un lector traduce la hoja del
PDF a la página impresa.

Se hizo para [Organon](https://github.com/La-Borbolla-Editorial/organon), pero
no depende de él ni de ningún lector de PDF.

## Ideas

- **Esquema**: cómo se cita una obra. Es una jerarquía de niveles (libro >
  distinción > cuestión > número), cada uno con sus valores (arábigos, romanos,
  una lista como `a–e`, o texto libre), su rótulo (`d.`, `n.`) y su regla de
  reinicio.
- **Ancla**: «desde este punto del PDF (hoja, altura) rige este valor». Solo
  dice lo que cambia; lo demás se hereda del ancla anterior. Si cambia un nivel
  superior, los inferiores se reinician según `resetOn`.
- **Interpolación**: los niveles con `interpolate` (líneas de Bekker o de
  Burnet) se calculan entre dos anclas por la altura.
- **Cita**: de una selección (inicio y fin) a una cita en **partes
  estructuradas** (`RefPart[]`), más un texto por omisión: `n. 29–31`,
  `327e–328a`.

El mapa es JSON (`format: "acd/0.1"`) y se guarda aparte del PDF, identificado
por su hash.

## Marcado

1. **Manual asistido.** `suggestAt(mapa, esquema, posición)` propone el valor
   siguiente (n. 29 → n. 30; 327e → 328a) y la alternativa de subir el nivel
   superior (q. 1 n. 29 → q. 2 n. 30).
2. **Detección.** `detect(mapa, esquema, hojas, fragmentos)` busca las marcas
   del esquema en el margen, entre corchetes dentro del texto y entre
   paréntesis o corchetes al principio de línea («(29) Ad primum…»). Ignora
   cabeceras y pies, corrige errores típicos del OCR («(I)», «(4!)», «( IE8)») y
   comprueba que la secuencia crezca: lo que la rompe, repite otra marca o
   contradice un ancla manual queda como `suspicious`, con una `correction`
   cuando el hueco la deja clara (entre n. 7 y n. 9, n. 8). Ninguna propuesta
   entra al mapa hasta que se acepta (`acceptCandidates`).

   Con la traducción de Spade de *Ordinatio* II d. 3 p. 1 (55 hojas, 212
   párrafos) detecta 205 de los 208 que tiene el PDF; los otros 3 quedan
   sospechosos con la corrección correcta.

`fromPdfjs` convierte lo que devuelve `page.getTextContent()` de pdf.js a los
fragmentos que espera `detect`.

## Ejemplo

```ts
import { addAnchor, cite, createMap, ordinatio } from 'acd'

let mapa = createMap([ordinatio])
mapa = addAnchor(mapa, { scheme: 'ordinatio', page: 37, y: 0.18, set: { liber: 'II', dist: '3', q: '1', n: '29' }, origin: 'manual' })
mapa = addAnchor(mapa, { scheme: 'ordinatio', page: 38, y: 0.42, set: { n: '30' }, origin: 'manual' })

cite(mapa, 'ordinatio', { page: 37, y: 0.5 }, { page: 38, y: 0.6 })?.text // «II d. 3 q. 1 n. 29–30»
```

## Esquemas incluidos

`ordinatio` (Escoto), `stephanus` (Platón, con línea opcional), `bekker`
(Aristóteles) y `paragraphs` (§). Cada uno es un objeto JSON, así que se pueden
definir otros.

## Pendiente

- Confirmar con la edición Vaticana que el número de la *Ordinatio* se reinicia
  con la distinción, y cómo tratar «q. un.».
- Detectar encabezados estructurales («[Question 2», «Quaestio 2», «§ 43»):
  hoy el cambio de cuestión se marca a mano.
- Hojas a dos columnas en la detección.
- Más PDFs reales. Van en `fixtures/private/`, que git ignora (tienen
  derechos); `test/private.test.ts` se salta si no están.
  `node scripts/pdf-items.mjs archivo.pdf` vuelca los fragmentos de texto
  (requiere `npm run build`).

## Desarrollo

```bash
npm install
npm test
npm run build
```

Licencia MIT.
