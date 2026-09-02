// Resend over plain fetch. Two mails per paid order: the buyer's confirmation
// in the order's language, and a French notification for the shop carrying
// everything the carrier will ask for.

import { strings } from "./i18n.js";

const DEFAULT_BASE = "https://api.resend.com";

function euros(cents) {
  return `${(cents / 100).toLocaleString("fr-BE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} €`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function addressLines(address) {
  if (!address) return [];
  return [address.line1, address.line2, `${address.postal_code || ""} ${address.city || ""}`.trim(), address.country]
    .filter((l) => l && String(l).trim());
}

export function buyerEmail(order, items, siteUrl) {
  const s = strings(order.lang);
  const prefix = order.lang === "fr" ? "" : `/${order.lang}`;
  const pickup = order.shipping_option === "pickup";
  const rows = items.map((i) => `<tr><td style="padding:6px 0">${esc(i.description)} <span style="color:#777">(réf. ${esc(i.number)})</span></td><td style="padding:6px 0;text-align:right;white-space:nowrap">${euros(i.price_cents)}</td></tr>`).join("");
  const html = `<div style="font-family:Georgia,serif;color:#2e2e2e;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-weight:normal;font-size:22px">Atelier Sauvage</h1>
<p>${esc(s.intro)}</p>
<p><strong>${esc(order.id)}</strong></p>
<h2 style="font-size:16px;margin-top:28px">${esc(s.items)}</h2>
<table style="width:100%;border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${rows}
<tr><td style="padding:6px 0;border-top:1px solid #ddd">${esc(s.shipping)} — ${esc(pickup ? s.pickup_short : s.delivery_short)}</td><td style="padding:6px 0;border-top:1px solid #ddd;text-align:right">${euros(order.amount_shipping || 0)}</td></tr>
<tr><td style="padding:6px 0;font-weight:bold">${esc(s.total)}</td><td style="padding:6px 0;text-align:right;font-weight:bold">${euros(order.amount_total || 0)}</td></tr>
</table>
${!pickup && order.shipping_address ? `<p style="font-family:Arial,sans-serif;font-size:14px">${addressLines(JSON.parse(order.shipping_address)).map(esc).join("<br>")}</p>` : ""}
<p style="font-family:Arial,sans-serif;font-size:13px;color:#555;margin-top:28px">${esc(s.withdrawal)} <a href="${siteUrl}${prefix}/cgv/">${siteUrl}${prefix}/cgv/</a></p>
<p style="font-family:Arial,sans-serif;font-size:12px;color:#777">${esc(s.sign)}</p>
</div>`;
  const text = [s.intro, "", order.id, "", ...items.map((i) => `- ${i.description} (réf. ${i.number}) : ${euros(i.price_cents)}`),
    `${s.shipping} (${pickup ? s.pickup_short : s.delivery_short}) : ${euros(order.amount_shipping || 0)}`,
    `${s.total} : ${euros(order.amount_total || 0)}`, "", s.withdrawal, `${siteUrl}${prefix}/cgv/`, "", s.sign].join("\n");
  return { subject: s.subject(order.id), html, text };
}

export function shopEmail(order, items, conflicts = []) {
  const pickup = order.shipping_option === "pickup";
  const address = order.shipping_address ? JSON.parse(order.shipping_address) : null;
  const lines = [
    `Nouvelle commande ${order.id} — ${euros(order.amount_total || 0)} payés`,
    "",
    `Client : ${order.customer_name || "?"} — ${order.customer_email || "?"} — ${order.customer_phone || "pas de téléphone"}`,
    `Mode : ${pickup ? "RETRAIT À L'ATELIER" : "LIVRAISON (transporteur)"} — catégorie de transport : ${order.shipping_band || "?"} — frais : ${euros(order.amount_shipping || 0)}`,
    ...(!pickup && address ? ["Adresse :", ...addressLines(address).map((l) => `  ${l}`)] : []),
    "",
    "Objets :",
    ...items.map((i) => `  - réf. ${i.number} — ${i.description} — ${euros(i.price_cents)} — transport ${i.transport || "?"}`),
    "",
    `Langue du client : ${order.lang}. Paiement Stripe : ${order.stripe_payment_intent || order.stripe_session_id || "?"}.`,
  ];
  if (conflicts.length) {
    lines.push("", `⚠️ CONFLIT : ${conflicts.join(", ")} avait déjà été vendu à une autre commande. À rembourser au client et à vérifier dans Stripe.`);
  }
  const text = lines.join("\n");
  const subject = `${conflicts.length ? "⚠️ CONFLIT — " : ""}Commande ${order.id} — ${pickup ? "retrait" : `livraison ${order.shipping_band || ""}`} — ${euros(order.amount_total || 0)}`;
  return { subject, text, html: `<pre style="font-family:Menlo,monospace;font-size:13px;white-space:pre-wrap">${esc(text)}</pre>` };
}

async function send(env, message) {
  const res = await fetch(`${env.RESEND_API_BASE || DEFAULT_BASE}/emails`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Sends both mails. Throws with a combined message if either fails; the
// caller records the error on the order rather than failing the webhook.
export async function sendOrderEmails(env, order, items, { conflicts = [], siteUrl } = {}) {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");
  const from = env.SHOP_EMAIL_FROM || "Atelier Sauvage <commandes@ateliersauvageheusy.be>";
  const shopTo = env.SHOP_EMAIL_TO || "ateliersauvageheusy@gmail.com";
  const errors = [];
  const buyer = buyerEmail(order, items, siteUrl || "https://ateliersauvageheusy.be");
  if (order.customer_email) {
    try {
      await send(env, { from, to: [order.customer_email], subject: buyer.subject, html: buyer.html, text: buyer.text, reply_to: shopTo });
    } catch (err) { errors.push(`buyer: ${err.message}`); }
  } else {
    errors.push("buyer: no e-mail on the session");
  }
  const shop = shopEmail(order, items, conflicts);
  try {
    await send(env, { from, to: [shopTo], subject: shop.subject, html: shop.html, text: shop.text, reply_to: order.customer_email || undefined });
  } catch (err) { errors.push(`shop: ${err.message}`); }
  if (errors.length) throw new Error(errors.join(" | "));
}
