# Bot privado de ventas en Telegram

La Edge Function `telegram-sales-bot` permite consultar las ventas del TPV sin
exponer claves de Supabase en Telegram. El bot es de solo lectura y únicamente
responde a los identificadores incluidos en `TELEGRAM_ALLOWED_USER_IDS`.

## Funciones incluidas

- Resumen de hoy, ayer o el mes actual.
- Total neto, tickets, ticket medio y devoluciones.
- Desglose de cobros en efectivo, tarjeta y tarjeta regalo.
- Diez artículos más vendidos.
- Búsqueda de unidades e importe vendido por nombre de artículo.
- Botones rápidos y preguntas sencillas en lenguaje natural.
- Aviso inmediato cuando se vacía una mesa, comanda o venta directa.
- Resumen de pedidos vaciados por día, conservado únicamente en Telegram.

## 1. Crear el bot y conocer el ID autorizado

1. Abre `@BotFather` en Telegram, ejecuta `/newbot` y guarda el token.
2. Envía un mensaje al bot recién creado.
3. Durante la puesta en marcha se puede consultar temporalmente `getUpdates` para
   obtener `message.from.id`. No guardes el resultado ni el token en el repositorio.

`TELEGRAM_ALLOWED_USER_IDS` admite varios IDs separados por comas.

## 2. Configurar secretos

Genera `TELEGRAM_WEBHOOK_SECRET` como una cadena aleatoria de al menos 32 caracteres.
Después configura los secretos del proyecto:

```powershell
npx supabase secrets set TELEGRAM_BOT_TOKEN="<token-de-botfather>" TELEGRAM_WEBHOOK_SECRET="<secreto-aleatorio>" TELEGRAM_ALLOWED_USER_IDS="<id-telegram>"
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son secretos integrados disponibles en
las Edge Functions. Nunca deben copiarse a variables `VITE_*`.

## 3. Desplegar

```powershell
npx supabase functions deploy telegram-sales-bot
```

La función tiene `verify_jwt = false` porque Telegram no envía un JWT de Supabase.
La petición se autentica con el encabezado secreto del webhook y, después, se
autoriza de nuevo mediante el ID del usuario.

## 4. Registrar el webhook

Sustituye los valores y realiza una petición HTTPS:

```text
POST https://api.telegram.org/bot<BOT_TOKEN>/setWebhook
Content-Type: application/json

{
  "url": "https://<PROJECT_REF>.supabase.co/functions/v1/telegram-sales-bot",
  "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
  "allowed_updates": ["message", "callback_query"],
  "drop_pending_updates": true
}
```

Comprueba el resultado con `getWebhookInfo` y escribe `/start` al bot.

## Consultas de ejemplo

```text
/hoy
/ayer
/mes
/caja hoy
/top este mes
/producto minipancakes
/vaciados hoy
¿Cuántas mesas se vaciaron ayer y por qué importe?
¿Cuántos cafés se vendieron ayer?
¿Cuánto hemos vendido hoy?
```

## Seguridad y operación

- Rota el token inmediatamente si aparece en un chat, log o commit.
- Usa un chat privado; no añadas el bot a grupos.
- Mantén reducida la lista de usuarios autorizados.
- La función no modifica ventas, cierres ni inventario.
- Los accesos rechazados quedan registrados sin almacenar el contenido del mensaje.

## Registro de pedidos vaciados

Al confirmar **Vaciar**, el TPV envía al bot una copia temporal con el nombre del
pedido, artículos, cantidades e importe. La Edge Function no inserta esa información
en ninguna tabla: solo la entrega a Telegram.

El bot publica el detalle en el chat y mantiene un mensaje fijado con los agregados
diarios de los últimos 92 días. Ese mensaje es el único estado utilizado para
responder `/vaciados hoy`, `/vaciados ayer` o `/vaciados mes`. No debe borrarse ni
desfijarse.

El TPV espera la confirmación de Telegram antes de borrar el pedido. Si la entrega
falla, muestra un error y conserva todos los artículos.
