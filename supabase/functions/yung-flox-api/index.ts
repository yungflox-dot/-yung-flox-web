import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const PRICE: Record<string, number> = {
  MP3: 350,
  WAV: 500,
  STEMS: 1000,
  EXCLUSIVA: 3500,
};

const cleanLicense = (x: unknown) =>
  String(x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json",
    },
  });

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return {
      user: null,
      error: json({ error: "No autorizado" }, 401),
    };
  }

  const token = authorization.slice(7);

  const {
    data: { user },
    error: authError,
  } = await sb.auth.getUser(token);

  if (authError || !user) {
    return {
      user: null,
      error: json({ error: "Sesión inválida" }, 401),
    };
  }

  const { data: admin, error } = await sb
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !admin) {
    return {
      user: null,
      error: json(
        { error: "No tienes permisos de administrador" },
        403
      ),
    };
  }

  return {
    user,
    error: null,
  };
}

async function adminMe(req: Request) {
  const a = await requireAdmin(req);

  if (a.error) return a.error;

  return json({
    ok: true,
    user: a.user,
  });
}

async function adminListBeats(req: Request) {
  const a = await requireAdmin(req);

  if (a.error) return a.error;

  const { data, error } = await sb
    .from("beats")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return json({
    beats: data || [],
  });
}

async function adminCreateBeat(req: Request) {
  const a = await requireAdmin(req);

  if (a.error) return a.error;

  const body = await req.json();

  const name = String(body.name || "").trim();
  const slug = String(body.slug || "").trim();

  if (!name || !slug) {
    return json(
      { error: "Faltan nombre o slug" },
      400
    );
  }

  const { data: existing } = await sb
    .from("beats")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (existing) {
    return json(
      { error: "Ya existe un beat con ese slug" },
      409
    );
  }

  const { data, error } = await sb
    .from("beats")
    .insert({
      name,
      slug,
      bpm: body.bpm ? Number(body.bpm) : null,
      musical_key: body.musical_key || null,
      genre: body.genre || null,
      mp3_path: body.mp3_path || null,
      wav_path: body.wav_path || null,
      stems_path: body.stems_path || null,
      exclusive_path: body.exclusive_path || null,
      cover_path: body.cover_path || null,
      active: true,
    })
    .select("*")
    .single();

  if (error) throw error;

  return json(
    {
      beat: data,
    },
    201
  );
}

async function adminUpdateBeat(
  req: Request,
  id: string
) {
  const a = await requireAdmin(req);

  if (a.error) return a.error;

  const body = await req.json();

  const update = {
    name: String(body.name || "").trim(),
    slug: String(body.slug || "").trim(),
    bpm: body.bpm ? Number(body.bpm) : null,
    musical_key: body.musical_key || null,
    genre: body.genre || null,
    mp3_path: body.mp3_path || null,
    wav_path: body.wav_path || null,
    stems_path: body.stems_path || null,
    exclusive_path: body.exclusive_path || null,
    cover_path: body.cover_path || null,
  };

  if (!update.name || !update.slug) {
    return json(
      { error: "Faltan nombre o slug" },
      400
    );
  }

  const { data, error } = await sb
    .from("beats")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return json({
    beat: data,
  });
}

async function adminDeleteBeat(req: Request, id: string) {
  const a = await requireAdmin(req);

  if (a.error) return a.error;

  const { data: beat, error: findError } = await sb
    .from("beats")
    .select("id, name, mp3_path, wav_path, stems_path, exclusive_path, cover_path")
    .eq("id", id)
    .maybeSingle();

  if (findError) throw findError;

  if (!beat) {
    return json({ error: "Beat no encontrado" }, 404);
  }

  const paths = [
    beat.mp3_path,
    beat.wav_path,
    beat.stems_path,
    beat.exclusive_path,
    beat.cover_path,
  ].filter((path): path is string => Boolean(path));

  if (paths.length) {
    const { error: storageError } = await sb.storage
      .from("beats")
      .remove(paths);

    if (storageError) {
      throw storageError;
    }
  }

  const { error: deleteError } = await sb
    .from("beats")
    .delete()
    .eq("id", id);

  if (deleteError) throw deleteError;

  return json({
    ok: true,
    deleted: {
      id: beat.id,
      name: beat.name,
    },
  });
}

