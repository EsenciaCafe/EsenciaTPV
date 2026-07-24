# Automatización manual de facturas en Google Drive

Esta tarea se ejecuta bajo demanda desde Codex. No forma parte del navegador y
no utiliza una clave de OpenAI o Gemini.

## Configuración

1. En Contabilidad → Google Drive, guardar:
   - la carpeta de origen que contiene PDF o imágenes;
   - la carpeta fija donde se conservarán todos los JSON generados.
2. Conectar Google Drive a Codex.
3. Al pedir «procesa las facturas nuevas de Drive», proporcionar la carpeta de
   origen si se quiere sustituir temporalmente la configurada.

## Procedimiento de la tarea

1. Listar únicamente los hijos directos de la carpeta de origen.
2. Admitir PDF, JPG, JPEG, PNG, WEBP y HEIC. No mover, renombrar ni editar los
   originales.
3. Listar la carpeta de resultados y construir el conjunto procesado usando
   `drive_file_id`, `drive_revision` y `checksum`.
4. Para cada original nuevo:
   - leer todas sus páginas y corregir mentalmente la orientación;
   - extraer emisor, NIF, número, fechas, moneda, pago, líneas, bases, IGIC,
     retenciones y total;
   - comprobar que la suma de líneas, impuestos y retenciones coincide con el
     total, admitiendo como máximo 0,02 € de diferencia por redondeo;
   - asignar confianza entre 0 y 1 por campo y añadir advertencias concretas;
   - no inventar valores ilegibles: usar cadena vacía o `null` y advertirlo.
5. Crear localmente un archivo JSON que valide contra
   `supplier-document-v1.schema.json`.
6. Subirlo a la carpeta fija con nombre:
   `AAAA-MM-DD__NIF__NUMERO__<drive_file_id>.json`.
7. Si un documento falla, crear un JSON de error separado con el ID del
   original y continuar con el resto del lote.
8. Volver a listar la carpeta de resultados y comprobar que todos los archivos
   subidos existen antes de informar del resultado.

## Plantilla mínima

```json
{
  "schema_version": "supplier-document/v1",
  "drive_file_id": "ID_ORIGINAL",
  "drive_revision": "REVISION_O_FECHA_MODIFICACION",
  "checksum": "MD5_SI_DRIVE_LO_PROPORCIONA",
  "source_url": "URL_ORIGINAL",
  "supplier": {
    "name": "Proveedor",
    "legal_name": "Proveedor S.L.",
    "tax_id": "B00000000"
  },
  "invoice": {
    "number": "F-2026-001",
    "issue_date": "2026-07-24",
    "due_date": null,
    "currency": "EUR",
    "document_type": "invoice",
    "payment_method": "transfer"
  },
  "lines": [
    {
      "description": "Compra",
      "quantity": 1,
      "unit_price": 100,
      "taxable_base": 100,
      "tax_rate": 7,
      "tax_amount": 7,
      "tax_scope": "taxable",
      "withholding_rate": 0,
      "withholding_amount": 0,
      "account_code": "600"
    }
  ],
  "totals": {
    "taxable_base": 100,
    "tax_amount": 7,
    "withholding_amount": 0,
    "total": 107
  },
  "suggestions": {
    "category": "Compras",
    "account_code": "600"
  },
  "confidence": {
    "supplier.tax_id": 0.99,
    "invoice.number": 0.98,
    "totals.total": 1
  },
  "warnings": []
}
```
