# Servidor Club del TPV

Node >=22.12. Instalar con `npm ci --ignore-scripts` en esta carpeta; ejecutar
`npm start` con las variables privadas configuradas por el alojamiento.
No carga automáticamente ningún archivo .env del TPV.

Variables requeridas:
- TPV_WEB_ORIGIN: origen exacto de la web del TPV, sin ruta.
- TPV_DATABASE_URL: conexión PostgreSQL privada a la base TPV.
- TPV_DATABASE_CA_FILE: certificado CA si lo exige la conexión (TLS verificado).
- TPV_PROJECT_REF: proyecto TPV registrado en Fidelidad.
- CLUB_BRIDGE_URL: endpoint HTTPS /v1/club publicado por Fidelidad.
- TPV_BRIDGE_ISSUER y CLUB_BRIDGE_AUDIENCE: identidades acordadas con Fidelidad.
- TPV_SIGNING_KEY_FILE: archivo privado Ed25519, fuera del repositorio.
- TPV_SIGNING_KEY_ID: identificador de la clave pública registrada en Fidelidad.
- PORT (8788 por defecto), HOST (127.0.0.1; usar 0.0.0.0 en contenedor).

TLS debe terminar en el alojamiento/proxy. GET /health comprueba PostgreSQL,
no acredita la disponibilidad remota de Fidelidad. El worker procesa pendientes
continuamente, conserva operation_id y espera al envío activo antes de apagarse.

Los SQL outbox.sql y tpv-schema.sql son el esquema pendiente de aplicar una vez,
no se ejecutan al iniciar. Revisar permisos del rol backend: esquema privado,
RLS sin políticas públicas, ningún acceso anon/authenticated. El rol de conexión
debe poder ejecutar la fiscalización existente y operar su esquema privado.
Se debe registrar cada empleado y terminal con las funciones de auth.mjs desde
un proceso administrador. Fidelidad debe mapear el mismo identificador de
empleado TPV a su cuenta autorizada y permisos. No hay registro público.

Producción utiliza las Edge Functions descritas en ../README.md. Este runner Node es una alternativa opcional; no se ha instalado
como proceso independiente.

Referencias de conexión y transacciones:
https://supabase.com/docs/guides/database/connecting-to-postgres
https://node-postgres.com/features/transactions
https://node-postgres.com/features/ssl

