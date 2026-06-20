# Automatizacion de facturas con Google Apps Script

Este script revisa a diario Drive y Gmail, crea facturas en Supabase como `pending_review` y evita duplicados por `source_id`.

## Cuentas

- Ejecutar el Apps Script con `esenciacafe.galletas@gmail.com`.
- Compartir la carpeta `Mi unidad > Esencia Cafe` desde `joelb8743@gmail.com` con `esenciacafe.galletas@gmail.com`.
- Si Google no encuentra la carpeta por nombre, copia el ID de la carpeta `Esencia Cafe` y usa `DRIVE_ROOT_FOLDER_ID`.

## Estructura esperada de Drive

```text
Esencia Cafe
  2026
    PENDIENTE DE CONTABILIZAR
      Enero
        FACTURAS
        CIERRE
        facturas sueltas permitidas
```

El script ignora `CIERRE`, revisa `FACTURAS` y tambien los archivos sueltos dentro del mes.

## Configuracion

1. Ejecuta en Supabase `sql/invoice_automation_migration.sql`.
2. Crea un proyecto en [Google Apps Script](https://script.google.com/).
3. Copia `Code.gs` y `appsscript.json`.
4. En Servicios avanzados de Google, activa `Drive API`.
5. En Google Cloud del proyecto, activa tambien la API de Drive si Google lo solicita.
6. En `Project Settings > Script Properties`, anade:

```text
SUPABASE_URL=https://tbqvypdxcgeofsmiqmuo.supabase.co
SUPABASE_ANON_KEY=la_clave_anon_de_.env.local
DRIVE_ROOT_FOLDER_NAME=Esencia Cafe
GMAIL_QUERY=newer_than:45d has:attachment (factura OR invoice OR recibo OR ticket)
```

`DRIVE_ROOT_FOLDER_ID` es opcional, pero mas fiable que el nombre si la carpeta esta compartida.

## Primer uso

1. Ejecuta `runDailyInvoiceImport`.
2. Autoriza Drive, Gmail y la conexion externa a Supabase.
3. Revisa en la app `Ajustes > Compras y Facturas`.
4. Marca como `Ignorar` los remitentes que no sean proveedores.
5. Ejecuta `createDailyTrigger` para dejar la revision diaria activada.

Las facturas importadas quedan pendientes de revisar. Corrige importes o proveedor cuando el OCR no lo detecte bien y confirma manualmente en la app.