async function adminToggleBeat(
  req: Request,
  id: string
) {
  const a = await requireAdmin(req);

  if (a.error) return a.error;

  const body = await req.json();

  const { data, error } = await sb
    .from("beats")
    .update({
      active: Boolean(body.active),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return json({
    beat: data,
  });
}

async function publicSignedUrl(
  column: "mp3_path" | "cover_path",
  slug: string,
  ttl: number
) {
  const {
    data: beat,
    error,
  } = await sb
    .from("beats")
    .select(column)
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  const p = beat?.[column];

  if (error || !p) return null;

  const {
    data,
    error: signError,
  } = await sb.storage
    .from("beats")
    .createSignedUrl(p, ttl);

  if (signError || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}


async function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function sendCustomerDelivery(order: any) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) throw new Error("Falta RESEND_API_KEY");

  const license = cleanLicense(order.license);
  if (license !== "MP3" && license !== "WAV") {
    throw new Error("La entrega automática solo aplica a MP3 y WAV");
  }

  const { data: beat, error: beatError } = await sb
    .from("beats")
    .select("name, mp3_path, wav_path")
    .eq("name", order.beat)
    .maybeSingle();

  if (beatError) throw beatError;

  const path = license === "MP3" ? beat?.mp3_path : beat?.wav_path;
  if (!path) throw new Error("No existe el archivo " + license + " para este beat");

  const { data: signed, error: signError } = await sb.storage
    .from("beats")
    .createSignedUrl(path, 60 * 60);

  if (signError || !signed?.signedUrl) {
    throw new Error("No se pudo crear el enlace del archivo " + license);
  }

  const fileResponse = await fetch(signed.signedUrl);
  if (!fileResponse.ok) {
    throw new Error("No se pudo descargar el archivo " + license);
  }

  const fileBytes = new Uint8Array(await fileResponse.arrayBuffer());
  const filename = path.split("/").pop() || (order.beat + "." + license.toLowerCase());

  const paidDate = order.paid_at ? new Date(order.paid_at) : new Date();
  const formattedDate = new Intl.DateTimeFormat("es-MX", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(paidDate);

  const licenseDetails: Record<string, string[]> = {
    MP3: [
      "Archivo de audio MP3 comprimido de alta calidad (320 kbps).",
      "Hasta 10,000 reproducciones en plataformas de streaming (Spotify, Apple Music).",
      "Uso comercial limitado para 1 video musical y shows en vivo sin lucro masivo.",
      "El beat sigue estando disponible para otros artistas.",
    ],
    WAV: [
      "Archivo de audio WAV profesional (sin compresión / alta fidelidad).",
      "Hasta 50,000 reproducciones en plataformas digitales.",
      "Licencia comercial para distribución en tiendas digitales y videos musicales.",
      "Calidad de audio idónea para procesos de mezcla y masterización.",
    ],
  };

  const details = licenseDetails[license] || [];
  const licenseText = [
    "YUNG FLOX — LICENCIA DE USO",
    "",
    "Beat: " + order.beat,
    "Licencia: " + license,
    "Cliente: " + (order.customer_name || "Cliente"),
    "Correo: " + order.email,
    "Orden: " + order.order_id,
    "Monto: $" + Number(order.amount).toFixed(2) + " MXN",
    "Fecha: " + formattedDate,
    "",
    "¿QUÉ SE ENTREGA?",
    "• Archivo " + license + " de alta calidad.",
    "• Este documento con los términos de la licencia.",
    "",
    "¿QUÉ PUEDES HACER CON ESTA LICENCIA?",
    ...details.map((item) => "• " + item),
    "",
    "IMPORTANTE",
    "El beat sigue siendo propiedad de Yung Flox y esta licencia corresponde únicamente a la modalidad adquirida.",
    "Conserva este documento como comprobante de tu licencia.",
  ].join("\n");

  const fileBase64 = await bytesToBase64(fileBytes);
  const licenseBase64 = await bytesToBase64(new TextEncoder().encode(licenseText));

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "onboarding@resend.dev",
      to: [order.email],
      subject: "📦 Tu compra de Yung Flox — " + order.beat + " (" + license + ")",
      text: [
        "NUEVA ENTREGA PARA REENVIAR",
        "",
        "Cliente: " + (order.customer_name || "Cliente"),
        "Correo del cliente: " + order.email,
        "Beat: " + order.beat,
        "Licencia: " + license,
        "Orden: " + order.order_id,
        "Monto: $" + Number(order.amount).toFixed(2) + " MXN",
        "Fecha: " + formattedDate,
        "",
        "PAGO CONFIRMADO",
        "",
        "¿QUÉ SE ENTREGA?",
        "• Archivo " + license + " de alta calidad.",
        "• Documento de licencia con todos los términos.",
        "",
        "¿QUÉ PUEDE HACER EL CLIENTE?",
        ...details.map((item) => "• " + item),
        "",
        "Adjuntamos el archivo " + license + " y la licencia detallada.",
        "Reenvía este correo al cliente cuando quieras.",
      ].join("\n"),
      attachments: [
        { filename, content: fileBase64 },
        { filename: "Licencia-" + order.beat + "-" + license + ".txt", content: licenseBase64 },
      ],
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));

  await sb
    .from("orders")
    .update({
      email_sent_at: new Date().toISOString(),
      email_last_error: null,
    })
    .eq("order_id", order.order_id);

  return data;
}


