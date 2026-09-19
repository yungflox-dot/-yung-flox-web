import express from 'express';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { Resend } from 'resend';

const app = express();
app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin', process.env.FRONTEND_ORIGIN || '*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); if(req.method==='OPTIONS') return res.sendStatus(204); next();});

const PRICE={MP3:350,WAV:500,STEMS:1000,EXCLUSIVA:3500};
const DELIVERY={MP3:['mp3'],WAV:['wav'],STEMS:['wav','stems'],EXCLUSIVA:['wav','mp3','stems']};
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const resend=new Resend(process.env.RESEND_API_KEY);

function id(){return crypto.randomUUID();}
function cleanLicense(x){return String(x||'').toUpperCase().replace(/[^A-Z]/g,'');}
function amountFor(license){const k=cleanLicense(license); if(!PRICE[k]) throw new Error('Licencia no válida'); return PRICE[k];}
function makePdf(order){return new Promise((resolve,reject)=>{const d=new PDFDocument({margin:50});const chunks=[];d.on('data',c=>chunks.push(c));d.on('end',()=>resolve(Buffer.concat(chunks)));d.on('error',reject);d.fontSize(20).text('YUNG FLOX ON THE BEAT',{align:'center'});d.moveDown();d.fontSize(15).text('LICENCIA DE USO DE BEAT',{align:'center'});d.moveDown(2);d.fontSize(11);[
`Orden: ${order.order_id}`,
`Fecha: ${new Date().toLocaleString('es-MX')}`,
`Comprador: ${order.customer_name}`,
`Correo: ${order.email}`,
`Beat: ${order.beat}`,
`Licencia: ${order.license}`,
`Importe: $${order.amount} MXN`,
].forEach(x=>d.text(x));d.moveDown();d.fontSize(10).text('Esta licencia autoriza el uso del beat únicamente bajo los términos asociados a la licencia adquirida. La licencia no transfiere automáticamente la titularidad de la composición ni de los derechos que no estén expresamente concedidos. Conserva este documento como comprobante de compra.');d.moveDown();d.text('Para modificaciones, dudas o solicitudes de exclusividad: contacto por WhatsApp/Instagram de Yung Flox.');d.end();});}

async function createOrder({beat,license,email,customerName,provider}){
 const amount=amountFor(license);
 const order={order_id:id(),beat:String(beat).trim(),license:cleanLicense(license),amount,email:String(email).trim().toLowerCase(),customer_name:String(customerName||'Cliente').trim(),provider,status:'pending',created_at:new Date().toISOString()};
 const {error}=await sb.from('orders').insert(order);
 if(error) throw error;
 return order;
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'yung-flox-store'}));

app.post('/api/orders',async(req,res)=>{try{const {beat,license,email,customerName,provider}=req.body;if(!beat||!license||!email||!provider) return res.status(400).json({error:'Faltan datos'});const order=await createOrder({beat,license,email,customerName,provider});res.json({orderId:order.order_id,amount:order.amount});}catch(e){console.error(e);res.status(500).json({error:e.message});}});

app.post('/api/mercadopago/create-checkout',async(req,res)=>{try{const {orderId}=req.body;const {data:order,error}=await sb.from('orders').select('*').eq('order_id',orderId).single();if(error||!order) return res.status(404).json({error:'Orden no encontrada'});
 const r=await fetch('https://api.mercadopago.com/checkout/preferences',{method:'POST',headers:{Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({items:[{title:`${order.beat} - ${order.license}`,quantity:1,currency_id:'MXN',unit_price:Number(order.amount)}],external_reference:order.order_id,notification_url:`${process.env.BACKEND_PUBLIC_URL}/api/webhooks/mercadopago`,back_urls:{success:`${process.env.FRONTEND_ORIGIN}/?payment=success`,failure:`${process.env.FRONTEND_ORIGIN}/?payment=failure`,pending:`${process.env.FRONTEND_ORIGIN}/?payment=pending`},auto_return:'approved'})});const data=await r.json();if(!r.ok) throw new Error(JSON.stringify(data));res.json({checkoutUrl:data.init_point});}catch(e){console.error(e);res.status(500).json({error:e.message});}});

app.post('/api/paypal/create-order',async(req,res)=>{try{const {orderId}=req.body;const {data:order,error}=await sb.from('orders').select('*').eq('order_id',orderId).single();if(error||!order) return res.status(404).json({error:'Orden no encontrada'});const token=await paypalToken();const r=await fetch('https://api-m.paypal.com/v2/checkout/orders',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({intent:'CAPTURE',purchase_units:[{reference_id:order.order_id,custom_id:order.order_id,description:`${order.beat} - ${order.license}`,amount:{currency_code:'MXN',value:Number(order.amount).toFixed(2)}}],application_context:{return_url:`${process.env.FRONTEND_ORIGIN}/?payment=paypal&order=${order.order_id}`,cancel_url:`${process.env.FRONTEND_ORIGIN}/?payment=cancelled`}})});const data=await r.json();if(!r.ok) throw new Error(JSON.stringify(data));const approval=(data.links||[]).find(x=>x.rel==='approve')?.href;res.json({paypalOrderId:data.id,approvalUrl:approval});}catch(e){console.error(e);res.status(500).json({error:e.message});}});

