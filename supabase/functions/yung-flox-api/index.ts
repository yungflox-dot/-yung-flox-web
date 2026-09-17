import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const PRICE: Record<string, number> = {
  MP3: 350,
  WAV: 500,
  STEMS: 1000,
  EXCLUSIVA: 3500,
};

const cleanLicense = (x: unknown) =>
  String(x ?? "").toUpperCase().replace(/[^A-Z]/g, "");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

function amountFor(license: string) {
  const key = cleanLicense(license);
  if (!PRICE[key]) throw new Error("Licencia no válida");
  return PRICE[key];
}

async function paypalToken() {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Faltan credenciales de PayPal");

  const auth = btoa(`${clientId}:${clientSecret}`);
  const r = await fetch("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d.access_token;
}

async function createOrder(req: Request) {
  const { beat, license, email, customerName, provider } = await req.json();
  if (!beat || !license || !email || provider !== "paypal") {
    return json({ error: "Faltan datos" }, 400);
  }

  const amount = amountFor(license);
  const order = {
    order_id: crypto.randomUUID(),
    beat: String(beat).trim(),
    license: cleanLicense(license),
    amount,
    email: String(email).trim().toLowerCase(),
    customer_name: String(customerName || "Cliente").trim(),
    provider: "paypal",
    status: "pending",
    created_at: new Date().toISOString(),
  };

  const { error } = await sb.from("orders").insert(order);
  if (error) throw error;

  return json({ orderId: order.order_id, amount: order.amount });
}

async function createPaypalOrder(req: Request) {
  const { orderId } = await req.json();
  const { data: order, error } = await sb
    .from("orders")
    .select("*")
    .eq("order_id", orderId)
    .single();

  if (error || !order) return json({ error: "Orden no encontrada" }, 404);

  const token = await paypalToken();
  const frontend = Deno.env.get("FRONTEND_ORIGIN") ||
    "https://yungflox-dot.github.io/-yung-flox-web";

  const r = await fetch("https://api-m.sandbox.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: order.order_id,
        custom_id: order.order_id,
        description: `${order.beat} - ${order.license}`,
        amount: {
          currency_code: "MXN",
          value: Number(order.amount).toFixed(2),
        },
      }],
      application_context: {
        return_url: `${frontend}/?payment=paypal&order=${order.order_id}`,
        cancel_url: `${frontend}/?payment=cancelled`,
      },
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));

  const approval = (data.links || []).find((x: any) => x.rel === "approve")?.href;
  return json({ paypalOrderId: data.id, approvalUrl: approval });
}

async function capturePaypalOrder(req: Request) {
  const { paypalOrderId, orderId } = await req.json();
  const token = await paypalToken();

  const r = await fetch(
    `https://api-m.sandbox.paypal.com/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));

  if (data.status === "COMPLETED") {
    const pu = data.purchase_units?.[0];
    const { data: order } = await sb
      .from("orders")
      .select("*")
      .eq("order_id", orderId)
      .single();

    if (
      !order ||
      pu?.custom_id !== orderId ||
      pu?.amount?.currency_code !== "MXN" ||
      Number(pu?.amount?.value) !== Number(order.amount)
    ) {
      return json({ error: "El pago no coincide con la orden" }, 400);
    }

    await sb
      .from("orders")
      .update({
        status: "paid",
        provider_payment_id: paypalOrderId,
        paid_at: new Date().toISOString(),
      })
      .eq("order_id", orderId)
      .eq("status", "pending");
  }

  return json({ status: data.status });
}

async function webhook(req: Request) {
  // For the first Sandbox test we only acknowledge the event.
  // Payment capture is already verified server-side by capturePaypalOrder.
  await req.text();
  return new Response("OK", { status: 200, headers: cors });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");

    if (req.method === "GET" && path.endsWith("/health")) {
      return json({ ok: true, service: "yung-flox-paypal-sandbox" });
    }

    if (req.method === "POST" && path.endsWith("/api/orders")) {
      return await createOrder(req);
    }

    if (req.method === "POST" && path.endsWith("/api/paypal/create-order")) {
      return await createPaypalOrder(req);
    }

    if (req.method === "POST" && path.endsWith("/api/paypal/capture-order")) {
      return await capturePaypalOrder(req);
    }

    if (req.method === "POST" && path.endsWith("/api/webhooks/paypal")) {
      return await webhook(req);
    }

    return json({ error: "Ruta no encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