async function resendCustomerDelivery(req: Request) {
  const a = await requireAdmin(req);
  if (a.error) return a.error;

  const { orderId } = await req.json();
  if (!orderId) return json({ error: "Falta orderId" }, 400);

  const { data: order, error } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .single();

  if (error || !order) return json({ error: "Orden no encontrada" }, 404);
  if (order.status !== "paid") return json({ error: "La orden todavía no está pagada" }, 409);

  await sb
    .from("orders")
    .update({ email_sent_at: null, email_last_error: null })
    .eq("order_id", orderId);

  await sendCustomerDelivery({ ...order, email_sent_at: null });
  return json({ ok: true, message: "Correo reenviado al cliente" });
}

function mercadopagoAccessToken() {
  const token = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
  if (!token) throw new Error("Falta MERCADOPAGO_ACCESS_TOKEN");
  return token;
}

function parseMpSignature(value: string | null) {
  const result: Record<string, string> = {};
  for (const part of String(value || "").split(",")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length) result[key.trim()] = rest.join("=").trim();
  }
  return result;
}

async function verifyMercadoPagoSignature(req: Request, dataId: string) {
  const secret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
  if (!secret) throw new Error("Falta MERCADOPAGO_WEBHOOK_SECRET");
  const parts = parseMpSignature(req.headers.get("x-signature"));
  const requestId = req.headers.get("x-request-id");
  if (!parts.v1 || !parts.ts || !requestId || !dataId) return false;

  const manifest = `id:${dataId};request-id:${requestId};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(manifest)
  );
  const calculated = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return calculated === parts.v1;
}

async function createMercadoPagoCheckout(req: Request) {
  const { orderId } = await req.json();
  const { data: order, error } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", "mercadopago")
    .single();

  if (error || !order) return json({ error: "Orden de Mercado Pago no encontrada" }, 404);

  const token = mercadopagoAccessToken();
  const frontend = Deno.env.get("FRONTEND_ORIGIN") || "https://yungflox-dot.github.io/-yung-flox-web";
  const notificationUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/yung-flox-api/api/webhooks/mercadopago`;

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      items: [{
        title: `${order.beat} — Licencia ${order.license}`,
        quantity: 1,
        currency_id: "MXN",
        unit_price: Number(order.amount),
      }],
      payer: { name: order.customer_name || "Cliente", email: order.email },
      external_reference: order.order_id,
      notification_url: notificationUrl,
      back_urls: {
        success: `${frontend}/?payment=mercadopago&status=success&order=${order.order_id}`,
        pending: `${frontend}/?payment=mercadopago&status=pending&order=${order.order_id}`,
        failure: `${frontend}/?payment=mercadopago&status=failure&order=${order.order_id}`,
      },
      auto_return: "approved",
      payment_methods: {
        installments: 6,
      },
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));

  return json({ checkoutUrl: data.init_point, preferenceId: data.id });
}

