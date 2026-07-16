# Automatizacion de facturas con Codex

## Fuentes

- Drive: `Esencia Cafe/<ano>/PENDIENTE CONTABILIZAR/<mes>`.
- Revisar tanto la carpeta `Facturas` como los PDF o imagenes sueltos dentro del mes.
- Ignorar `Cierres` y cualquier carpeta dedicada a cierres de caja o datafono.
- Gmail: buscar adjuntos PDF o imagen de proveedores en `esenciacafe.galletas@gmail.com` cuando esa cuenta este conectada.

## Reglas

1. Analizar cada archivo o adjunto individualmente.
2. No inventar valores. Los campos dudosos se indican en `notes`.
3. Conservar codigos de producto y variantes como `B13`, formatos y cantidades del nombre.
4. Usar el ID estable de Drive o Gmail como `sourceId`.
5. Marcar todas las entradas como pendientes de revision. El importador fuerza `pending_review`.
6. No importar cierres, extractos de datafono, presupuestos ni archivos que no sean facturas de Esencia.
7. Comprobar duplicados por `sourceId` y por proveedor + numero de factura.

## Contrato JSON

El analisis debe producir un unico objeto JSON valido, sin Markdown:

```json
{
  "invoices": [
    {
      "source": "drive",
      "sourceId": "drive:ID_DEL_ARCHIVO",
      "fileName": "02.07 - Proveedor.pdf",
      "fileUrl": "https://drive.google.com/file/d/ID_DEL_ARCHIVO/view",
      "senderEmail": "",
      "supplierName": "Proveedor",
      "invoiceNumber": "F-1234",
      "invoiceDate": "2026-07-02",
      "category": "Mercancia",
      "baseAmount": 100,
      "taxRate": 7,
      "taxAmount": 7,
      "totalAmount": 107,
      "deductible": true,
      "notes": "",
      "lines": [
        {
          "description": "Smoothie B13 - 20 x 150g",
          "quantity": 2,
          "unit": "caja",
          "unitPrice": 32,
          "totalAmount": 64,
          "taxRate": 0
        }
      ]
    }
  ]
}
```

Para Gmail, `source` sera `gmail`, `sourceId` tendra el formato
`gmail:ID_MENSAJE:ID_ADJUNTO` y se completara `senderEmail`.

## Importacion

```powershell
npm run invoices:import -- C:\ruta\facturas.json
```

Para validar sin escribir:

```powershell
npm run invoices:import -- C:\ruta\facturas.json validate-only
```

El importador lee las credenciales publicas existentes de `.env.local`, no almacena
claves en el JSON y devuelve un resumen de importadas, duplicadas y errores.

Antes de leer los documentos, la automatizacion consulta los origenes ya importados con:

```powershell
npm run invoices:import -- list-existing
```

Asi evita volver a analizar archivos conocidos y reduce tiempo de ejecucion.
La misma consulta devuelve `ignoredSenders`, que Gmail debe excluir.
