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


async function requireAdmin(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return { user: null, error: json({ error: "No autorizado" }, 401) };
  const token = authorization.slice(7);
  const { data: { user }, error: authError } = await sb.auth.getUser(token);
  if (authError || !user) return { user: null, error: json({ error: "Sesión inválida" }, 401) };
  const { data: admin, error } = await sb.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error || !admin) return { user: null, error: json({ error: "No tienes permisos de administrador" }, 403) };
  return { user, error: null };
}
async function adminMe(req: Request) {
  const a = await requireAdmin(req); if (a.error) return a.error; return json({ ok: true, user: a.user });
}
async function adminListBeats(req: Request) {
  const a = await requireAdmin(req); if (a.error) return a.error;
  const { data, error } = await sb.from("beats").select("*").order("created_at", { ascending: false });
  if (error) throw error; return json({ beats: data || [] });
}
async function adminCreateBeat(req: Request) {
  const a = await requireAdmin(req); if (a.error) return a.error;
  const body = await req.json(); const name=String(body.name||"").trim(); const slug=String(body.slug||"").trim();
  if(!name||!slug)return json({error:"Faltan nombre o slug"},400);
  const {data:existing}=await sb.from("beats").select("id").eq("slug",slug).maybeSingle();
  if(existing)return json({error:"Ya existe un beat con ese slug"},409);
  const {data,error}=await sb.from("beats").insert({name,slug,bpm:body.bpm?Number(body.bpm):null,musical_key:body.musical_key||null,genre:body.genre||null,mp3_path:body.mp3_path||null,wav_path:body.wav_path||null,stems_path:body.stems_path||null,exclusive_path:body.exclusive_path||null,cover_path:body.cover_path||null,active:true}).select("*").single();
  if(error)throw error; return json({beat:data},201);
}
async function adminUpdateBeat(req: Request,id: string) {
  const a=await requireAdmin(req); if(a.error)return a.error; const body=await req.json();
  const update={name:String(body.name||"").trim(),slug:String(body.slug||"").trim(),bpm:body.bpm?Number(body.bpm):null,musical_key:body.musical_key||null,genre:body.genre||null,mp3_path:body.mp3_path||null,wav_path:body.wav_path||null,stems_path:body.stems_path||null,exclusive_path:body.exclusive_path||null,cover_path:body.cover_path||null};
  if(!update.name||!update.slug)return json({error:"Faltan nombre o slug"},400);
  const {data,error}=await sb.from("beats").update(update).eq("id",id).select("*").single(); if(error)throw error; return json({beat:data});
}
async function adminToggleBeat(req: Request,id: string) {
  const a=await requireAdmin(req); if(a.error)return a.error; const body=await req.json();
  const {data,error}=await sb.from("beats").update({active:Boolean(body.active)}).eq("id",id).select("*").single(); if(error)throw error; return json({beat:data});
}
async function publicSignedUrl(column: "mp3_path"|"cover_path",slug:string,ttl:number) {
  const {data:beat,error}=await sb.from("beats").select(column).eq("slug",slug).eq("active",true).maybeSingle(); const p=beat?.[column];
  if(error||!p)return null; const {data,error:signError}=await sb.storage.from("beats").createSignedUrl(p,ttl);
  if(signError||!data?.signedUrl)return null; return data.signedUrl;
}

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

    if (req.method === "GET" && path.endsWith("/api/admin/me")) return await adminMe(req);
    if (req.method === "GET" && path.endsWith("/api/admin/beats")) return await adminListBeats(req);
    if (req.method === "POST" && path.endsWith("/api/admin/beats")) return await adminCreateBeat(req);
    const adminToggle = path.match(/\/api\/admin\/beats\/([^/]+)\/toggle$/);
    if (req.method === "POST" && adminToggle) return await adminToggleBeat(req, adminToggle[1]);
    const adminEdit = path.match(/\/api\/admin\/beats\/([^/]+)$/);
    if (req.method === "PATCH" && adminEdit) return await adminUpdateBeat(req, adminEdit[1]);
    if (req.method === "GET" && path.endsWith("/api/beats/preview")) {
      const slug = url.searchParams.get("slug");
      if (!slug) return json({ error: "Falta el slug del beat" }, 400);
      const signedUrl = await publicSignedUrl("mp3_path", slug, 600);
      return signedUrl ? json({ url: signedUrl }) : json({ error: "No se pudo crear el enlace del demo" }, 404);
    }
    if (req.method === "GET" && path.endsWith("/api/beats/cover")) {
      const slug = url.searchParams.get("slug");
      if (!slug) return json({ error: "Falta el slug del beat" }, 400);
      const signedUrl = await publicSignedUrl("cover_path", slug, 600);
      return signedUrl ? json({ url: signedUrl }) : json({ error: "No se pudo crear el enlace de la portada" }, 404);
    }

    return json({ error: "Ruta no encontrada" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