async function processMercadoPagoPayment(paymentId: string) {
  const token = mercadopagoAccessToken();
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payment = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(payment));

  const orderId = payment.external_reference;
  if (!orderId) return;

  const { data: order, error: orderError } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", "mercadopago")
    .maybeSingle();

  if (orderError) throw orderError;
  if (!order) return;

  if (
    Number(payment.transaction_amount) !== Number(order.amount) ||
    String(payment.currency_id || "").toUpperCase() !== "MXN"
  ) {
    console.error("Pago Mercado Pago no coincide con la orden:", paymentId, orderId);
    return;
  }

  if (payment.status !== "approved") return;

  let paidOrder = order;

  if (order.status !== "paid") {
    const paidAt = new Date().toISOString();
    const { data: updatedOrder, error: updateError } = await sb
      .from("orders")
      .update({
        status: "paid",
        provider_payment_id: String(payment.id),
        paid_at: order.paid_at || paidAt,
      })
      .eq("order_id", orderId)
      .eq("status", "pending")
      .select("*")
      .single();

    if (updateError) {
      const { data: current } = await sb
        .from("orders")
        .select("*")
        .eq("order_id", orderId)
        .single();

      if (!current || current.status !== "paid") throw updateError;
      paidOrder = current;
    } else {
      paidOrder = updatedOrder;

      try {
        await sendAdminPaymentAlert(paidOrder);
      } catch (emailError) {
        console.error("Error enviando aviso de pago al administrador:", emailError);
      }
    }
  }

  if (paidOrder.email_sent_at) return;

  try {
    await sendCustomerDelivery(paidOrder);
  } catch (emailError) {
    await sb
      .from("orders")
      .update({
        email_last_error: emailError instanceof Error ? emailError.message : String(emailError),
      })
      .eq("order_id", orderId);

    throw emailError;
  }
}

async function confirmMercadoPagoReturn(req: Request) {
  const { orderId, paymentId } = await req.json();

  if (!orderId || !paymentId) {
    return json({ error: "Faltan orderId o paymentId" }, 400);
  }

  const token = mercadopagoAccessToken();
  const r = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const payment = await r.json();

  if (!r.ok) {
    throw new Error(JSON.stringify(payment));
  }

  if (String(payment.external_reference || "") !== String(orderId)) {
    return json({ error: "El pago no coincide con la orden" }, 400);
  }

  if (
    Number(payment.transaction_amount) !== 0 &&
    String(payment.currency_id || "").toUpperCase() !== "MXN"
  ) {
    return json({ error: "Moneda de pago no válida" }, 400);
  }

  if (payment.status === "approved") {
    await processMercadoPagoPayment(String(payment.id));
  }

  const { data: order } = await sb
    .from("orders")
    .select("status, provider_payment_id, paid_at")
    .eq("order_id", orderId)
    .maybeSingle();

  return json({
    ok: true,
    paymentStatus: payment.status,
    orderStatus: order?.status || "pending",
  });
}

async function mercadoPagoWebhook(req: Request) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));

  const dataIdFromUrl = String(
    url.searchParams.get("data.id") || ""
  );

  const dataId = String(
    dataIdFromUrl ||
      url.searchParams.get("id") ||
      body?.data?.id ||
      body?.id ||
      ""
  );

  const type =
    body?.type ||
    body?.data?.type ||
    url.searchParams.get("type") ||
    url.searchParams.get("topic");

  if (!dataId || type !== "payment") {
    return json({ ok: true, ignored: true });
  }

  const signatureHeader = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");

  if (signatureHeader || requestId) {
    if (
      !signatureHeader ||
      !requestId ||
      !dataIdFromUrl ||
      !(await verifyMercadoPagoSignature(req, dataIdFromUrl))
    ) {
      return json({ error: "Firma de webhook inválida" }, 401);
    }
  }

  await processMercadoPagoPayment(dataId);

  return new Response("OK", { status: 200, headers: cors });
}

