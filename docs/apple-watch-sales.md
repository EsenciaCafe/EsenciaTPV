# Resumen de ventas en Apple Watch

El TPV publica un resumen agregado mediante la Edge Function `watch-sales-summary`.
El endpoint no expone tickets ni articulos individuales y requiere un token incluido
en la URL.

## Configuracion con ComplicaJSON

1. Instala ComplicaJSON en el iPhone y en el Apple Watch.
2. Crea una fuente JSON y pega la URL privada proporcionada por el administrador.
3. Comprueba que la fuente detecta exactamente dos valores: `Ventas` y `Tickets`.
4. Crea una complicacion rectangular y selecciona `Ventas` como dato visible.
5. Desde la app Watch del iPhone, edita la esfera y selecciona la complicacion de
   ComplicaJSON en uno de sus espacios.

La respuesta detallada para diagnostico se obtiene anadiendo `&details=1` a la URL.

La frecuencia real de actualizacion depende de watchOS. La fuente gratuita de
ComplicaJSON solicita actualizaciones periodicas, pero Apple puede retrasarlas para
ahorrar bateria.

## Seguridad

No se debe guardar la URL privada en el repositorio ni compartirla con terceros.
Para revocar el acceso, cambia el secreto `WATCH_SUMMARY_TOKEN_HASH` en Supabase y
configura la nueva URL en ComplicaJSON.
