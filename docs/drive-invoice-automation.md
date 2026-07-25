# Facturas de Google Drive

La extracción se ejecuta manualmente desde Codex. La aplicación no llama a una
API de inteligencia artificial y nunca contabiliza un documento sin revisión.

## Carpetas activas

- Origen actual: [Facturas de julio](https://drive.google.com/drive/folders/1Tzq-_IGm2dUue9USeQVCdz0URFdiL40x)
- Historial fijo: [HISTORIAL CONTABILIDAD - JSON](https://drive.google.com/drive/folders/1cvMQ4L73EHFMpeocyWtweLmsJNgNVtO0)

La configuración guardada en `accounting_drive_sources` es la fuente de verdad.
El origen puede cambiar cada mes; el historial de JSON debe mantenerse fijo.

## Preparar OAuth para la aplicación

1. Activar Google Drive API en un proyecto de Google Cloud.
2. Configurar la pantalla de consentimiento.
3. Crear un cliente OAuth 2.0 de tipo **Aplicación web**.
4. Añadir como origen JavaScript autorizado:
   `https://esenciacafe.github.io`
5. Guardar el ID público del cliente en la variable de repositorio
   `VITE_GOOGLE_CLIENT_ID`.
6. Volver a desplegar GitHub Pages.

La app solicita únicamente el alcance de lectura
`https://www.googleapis.com/auth/drive.readonly`. El token es temporal, se
mantiene solo en memoria y puede revocarse desde la propia pantalla.

## Ejecutar una tanda con Codex

Invocar la skill personal `process-esencia-drive-invoices` o pedir:

> Procesa las facturas nuevas de Drive de Esencia.

La tarea:

1. Consulta las carpetas configuradas y lista solo hijos directos.
2. Admite PDF, JPG, JPEG, PNG, WEBP, HEIC y HEIF.
3. Compara Drive ID, revisión y checksum con el historial.
4. Analiza visualmente todas las páginas sin modificar el original.
5. Conserva una línea por cada artículo impreso (sin agrupar por tipo fiscal),
   incluyendo código de proveedor cuando exista, cantidad, precio unitario,
   base e IGIC propios.
6. Comprueba líneas, bases, IGIC, retenciones y total con tolerancia máxima de
   0,02 €.
7. Genera un JSON `supplier-document/v1` con confianza y advertencias.
8. Lo sube al historial y verifica la subida.
9. Registra cada error por separado y continúa con el resto del lote.

El contrato exacto está en
[`supplier-document-v1.schema.json`](supplier-document-v1.schema.json).

## Sincronizar en Contabilidad

En **Contabilidad → Google Drive**:

1. Autorizar Google Drive.
2. Pulsar **Buscar facturas** para ver pendientes y procesadas.
3. Pulsar **Sincronizar análisis**.
4. Revisar cada gasto importado antes de aprobarlo.

La importación se realiza en una única transacción de base de datos. Un fallo en
el proveedor, documento, líneas o historial revierte toda la operación y evita
registros parciales.