app.post('/api/paypal/capture-order',async(req,res)=>{try{const {paypalOrderId,orderId}=req.body;const token=await paypalToken();const r=await fetch(`https://api-m.paypal.com/v2/checkout/orders/${paypalOrderId}/capture`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});const data=await r.json();if(!r.ok) throw new Error(JSON.stringify(data));if(data.status==='COMPLETED'){
   const pu=data.purchase_units?.[0];
   const {data:order}=await sb.from('orders').select('*').eq('order_id',orderId).single();
   if(!order || pu?.custom_id!==orderId || pu?.amount?.currency_code!=='MXN' || Number(pu?.amount?.value)!==Number(order.amount)) return res.status(400).json({error:'El pago no coincide con la orden'});
   await fulfill(orderId,'paypal',paypalOrderId);
 }
 res.json({status:data.status});}catch(e){console.error(e);res.status(500).json({error:e.message});}});

async function paypalToken(){const auth=Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');const r=await fetch('https://api-m.paypal.com/v1/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${auth}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});const d=await r.json();if(!r.ok) throw new Error(JSON.stringify(d));return d.access_token;}

app.post('/api/webhooks/mercadopago',async(req,res)=>{
 try{
   const type=req.body.type||req.body.topic;
   const paymentId=req.body.data?.id||req.body.id;
   if(type!=='payment'||!paymentId) return res.sendStatus(200);
   const r=await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`,{headers:{Authorization:`Bearer ${process.env.MP_ACCESS_TOKEN}`}});
   if(!r.ok) throw new Error(`Mercado Pago payment lookup failed: HTTP ${r.status}`);
   const p=await r.json();
   if(p.status!=='approved') return res.sendStatus(200);
   const orderId=p.external_reference||p.metadata?.order_id;
   if(!orderId) return res.sendStatus(200);
   const {data:order,error}=await sb.from('orders').select('*').eq('order_id',orderId).single();
   if(error||!order || Number(p.transaction_amount)!==Number(order.amount) || p.currency_id!=='MXN') return res.sendStatus(200);
   await fulfill(orderId,'mercadopago',String(paymentId));
   return res.sendStatus(200);
 }catch(e){
   console.error('MP webhook',e);
   return res.sendStatus(500);
 }
});
app.post('/api/webhooks/paypal',async(req,res)=>{
 try{
   const event=req.body||{};
   // For production, configure PAYPAL_WEBHOOK_ID and verify the signature before trusting the event.
   if(process.env.PAYPAL_WEBHOOK_ID){
     const token=await paypalToken();
     const vr=await fetch('https://api-m.paypal.com/v1/notifications/verify-webhook-signature',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({auth_algo:req.headers['paypal-auth-algo'],cert_url:req.headers['paypal-cert-url'],transmission_id:req.headers['paypal-transmission-id'],transmission_sig:req.headers['paypal-transmission-sig'],transmission_time:req.headers['paypal-transmission-time'],webhook_id:process.env.PAYPAL_WEBHOOK_ID,webhook_event:event})});
     const vd=await vr.json(); if(vd.verification_status!=='SUCCESS') return res.sendStatus(400);
   }
   res.sendStatus(200);
   if(event.event_type!=='PAYMENT.CAPTURE.COMPLETED') return;
   const resource=event.resource||{};
   const paypalOrderId=resource.supplementary_data?.related_ids?.order_id;
   if(!paypalOrderId) return;
   const token=await paypalToken();
   const r=await fetch(`https://api-m.paypal.com/v2/checkout/orders/${paypalOrderId}`,{headers:{Authorization:`Bearer ${token}`}});
   const orderData=await r.json(); if(!r.ok || orderData.status!=='COMPLETED') return;
   const pu=orderData.purchase_units?.[0]; const orderId=pu?.custom_id;
   const {data:order}=await sb.from('orders').select('*').eq('order_id',orderId).single();
   if(!order || pu?.amount?.currency_code!=='MXN' || Number(pu?.amount?.value)!==Number(order.amount)) return;
   await fulfill(orderId,'paypal',String(resource.id||paypalOrderId));
 }catch(e){console.error('PayPal webhook',e); if(!res.headersSent) res.sendStatus(500);}
});

async function fulfill(orderId,provider,providerId){
 if(!orderId)return;
 const {data:order,error}=await sb.from('orders').select('*').eq('order_id',orderId).single();
 if(error||!order)return;
 const now=new Date().toISOString();
 if(order.status!=='paid'){
   const updated=await sb.from('orders').update({status:'paid',provider_payment_id:providerId,paid_at:order.paid_at||now}).eq('order_id',orderId).eq('status','pending').select('order_id').single();
   if(updated.error && !String(updated.error.message||'').includes('JSON object requested')) throw updated.error;
 }
 if(order.email_sent_at)return;
 const bucket=process.env.SUPABASE_PRIVATE_BUCKET||'private';
 const pdf=await makePdf(order);
 const licensePath=`licenses/${order.order_id}.pdf`;
 const up=await sb.storage.from(bucket).upload(licensePath,pdf,{contentType:'application/pdf',upsert:true});
 if(up.error) throw up.error;
 const links=[];
 for(const type of (DELIVERY[cleanLicense(order.license)]||[])){
   const ext=type==='stems'?'zip':type;
   const path=`${type}/${slug(order.beat)}.${ext}`;
   const {data}=await sb.storage.from(bucket).createSignedUrl(path,60*60*24);
   if(data?.signedUrl) links.push({label:type==='stems'?'Stems (ZIP)':type.toUpperCase(),url:data.signedUrl});
 }
 const {data:lic}=await sb.storage.from(bucket).createSignedUrl(licensePath,60*60*24);
 if(lic?.signedUrl) links.push({label:'Licencia PDF',url:lic.signedUrl});
 if(!links.length) throw new Error(`No hay archivos configurados para el beat ${order.beat}`);
 const html=`<h2>Gracias por tu compra, ${escapeHtml(order.customer_name)}.</h2><p>Beat: <b>${escapeHtml(order.beat)}</b><br>Licencia: <b>${escapeHtml(order.license)}</b><br>Orden: ${order.order_id}<br>Total: <b>${Number(order.amount).toFixed(2)} MXN</b></p><p>Estos son tus archivos de compra. Los enlaces estarán disponibles durante 24 horas:</p><ul>${links.map(x=>`<li><a href="${x.url}">${escapeHtml(x.label)}</a></li>`).join('')}</ul><p>Conserva la licencia PDF como comprobante de autorización de uso.</p>`;
 try{
   const mail=await resend.emails.send({from:process.env.EMAIL_FROM,to:order.email,subject:`Tu compra de Yung Flox — ${order.beat}`,html});
   if(mail?.error) throw mail.error;
   await sb.from('orders').update({email_sent_at:new Date().toISOString(),email_last_error:null}).eq('order_id',orderId);
 }catch(e){
   await sb.from('orders').update({email_last_error:String(e?.message||e)}).eq('order_id',orderId);
   throw e;
 }
}

async function requireAdmin(req,res){
 const auth=String(req.headers.authorization||'');
 if(!auth.startsWith('Bearer ')) return false;
 const token=auth.slice(7);
 const {data:{user},error}=await sb.auth.getUser(token);
 if(error||!user)return false;
 const {data:admin}=await sb.from('admin_users').select('user_id').eq('user_id',user.id).maybeSingle();
 return !!admin;
}

app.post('/api/admin/orders/:orderId/resend-email',async(req,res)=>{
 try{
   if(!await requireAdmin(req,res)) return res.status(401).json({error:'No autorizado'});
   const {orderId}=req.params;
   const {data:order,error}=await sb.from('orders').select('*').eq('order_id',orderId).single();
   if(error||!order)return res.status(404).json({error:'Orden no encontrada'});
   if(order.status!=='paid')return res.status(409).json({error:'La orden todavía no está pagada'});
   await sb.from('orders').update({email_sent_at:null}).eq('order_id',orderId);
   await fulfill(orderId,order.provider,order.provider_payment_id);
   res.json({ok:true,message:'Correo reenviado'});
 }catch(e){console.error('Admin resend email',e);res.status(500).json({error:e.message});}
});
function slug(s){return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

app.listen(process.env.PORT||3000,()=>console.log('Yung Flox backend running'));
