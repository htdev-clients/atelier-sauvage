// A stand-in for api.stripe.com and api.resend.com, just enough for the
// Functions: create/retrieve/expire Checkout Sessions, send e-mails, and a
// /__mock/ control surface for the tests.
import http from "node:http";

export function startMockServices() {
  const state = { sessions: new Map(), emails: [], requests: [], failNextSession: false, failExpire: false, failEmails: false };
  let counter = 0;

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const url = new URL(req.url, "http://mock");
    state.requests.push({ method: req.method, path: url.pathname });
    const send = (status, data) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      if (state.failNextSession) {
        state.failNextSession = false;
        return send(500, { error: { message: "mock outage" } });
      }
      const form = new URLSearchParams(body);
      const id = `cs_test_mock${String(++counter).padStart(6, "0")}`;
      let amountItems = 0;
      for (const [k, v] of form) if (/^line_items\[\d+\]\[price_data\]\[unit_amount\]$/.test(k)) amountItems += Number(v);
      const shipping = Number(form.get("shipping_options[0][shipping_rate_data][fixed_amount][amount]") || 0);
      const rates = [0, 1].map((i) => ({
        id: `shr_mock_${id}_${i}`,
        display_name: form.get(`shipping_options[${i}][shipping_rate_data][display_name]`),
        metadata: { option: form.get(`shipping_options[${i}][shipping_rate_data][metadata][option]`) },
        fixed_amount: { amount: Number(form.get(`shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`) || 0) },
      }));
      const session = {
        id,
        object: "checkout.session",
        url: `https://checkout.stripe.com/c/pay/${id}`,
        client_reference_id: form.get("client_reference_id"),
        metadata: { order_id: form.get("metadata[order_id]") },
        status: "open",
        payment_status: "unpaid",
        amount_subtotal: amountItems,
        amount_total: amountItems + shipping,
        shipping_cost: { amount_total: shipping, shipping_rate: rates[0].id },
        rates,
        currency: "eur",
        locale: form.get("locale"),
        expires_at: Number(form.get("expires_at")),
        form: Object.fromEntries(form),
        idempotency_key: req.headers["idempotency-key"] || null,
      };
      state.sessions.set(id, session);
      return send(200, session);
    }
    let m;
    if (req.method === "GET" && (m = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) {
      const s = state.sessions.get(m[1]);
      if (!s) return send(404, { error: { message: "no such session" } });
      // Honour expand[]=shipping_cost.shipping_rate the way Stripe does.
      const expand = url.searchParams.getAll("expand[0]").concat(url.searchParams.getAll("expand[]"));
      if (expand.includes("shipping_cost.shipping_rate") && s.shipping_cost && typeof s.shipping_cost.shipping_rate === "string") {
        const rate = (s.rates || []).find((r) => r.id === s.shipping_cost.shipping_rate);
        return send(200, { ...s, shipping_cost: { ...s.shipping_cost, shipping_rate: rate || s.shipping_cost.shipping_rate } });
      }
      return send(200, s);
    }
    if (req.method === "POST" && (m = url.pathname.match(/^\/v1\/checkout\/sessions\/([^/]+)\/expire$/))) {
      const s = state.sessions.get(m[1]);
      if (!s) return send(404, { error: { message: "no such session" } });
      if (state.failExpire) return send(500, { error: { message: "mock outage" } });
      s.status = "expired";
      return send(200, s);
    }
    if (req.method === "POST" && url.pathname === "/emails") {
      if (state.failEmails) return send(500, { error: "mock outage" });
      const email = JSON.parse(body);
      state.emails.push(email);
      return send(200, { id: `email_${state.emails.length}` });
    }
    // test control
    if (req.method === "POST" && (m = url.pathname.match(/^\/__mock\/sessions\/([^/]+)$/))) {
      const s = state.sessions.get(m[1]);
      Object.assign(s, JSON.parse(body));
      return send(200, s);
    }
    if (req.method === "POST" && url.pathname === "/__mock/fail-next-session") {
      state.failNextSession = true;
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/__mock/toggles") {
      Object.assign(state, JSON.parse(body));
      return send(200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/__mock/state") {
      return send(200, { sessions: [...state.sessions.values()], emails: state.emails, requests: state.requests });
    }
    send(404, { error: { message: `mock: no route ${req.method} ${url.pathname}` } });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ base, state, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
