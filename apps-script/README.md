# Cola de facturas ChatGPT -> TPV

Este Apps Script no interpreta facturas ni utiliza una API de IA. ChatGPT lee
los documentos y crea lotes JSON en Drive; Apps Script valida esos lotes y los
guarda en Supabase como `pending_review`.

## Carpetas de Drive

```text
Esencia Cafe/TPV_IMPORT_QUEUE
  PENDIENTES
  PROCESADOS
  ERRORES
```

Los IDs creados para estas carpetas ya estan incluidos como valores por defecto
en `Code.gs`. Se pueden sustituir mediante Script Properties:

```text
INVOICE_QUEUE_PENDING_FOLDER_ID
INVOICE_QUEUE_PROCESSED_FOLDER_ID
INVOICE_QUEUE_ERRORS_FOLDER_ID
```

## Script Properties obligatorias

```text
SUPABASE_URL=https://tbqvypdxcgeofsmiqmuo.supabase.co
SUPABASE_ANON_KEY=la_clave_anon_del_TPV
```

## Activacion

1. Copia `Code.gs` en el proyecto de Google Apps Script que ya utilizabas.
2. Guarda el proyecto.
3. Ejecuta manualmente `configureCloudInvoiceQueue` una sola vez.
4. Acepta los permisos para Drive y la conexion externa a Supabase.
5. Comprueba que el registro devuelve `ok: true`.

La configuracion elimina el trigger OCR anterior y crea uno nuevo que procesa
la cola cada 15 minutos. Los JSON correctos pasan a `PROCESADOS`; los que tengan
errores pasan a `ERRORES`. Supabase vuelve a comprobar duplicados por sourceId y
por proveedor + numero de factura.

La funcion `testInvoiceQueueConnection` permite comprobar Drive y Supabase sin
procesar ningun lote.

## Tarea de ChatGPT

El prompt completo para crear la tarea desde ChatGPT movil esta en:

`docs/chatgpt-mobile-invoice-task.md`

## Flujo antiguo

`runDailyInvoiceImport` y el codigo de OCR/Document AI se conservan solamente
como respaldo. No tienen ningun trigger despues de ejecutar
`configureCloudInvoiceQueue`.
