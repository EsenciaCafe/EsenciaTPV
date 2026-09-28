# Activación real realizada el 28/09/2026

Sustituye el documento previo que indicaba puentes sin desplegar.
Ambas funciones están publicadas en sus proyectos Supabase reales:
- TPV: https://tbqvypdxcgeofsmiqmuo.supabase.co/functions/v1/club-tpv
- Fidelidad: https://tojcqhfyjebefyfeqpxv.supabase.co/functions/v1/tpv-club-bridge

Origen TPV registrado: tbqvypdxcgeofsmiqmuo; issuer esencia-tpv, audience
esencia-club, kid tpv-v1. Clave privada solo en TPV; Fidelidad tiene la pública.
Los cuatro employee_id del TPV usan la cuenta de equipo Joel Benitez existente
en Fidelidad. El sobre/auditoría conserva el empleado TPV y permisos individuales.
No se modificó ninguna contraseña ni ningún PIN.

La creación y edición de beneficios sigue en club_private.reward_benefits y la
web de Fidelidad. El trigger club_bridge_web_benefit actualiza las reglas TPV.
No se infiere un beneficio para premios antiguos sin configuración.
Descuento aplica a toda la cuenta con confirmación; artículo/topping exige elegir
una unidad. Las reservas congelan la regla al aplicarla.

Cron TPV procesa pendientes cada minuto. No cambiar/eliminar sus claves ni
esquemas sin revisar los envíos y reservas pendientes. No desplegar la función
Fidelidad en el proyecto TPV por error; las rutas locales incluyen ambos lados.

Comprobación real de solo lectura superada. No se generaron tickets, puntos ni
canjes reales. El README mantiene el detalle de publicación y recuperación.