async function sendAdminPaymentAlert(order: any) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) throw new Error("Falta RESEND_API_KEY");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: Deno.env.get("RESEND_FROM_EMAIL") || "onboarding@resend.dev",
      to: ["flocswa@gmail.com"],
      subject: `💰 Nuevo pago recibido — ${order.beat} (${order.license})`,
      text: [
        "Nuevo pago recibido en Yung Flox.",
        "",
        `Beat: ${order.beat}`,
        `Licencia: ${order.license}`,
        `Monto: ${Number(order.amount).toFixed(2)} MXN`,
        `Cliente: ${order.customer_name || "Cliente"}`,
        `Correo: ${order.email}`,
        `Proveedor: ${order.provider}`,
        `Fecha: ${order.paid_at || new Date().toISOString()}`,
        `Orden: ${order.order_id}`,
      ].join("\n"),
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}

function amountFor(license: string) {
  const key = cleanLicense(license);

  if (!PRICE[key]) {
    throw new Error("Licencia no válida");
  }

  return PRICE[key];
}

async function paypalToken() {
  const clientId =
    Deno.env.get("PAYPAL_CLIENT_ID");

  const clientSecret =
    Deno.env.get("PAYPAL_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error(
      "Faltan credenciales de PayPal"
    );
  }

  const auth = btoa(
    `${clientId}:${clientSecret}`
  );

  const r = await fetch(
    "https://api-m.paypal.com/v1/oauth2/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type":
          "application/x-www-form-urlencoded",
      },
      body:
        "grant_type=client_credentials",
    }
  );

  const d = await r.json();

  if (!r.ok) {
    throw new Error(JSON.stringify(d));
  }

  return d.access_token;
}

async function createOrder(req: Request) {
  const {
    beat,
    license,
    email,
    customerName,
    provider,
  } = await req.json();

  if (
    !beat ||
    !license ||
    !email ||
    (provider !== "paypal" && provider !== "mercadopago")
  ) {
    return json(
      { error: "Faltan datos" },
      400
    );
  }

  const amount = amountFor(license);

  const order = {
    order_id: crypto.randomUUID(),
    beat: String(beat).trim(),
    license: cleanLicense(license),
    amount,
    email: String(email)
      .trim()
      .toLowerCase(),
    customer_name: String(
      customerName || "Cliente"
    ).trim(),
    provider: String(provider).trim().toLowerCase(),
    status: "pending",
    created_at:
      new Date().toISOString(),
  };

  const { error } = await sb
    .from("orders")
    .insert(order);

  if (error) throw error;

  return json({
    orderId: order.order_id,
    amount: order.amount,
  });
}

async function createPaypalOrder(
  req: Request
) {
  const { orderId } = await req.json();

  const {
    data: order,
    error,
  } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .single();

  if (error || !order) {
    return json(
      { error: "Orden no encontrada" },
      404
    );
  }

  const token = await paypalToken();

  const frontend =
    Deno.env.get("FRONTEND_ORIGIN") ||
    "https://yungflox-dot.github.io/-yung-flox-web";

  const r = await fetch(
    "https://api-m.paypal.com/v2/checkout/orders",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        intent: "CAPTURE",

        purchase_units: [
          {
            reference_id: order.order_id,
            custom_id: order.order_id,

            description:
              `${order.beat} - ${order.license}`,

            amount: {
              currency_code: "MXN",
              value:
                Number(order.amount).toFixed(2),
            },
          },
        ],

        application_context: {
          return_url:
            `${frontend}/?payment=paypal&order=${order.order_id}`,

          cancel_url:
            `${frontend}/?payment=cancelled`,
        },
      }),
    }
  );

  const data = await r.json();

  if (!r.ok) {
    throw new Error(JSON.stringify(data));
  }

  const approval =
    (data.links || []).find(
      (x: any) => x.rel === "approve"
    )?.href;

  return json({
    paypalOrderId: data.id,
    approvalUrl: approval,
  });
}

