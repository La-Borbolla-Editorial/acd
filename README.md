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
- **Fin del texto**: un ancla con `stop: true` dice «desde aquí no rige nada»
  (notas, índices) hasta el ancla siguiente.
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

   También reconoce **encabezados** que abren una división («[Question 2»,
   «QUAESTIO II», «Distinctio 4»): líneas cortas, con letra más grande o
   centradas, que empiezan con un patrón del esquema (`headings`). Si el número
   no se lee, toma el siguiente al vigente, con menos confianza.

   **Solo busca dentro del texto**: si el mapa tiene anclas, desde la primera
   (así se salta un estudio introductorio que cita pasajes) y nunca después de
   un ancla de fin. Una marca aislada a más de 20 hojas de la anterior queda
   sospechosa.

   Con la traducción de Spade de *Ordinatio* II d. 3 p. 1 (55 hojas, 212
   párrafos) detecta 205 de los 208 que tiene el PDF; los otros 3 quedan
   sospechosos con la corrección correcta. Detecta además los cinco cambios de
   cuestión. Con una *República* en castellano (667 hojas), marcando solo el
   comienzo del texto, detecta todas las páginas Stephanus y los diez libros,
   sin una sola sospechosa en el estudio introductorio.

`fromPdfjs` convierte lo que devuelve `page.getTextContent()` de pdf.js a los
fragmentos que espera `detect`.

## Visor de prueba

```bash
npm run demo
```

Abre <http://localhost:5181>. Arrastra un PDF, o pásalo por la URL:
`?pdf=/@fs/<ruta absoluta al PDF>`. En el visor:

- **Detectar** propone anclas en el margen de cada hoja: verdes las seguras,
  naranjas las sospechosas (con su corrección, si la hay). Un clic en una para
  aceptarla, corregirla o descartarla; **Aceptar las seguras** acepta de una vez
  las de confianza alta.
- **Marcar** (tecla M): clic a la altura donde empieza un lugar; el campo trae
  el valor siguiente y se escribe como se cita («n. 30», «II d. 3 q. 2»,
  «328a»).
- Al **seleccionar texto** aparece su cita abajo; al pasar el ratón, lo que
  rige en ese punto.
- El mapa se guarda en el navegador, asociado al PDF, y se puede descargar o
  cargar como JSON.

`parseRef(esquema, texto)` es lo que lee lo que se escribe a mano.

## Ejemplo

```ts
import { addAnchor, cite, createMap, ordinatio } from 'acd'

let mapa = createMap([ordinatio])
mapa = addAnchor(mapa, { scheme: 'ordinatio', page: 37, y: 0.18, set: { liber: 'II', dist: '3', q: '1', n: '29' }, origin: 'manual' })
mapa = addAnchor(mapa, { scheme: 'ordinatio', page: 38, y: 0.42, set: { n: '30' }, origin: 'manual' })

cite(mapa, 'ordinatio', { page: 37, y: 0.5 }, { page: 38, y: 0.6 })?.text // «II d. 3 q. 1 n. 29–30»
```

## Esquemas incluidos

`ordinatio` (Escoto), `stephanus` (Platón: libro opcional y línea opcional,
«II, 368a»), `bekker` (Aristóteles: libro y capítulo opcionales, «IV 2,
1003a33») y `paragraphs` (§). Los encabezados de libro y capítulo se reconocen
también con el número en palabras («Libro segundo», «Chapter Four»). Cada uno es un objeto JSON, así que se pueden
definir otros.

## Pendiente

- Confirmar con la edición Vaticana que el número de la *Ordinatio* se reinicia
  con la distinción, y cómo tratar «q. un.».
- Libros de la *Metafísica* con letras griegas (Α, α, Β…): hoy, un esquema
  propio con esos valores.
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
