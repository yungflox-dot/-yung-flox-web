# Yung Flox — PayPal Sandbox + Supabase

Esta versión prepara la primera prueba de PayPal Sandbox usando una Supabase Edge Function.

## Lo que ya está preparado
- PayPal usa el entorno Sandbox.
- Los secretos `PAYPAL_CLIENT_ID` y `PAYPAL_CLIENT_SECRET` se leen desde los secretos de Supabase.
- La función crea la orden, envía al comprador a PayPal y captura el pago.
- La página mantiene Mercado Pago en el proyecto, pero esta primera prueba se concentra en PayPal.

## Siguiente paso
1. En Supabase: Edge Functions → Deploy a new function → Via Editor.
2. Crea una función llamada `yung-flox-api`.
3. Copia el contenido de `supabase/functions/yung-flox-api/index.ts` en el editor.
4. Deploy function.
5. En `index.html`, reemplaza `TU-PROJECT-REF` por el Project ID de tu proyecto Supabase.
6. Después probaremos una compra Sandbox.

No compartas `PAYPAL_CLIENT_SECRET` conmigo ni lo pongas en GitHub.
