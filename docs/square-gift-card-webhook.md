# Webhook de tarjetas regalo Square

Objetivo: registrar automaticamente en el TPV las tarjetas regalo compradas online en Square para que aparezcan en el cierre del dia como `Regalo online Square`.

## URL del webhook

Usa la Edge Function:

```text
https://<project-ref>.supabase.co/functions/v1/square-gift-cards
```

En el proyecto actual, sustituye `<project-ref>` por el ref de Supabase del TPV.

## Eventos de Square

En Square Developer Dashboard, crea una suscripcion de webhook para produccion con estos eventos:

```text
gift_card.created
gift_card.activity.created
gift_card.activity.updated
```

La app contabiliza como ingreso online las actividades `ACTIVATE` y `LOAD`. El evento `gift_card.created` se guarda solo como referencia para no duplicar una compra cuando Square tambien envia la actividad de activacion.

## Secretos de Supabase

En Supabase, configura estos secretos de la Edge Function:

```text
SQUARE_ACCESS_TOKEN=<token de Square>
SQUARE_LOCATION_ID=<location id de Square>
SQUARE_ENVIRONMENT=production
SQUARE_WEBHOOK_SIGNATURE_KEY=<signature key del webhook de Square>
SQUARE_WEBHOOK_NOTIFICATION_URL=https://<project-ref>.supabase.co/functions/v1/square-gift-cards
```

`SQUARE_WEBHOOK_NOTIFICATION_URL` debe coincidir exactamente con la URL que pongas en Square. Si cambia una barra final o el dominio, la firma no validara.

## Despliegue

La funcion `square-gift-cards` debe desplegarse con `verify_jwt = false`, porque Square no envia el JWT de Supabase. El archivo `supabase/config.toml` ya lo deja configurado para esta funcion.

## En la app

Cuando Square envie una compra/activacion online, el TPV guardara un evento `activate` en `square_gift_card_events`.

En `Ajustes > Cierre de Caja`, el importe aparece como:

```text
Regalo online Square
```

Ese importe no suma al efectivo esperado ni al total BBVA, porque entra por Square online.
