# Yung Flox — tienda de beats con entrega automática

La web está preparada para que la sección **Licencias** de la parte inferior sea únicamente informativa. La compra se inicia desde el botón **Licencia** de cada beat.

## Flujo automático
1. El cliente elige un beat y licencia.
2. Introduce nombre y correo.
3. Se crea una orden con precio fijo en el backend.
4. Mercado Pago o PayPal procesa el pago.
5. El backend verifica que el pago coincida con la orden.
6. Se genera una licencia PDF personalizada.
7. Se crean enlaces temporales a los archivos correspondientes a esa licencia.
8. Se envía todo al correo del cliente.

### Archivos por licencia
- MP3 → `private/mp3/beat-slug.mp3`
- WAV → `private/wav/beat-slug.wav`
- Stems → WAV + `private/stems/beat-slug.zip`
- Exclusiva → WAV + MP3 + `private/stems/beat-slug.zip`

## Banco transferencia bancaria
La transferencia puede automatizarse al máximo, pero la detección real del depósito depende de que transferencia bancaria habilite el servicio/API de consulta de movimientos para tu cuenta. El endpoint `/api/bank/check` está preparado para consultar movimientos y conciliar el monto. Para hacerlo sin intervención del cliente, se recomienda un proceso programado que ejecute la conciliación cada pocos minutos y llame a `fulfill()` cuando encuentre una coincidencia válida.

No publiques credenciales bancarias ni claves secretas en GitHub Pages.

## Configuración
1. Crear Supabase y bucket privado `private`.
2. Ejecutar `api/schema.sql`.
3. Subir beats reales a las carpetas `mp3`, `wav` y `stems` con los nombres esperados.
4. Configurar Mercado Pago y su webhook: `/api/webhooks/mercadopago`.
5. Configurar PayPal REST y webhook: `/api/webhooks/paypal`.
6. Configurar Resend y `EMAIL_FROM`.
7. Desplegar `api` en un servidor Node.
8. Cambiar `YUNG_FLOX_API_BASE` en el frontend por la URL real del backend (o sustituir `TU-BACKEND.example.com`).
9. Para transferencia bancaria, contratar el servicio correspondiente y colocar el endpoint/credenciales entregados por transferencia bancaria.

## Seguridad
- Nunca colocar `MP_ACCESS_TOKEN`, `PAYPAL_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` ni credenciales transferencia bancaria en el frontend.
- Los pagos se verifican en servidor.
- Los archivos se almacenan en un bucket privado y se entregan con enlaces temporales.
- La orden solo se marca como pagada después de validar proveedor, monto y moneda.