async function capturePaypalOrder(
  req: Request
) {
  const {
    paypalOrderId,
    orderId,
  } = await req.json();

  const token = await paypalToken();

  const r = await fetch(
    `https://api-m.paypal.com/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    }
  );

  const data = await r.json();

  if (!r.ok) {
    throw new Error(JSON.stringify(data));
  }

  if (data.status === "COMPLETED") {
    const pu = data.purchase_units?.[0];
    const capture = pu?.payments?.captures?.[0];

    const {
      data: order,
    } = await sb
      .from("orders")
      .select("*")
      .eq("order_id", orderId)
      .eq("provider", "paypal")
      .single();

    if (
      !order ||
      (pu?.reference_id !== orderId &&
        capture?.custom_id !== orderId) ||
      capture?.amount?.currency_code !== "MXN" ||
      Number(capture?.amount?.value) !==
        Number(order.amount)
    ) {
      return json(
        {
          error:
            "El pago no coincide con la orden",
        },
        400
      );
    }

    await processPaypalCompletedOrder(
      order,
      String(capture?.id || paypalOrderId)
    );
  }

  return json({
    status: data.status,
  });
}

async function verifyPaypalWebhook(req: Request, event: any) {
  const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID");
  if (!webhookId) throw new Error("Falta PAYPAL_WEBHOOK_ID");

  const token = await paypalToken();
  const r = await fetch(
    "https://api-m.paypal.com/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: req.headers.get("paypal-auth-algo"),
        cert_url: req.headers.get("paypal-cert-url"),
        transmission_id: req.headers.get("paypal-transmission-id"),
        transmission_sig: req.headers.get("paypal-transmission-sig"),
        transmission_time: req.headers.get("paypal-transmission-time"),
        webhook_id: webhookId,
        webhook_event: event,
      }),
    }
  );

  const data = await r.json();
  if (!r.ok || data.verification_status !== "SUCCESS") {
    throw new Error("Firma de webhook PayPal inválida");
  }
}

async function processPaypalCompletedOrder(
  order: any,
  providerPaymentId: string
) {
  if (order.status !== "paid") {
    const { data: updated, error } = await sb
      .from("orders")
      .update({
        status: "paid",
        provider_payment_id: providerPaymentId,
        paid_at: order.paid_at || new Date().toISOString(),
      })
      .eq("order_id", order.order_id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    if (error) throw error;

    if (updated) {
      try {
        await sendAdminPaymentAlert(updated);
      } catch (emailError) {
        console.error("Error enviando aviso de pago al administrador:", emailError);
      }
    }
  }

  const { data: paidOrder } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", order.order_id)
    .single();

  if (!paidOrder || paidOrder.email_sent_at) return;

  try {
    await sendCustomerDelivery(paidOrder);
  } catch (emailError) {
    await sb
      .from("orders")
      .update({
        email_last_error:
          emailError instanceof Error ? emailError.message : String(emailError),
      })
      .eq("order_id", order.order_id);
    throw emailError;
  }
}

async function paypalWebhook(req: Request) {
  const event = JSON.parse(await req.text() || "{}");

  await verifyPaypalWebhook(req, event);

  if (event.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
    return new Response("OK", { status: 200, headers: cors });
  }

  const resource = event.resource || {};
  const paypalOrderId =
    resource.supplementary_data?.related_ids?.order_id;

  if (!paypalOrderId) {
    return new Response("OK", { status: 200, headers: cors });
  }

  const token = await paypalToken();
  const r = await fetch(
    `https://api-m.paypal.com/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  const orderData = await r.json();
  if (!r.ok || orderData.status !== "COMPLETED") {
    return new Response("OK", { status: 200, headers: cors });
  }

  const pu = orderData.purchase_units?.[0];
  const orderId = pu?.custom_id || pu?.reference_id;
  if (!orderId) return new Response("OK", { status: 200, headers: cors });

  const { data: order } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", "paypal")
    .maybeSingle();

  if (
    !order ||
    pu?.amount?.currency_code !== "MXN" ||
    Number(pu?.amount?.value) !== Number(order.amount)
  ) {
    return new Response("OK", { status: 200, headers: cors });
  }

  const capture = resource.id || paypalOrderId;
  await processPaypalCompletedOrder(order, String(capture));

  return new Response("OK", { status: 200, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: cors,
    });
  }

  try {
    const url = new URL(req.url);

    const path = url.pathname.replace(
      /\/+$/,
      ""
    );

    if (
      req.method === "GET" &&
      path.endsWith("/health")
    ) {
      return json({
        ok: true,
        service:
          "yung-flox-paypal-live",
      });
    }

    if (
      req.method === "POST" &&
      path.endsWith("/api/orders")
    ) {
      return await createOrder(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith(
        "/api/paypal/create-order"
      )
    ) {
      return await createPaypalOrder(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith(
        "/api/paypal/capture-order"
      )
    ) {
      return await capturePaypalOrder(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith(
        "/api/webhooks/paypal"
      )
    ) {
      return await paypalWebhook(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith("/api/mercadopago/create-checkout")
    ) {
      return await createMercadoPagoCheckout(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith("/api/mercadopago/confirm-return")
    ) {
      return await confirmMercadoPagoReturn(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith("/api/webhooks/mercadopago")
    ) {
      return await mercadoPagoWebhook(req);
    }

    if (
      req.method === "GET" &&
      path.endsWith("/api/admin/me")
    ) {
      return await adminMe(req);
    }
    if (
      req.method === "POST" &&
      path.endsWith("/api/admin/orders/resend-email")
    ) {
      return await resendCustomerDelivery(req);
    }

    if (
      req.method === "GET" &&
      path.endsWith("/api/admin/beats")
    ) {
      return await adminListBeats(req);
    }

    if (
      req.method === "POST" &&
      path.endsWith("/api/admin/beats")
    ) {
      return await adminCreateBeat(req);
    }

    const adminDelete =
      path.match(
        /\/api\/admin\/beats\/([^/]+)$/
      );

    if (
      req.method === "DELETE" &&
      adminDelete
    ) {
      return await adminDeleteBeat(
        req,
        adminDelete[1]
      );
    }

    const adminToggle =
      path.match(
        /\/api\/admin\/beats\/([^/]+)\/toggle$/
      );

    if (
      req.method === "POST" &&
      adminToggle
    ) {
      return await adminToggleBeat(
        req,
        adminToggle[1]
      );
    }

    const adminEdit =
      path.match(
        /\/api\/admin\/beats\/([^/]+)$/
      );

    if (
      req.method === "PATCH" &&
      adminEdit
    ) {
      return await adminUpdateBeat(
        req,
        adminEdit[1]
      );
    }

    if (
      req.method === "GET" &&
      path.endsWith(
        "/api/beats/preview"
      )
    ) {
      const slug =
        url.searchParams.get("slug");

      if (!slug) {
        return json(
          {
            error:
              "Falta el slug del beat",
          },
          400
        );
      }

      const signedUrl =
        await publicSignedUrl(
          "mp3_path",
          slug,
          600
        );

      return signedUrl
        ? json({ url: signedUrl })
        : json(
            {
              error:
                "No se pudo crear el enlace del demo",
            },
            404
          );
    }

    if (
      req.method === "GET" &&
      path.endsWith(
        "/api/beats/cover"
      )
    ) {
      const slug =
        url.searchParams.get("slug");

      if (!slug) {
        return json(
          {
            error:
              "Falta el slug del beat",
          },
          400
        );
      }

      const signedUrl =
        await publicSignedUrl(
          "cover_path",
          slug,
          600
        );

      return signedUrl
        ? json({ url: signedUrl })
        : json(
            {
              error:
                "No se pudo crear el enlace de la portada",
            },
            404
          );
    }

    return json(
      {
        error:
          "Ruta no encontrada",
      },
      404
    );
  } catch (e) {
    console.error(e);

    return json(
      {
        error:
          e instanceof Error
            ? e.message
            : String(e),
      },
      500
    );
  }
});