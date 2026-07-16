# Tarea movil de ChatGPT para facturas

Configura una tarea programada diaria, preferiblemente de madrugada, con el
siguiente texto completo.

---

Revisa las facturas nuevas de Esencia Cafe y prepara un lote JSON para el TPV.

FUENTES:
- Drive, carpeta Esencia Cafe:
  https://drive.google.com/drive/folders/1V_M9XZWYgbGKDF7n5uT9mXNDOgJ1rcT_
- Dentro del ano actual revisa PENDIENTE CONTABILIZAR, las carpetas de meses,
  los archivos sueltos del mes y su carpeta Facturas.
- Ignora Cierres y cualquier carpeta o archivo de cierre de caja o datafono.
- Gmail: usa solamente la cuenta esenciacafe.galletas@gmail.com y busca durante
  los ultimos 45 dias adjuntos PDF o imagen que parezcan facturas.

CONTROL DE PROCESADOS:
- Antes de analizar documentos, lee todos los JSON existentes en:
  PENDIENTES: https://drive.google.com/drive/folders/1s1n2kmt7bDfgSoSiVAlN0RD81tFK7-_g
  PROCESADOS: https://drive.google.com/drive/folders/1mqmHreoUCREnvUj6dOWo2P0k_-XPw3VE
- Reune tanto los `sourceId` de `invoices` como los valores de cualquier array
  `sourceIds`. Reune tambien cada pareja normalizada `supplierName` +
  `invoiceNumber` de los manifiestos y lotes ya procesados.
- No vuelvas a incluir un archivo o adjunto cuyo `sourceId` ya exista. Si el
  identificador no estaba disponible anteriormente, no incluyas la factura si
  coincide proveedor + numero de factura con una ya registrada.
- Procesa como maximo 10 documentos nuevos por ejecucion, empezando siempre por
  los mas recientes. Prioriza los documentos cuya fecha sea posterior a la
  ultima factura registrada.

LECTURA:
- Analiza cada factura por separado.
- Si la extraccion de texto no basta, inspecciona visualmente todas las paginas.
- Conserva todos los articulos, codigos de producto, variantes, formatos y
  unidades. Ejemplo: Smoothie B13 nunca debe reducirse a Smoothie.
- Extrae proveedor, numero y fecha de factura, base, tipos y cuotas de IGIC,
  descuentos, total y todas las lineas.
- No inventes valores. Explica cualquier duda o descuadre en notes.
- Si un archivo no es una factura de Esencia, no lo incluyas.

SALIDA:
- Crea un archivo JSON nuevo dentro de la carpeta PENDIENTES indicada arriba.
- Nombre: facturas-AAAA-MM-DD-HHMM.json.
- No respondas con Markdown dentro del archivo. Debe ser JSON valido con esta forma:

{
  "invoices": [
    {
      "source": "drive",
      "sourceId": "drive:ID_ARCHIVO",
      "fileName": "nombre.pdf",
      "fileUrl": "URL_REAL_DEL_ARCHIVO",
      "senderEmail": "",
      "supplierName": "Proveedor",
      "invoiceNumber": "F-1234",
      "invoiceDate": "2026-07-16",
      "category": "Mercancia",
      "baseAmount": 100,
      "taxRate": 7,
      "taxAmount": 7,
      "totalAmount": 107,
      "deductible": true,
      "notes": "",
      "lines": [
        {
          "description": "Articulo y variante completos",
          "quantity": 2,
          "unit": "ud",
          "unitPrice": 10,
          "unitPriceUnit": "ud",
          "totalAmount": 20,
          "taxRate": 7
        }
      ]
    }
  ]
}

- Para Gmail usa source="gmail" y sourceId="gmail:ID_MENSAJE:ID_ADJUNTO".
- Usa siempre fechas YYYY-MM-DD y numeros JSON sin simbolos de moneda.
- Si no encuentras facturas nuevas, no crees ningun archivo vacio.
- Al terminar informa cuantos documentos revisaste, cuantos anadiste al lote y
  cuales requieren revision especial.

No muevas, renombres ni elimines facturas originales ni mensajes de Gmail.

---
