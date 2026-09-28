# Club Esencia: integración de producción

28/09/2026. La interfaz está en src/ y la publicación habitual activa Club.
La configuración pública se encuentra en .github/workflows/deploy-pages.yml.
No hay sustitución de módulos ni una versión alternativa para publicar.

## Servicios reales instalados

- TPV: proyecto tbqvypdxcgeofsmiqmuo, función club-tpv.
- Fidelidad: proyecto tojcqhfyjebefyfeqpxv, función tpv-club-bridge.
- Transporte firmado Ed25519; clave privada solo en el esquema privado del TPV.
- Datos y permisos separados por proyecto; el navegador no recibe claves de servidor.
- Cuatro empleados actuales vinculados; la auditoría conserva employee_id del TPV.
- Primer acceso con PIN registra el terminal; posteriores accesos reutilizan su credencial.
- Reintento duradero: cron club-outbox-delivery cada minuto, además del envío inmediato.
- Los beneficios configurados en la web Fidelidad se sincronizan con las reglas del puente.

Los cajeros consultan socios, aplican promociones y asignan compras. Cortesías y
retirada de puntos exigen administrador. Las promociones se editan en Fidelidad.
Desde el 29/09/2026, el TPV solo entrega canjes pendientes comprados previamente
por el cliente en la web: promo_available incluye redemption_id y promo_reserve
debe reservar ese canje. El servidor de Fidelidad rechaza redemption.reserve sin
redemption_id (WEB_REDEMPTION_REQUIRED), incluso desde clientes antiguos.
Reservar o liberar un canje web no mueve puntos. Confirmar su entrega al cobrar
o vaciar cambia club_redemptions.status a used; desaparece de pendientes y se
conserva en el historial. La migración correspondiente está solo en Fidelidad.
El antiguo premio sin tipo de beneficio no se transforma automáticamente: hay que
editarlo en Fidelidad y elegir artículo, topping o descuento.

El PIN habitual y las ventas sin Club mantienen su vía anterior. Una venta con
Club usa una transacción fiscal y una cola duradera; un error no cambia de vía
ni repite el cobro. El cliente se elimina de la cuenta después de cerrarla.

## Verificación

119 tests locales, incluido primer PIN, revocación al cambiar PIN, límites de
intentos, descuentos, cola persistente, transacciones y CORS. Build normal con
las variables de producción. Lectura real entre proyectos comprobada: sesión,
QR de socio, tres promociones configuradas y catálogo. No se han creado ventas
ni concedido puntos reales para esta comprobación.

Corrección 29/09: cobro y vaciado leen la misma sesión persistente que el acceso
PIN. Los beneficios respetan el precio base editado en la cuenta (incluso 0 €),
validan los toppings contra la carta y congelan el precio al reservar. Las pruebas
incluyen MiniPancakes a 0 € con almendra a 1,50 €, vaciado con y sin promociones,
entrega/liberación y reintentos sin duplicar puntos. Comprobación de navegador con
peticiones interceptadas: selección explícita, vaciado y retirada del cliente.

Después de actualizar la web, los empleados que ya tenían una sesión antigua
deben salir y entrar una vez con su PIN para iniciar también la sesión Club.
La caché publicada usa tpv-cache-v100-club.

Los SQL del TPV están en supabase/migrations. Las migraciones de Fidelidad están
separadas en integrations/club/fidelity/migrations; no aplicarlas al proyecto TPV.
La función supabase/functions/tpv-club-bridge corresponde SOLO al proyecto Fidelidad.
El runner Node de server/start.mjs es opcional; producción usa Edge Functions.

La recuperación de una publicación se realiza desde Git. Commit anterior:
d319c9f6145bd91010f7beb5e75aa86dc4daa5cf. No eliminar esquemas ni reservas para
retirar una interfaz: conservar el worker para terminar los envíos pendientes.
