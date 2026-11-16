# Facturas de cliente

Publicacion inicial: 16 de noviembre de 2026. No emite documentos sobre
cuentas abiertas ni confirma pagos: el empleado registra primero el cobro real
una sola vez. Transacciones > ticket > Factura con datos del cliente permite
completar despues el destinatario, revisar y emitir; una factura emitida se
recupera desde el mismo boton para descargar el PDF.

## Alcance

- Factura completa en sustitucion de una simplificada, conservando el original.
  Articulos, impuestos y total se obtienen exclusivamente del documento fiscal
  persistido. No crea ventas, pagos ni ingresos adicionales.
- Serie independiente F + ano de emision en Atlantic/Canary; numeracion y
  guardado atomicos, una factura por venta y reintentos idempotentes. Cadena hash
  interna separada, sin alterar la cadena fiscal original.
- Nombre/razon social, NIF/CIF/NIE espanol con control, domicilio, codigo postal,
  municipio y provincia. No admite destinatarios extranjeros en esta version.
- Solo IGIC positivo de un unico tipo, consistente con el documento original.
  Exenciones, tipos mixtos, tickets sin fiscalizar, incompletos o devueltos
  requieren revision; no se inventan impuestos ni datos faltantes.
- Propinas excluidas del importe facturado. Los modificadores y descuentos se
  conservan en el detalle. PDF paginado, con fecha de operacion y de emision.
- PDF blanco, negro y dorado con el logo original proporcionado por Joel.
  Las fuentes y el generador PDF se sirven desde la propia app. El archivo
  original public/brand/esencia-logo.jpg se conserva. Se usa la copia
  public/brand/esencia-logo-transparent.png, sin el fondo gris, y se encuadran
  sus margenes vacios al colocarla en la cabecera. Las licencias de las fuentes se
  conservan en public/fonts y las de jsPDF en public/vendor.
- Datos de cliente en esquema privado, con sesion PIN del servidor. No se
  incluyen en el QR publico, localStorage, mesas o realtime.
- Facturas inmutables. Cambiar datos de una ya emitida requiere un procedimiento
  de rectificacion, que esta primera version NO implementa. Las devoluciones
  existentes siguen refiriendose al ticket original: la documentacion de una
  rectificacion de una factura completa requiere tratamiento adicional.

## Activacion

1. Ejecutar pruebas, revisar fiscalmente la serie y el circuito con la asesoria.
2. Aplicar 20261116072723_customer_invoices.sql en el TPV (no en Club).
3. Desplegar club-tpv incluyendo el nuevo modulo customer-invoices.mjs y
   src/customerInvoice.js. Usa la conexion backend existente; no hay nuevas
   credenciales publicas ni RPC anonimas. No reprovisionar PINs/sesiones.
4. Pages activa VITE_CUSTOMER_INVOICES_ENABLED por defecto. La variable del
   repositorio permite desactivarlo con false. En desarrollo local hace falta
   VITE_CUSTOMER_INVOICES_ENABLED=true y VITE_CLUB_SERVER_BRIDGE=true.
5. Hacer un simulacro en staging, incrementar la version de cache en public/sw.js
   y desplegar el frontend. No emitir facturas
   de prueba en produccion ni usar los datos de los tests como clientes reales.

## Limites fiscales y contabilidad

La tabla privada customer_invoices relaciona sale_id y original_document_id.
Los informes y cierres siguen contando la unica venta original. No se ha
modificado accounting_sync_tpv_sales: la app contable todavia no importa los
datos de destinatario ni la nueva referencia de sustitucion. Para automatizar
su envio a contabilidad se debe coordinar una lectura autorizada; nunca importar
estas facturas como nuevas ventas. Hasta entonces el PDF se entrega por separado
y la unica venta sigue reflejada en el cierre habitual.

Esta implementacion no certifica el SIF ni implementa un envio F3/VERI*FACTU.
Su hash es una evidencia interna, no un hash reglamentario certificado. La
validacion fiscal y la integracion de rectificativas/remision quedan pendientes
antes de presentarlo como un sistema fiscal completo.

Referencia: RD 1619/2012, articulos 6 y 15.6 y disposicion adicional segunda
(adaptacion a IGIC): https://www.boe.es/buscar/act.php?id=BOE-A-2012-14696

## Logo

Fondo retirado con la herramienta integrada de edicion de imagen, conservando
por separado el JPG proporcionado. Instruccion utilizada: quitar unicamente el
fondo gris uniforme, producir un PNG con alfa transparente, conservar Esencia
y el texto MINI PANCAKES & COFFEE, proporciones y posicion, sin anadir adornos.
Revisado sobre blanco en el PDF real, no solo en una imagen de maqueta.
