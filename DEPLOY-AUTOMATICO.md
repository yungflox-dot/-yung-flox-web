# Yung Flox — ventas automáticas

## Qué incluye
- Checkout por orden, no enlaces de pago genéricos.
- Mercado Pago: creación de checkout + webhook + verificación del pago.
- PayPal: Orders API + captura.
- Generación de licencia PDF personalizada.
- Envío automático por correo.
- Archivos en Supabase Storage privado y enlaces temporales.
- Adaptador para conciliación automática de depósitos transferencia bancaria.

## Banco transferencia bancaria
Para automatizar una transferencia a la CLABE no basta con poner la CLABE en la web. transferencia bancaria ofrece APIs Empresariales para consultar movimientos y comprobantes, pero requiere contratar el servicio y completar la integración con transferencia bancaria. Cuando tengas acceso, configura `transferencia bancaria_ACTIVITY_URL`/credenciales según el contrato y adapta el parser del movimiento recibido.

## Pasos
1. Crear proyecto Supabase y bucket privado `private`.
2. Ejecutar `schema.sql` en Supabase.
3. Subir los archivos reales a `private/mp3`, `private/wav` y `private/stems` con el nombre del beat.
4. Crear cuenta/API de Mercado Pago y configurar el webhook `/api/webhooks/mercadopago`.
5. Crear app REST de PayPal y configurar sus credenciales.
6. Crear cuenta de correo transaccional (Resend) y verificar el remitente.
7. Desplegar `/api` en un servidor Node (Render, Railway, Fly.io o similar) y definir las variables de `.env.example`.
8. Cambiar `API_BASE` en `index.html` por la URL pública del backend.
9. Para transferencia bancaria: contratar APIs Empresariales/servicio de conciliación y completar las credenciales y endpoints entregados por transferencia bancaria.

## Seguridad
- Nunca pongas `MP_ACCESS_TOKEN`, `PAYPAL_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` o credenciales transferencia bancaria dentro de GitHub Pages.
- El frontend nunca decide que un pago está aprobado: el backend debe verificarlo con el proveedor.
- La entrega se ejecuta una sola vez cuando la orden pasa a `paid`.
