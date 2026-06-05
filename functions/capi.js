// functions/capi.js
//
// Meta Conversions API (CAPI) relay. The browser POSTs a consented event here
// (first-party, same origin -> not blocked by ad blockers), and we forward it to
// Meta server-side. Each event carries the same event_id as its browser-Pixel twin,
// so Meta de-duplicates them (matching on event_id + event_name).
//
// Secrets/config in the ATELIER_STORE KV namespace (same as INSTAGRAM_TOKEN):
//   META_CAPI_TOKEN     (required) - Conversions API access token. SECRET, never in git.
//   META_CAPI_TEST_CODE (optional) - a TESTxxxx code from Events Manager > Test events.
//                                    Set it to see events in the Test tab; DELETE it for
//                                    production so real traffic isn't flagged as test.
//
// The Pixel ID is public, so it lives here directly.

const PIXEL_ID = "1719009352576992";
const GRAPH_VERSION = "v21.0"; // bump when Meta deprecates; the events API is version-tolerant.

// Only events the site actually sends. Guards the public endpoint against being used
// to inject arbitrary events into the dataset.
const ALLOWED_EVENTS = new Set(["PageView", "ViewContent"]);

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = await env.ATELIER_STORE.get("META_CAPI_TOKEN");
  if (!token) {
    return json({ error: "CAPI token not configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Invalid JSON" }, 400);
  }

  const eventName = body.event_name;
  if (!ALLOWED_EVENTS.has(eventName)) {
    return json({ error: "Unsupported event" }, 400);
  }

  // Server-side enrichment the browser can't provide reliably.
  const userData = {
    client_ip_address: request.headers.get("CF-Connecting-IP") || "",
    client_user_agent: request.headers.get("User-Agent") || "",
  };
  if (body.fbp) userData.fbp = body.fbp;
  if (body.fbc) userData.fbc = body.fbc;

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id, // shared with the browser Pixel for de-duplication
    action_source: "website",
    event_source_url: body.event_source_url || request.headers.get("Referer") || "",
    user_data: userData,
  };
  if (body.custom_data && typeof body.custom_data === "object") {
    event.custom_data = body.custom_data;
  }

  const payload = { data: [event] };

  const testCode = await env.ATELIER_STORE.get("META_CAPI_TEST_CODE");
  if (testCode) payload.test_event_code = testCode;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const result = await res.json();
    if (!res.ok) {
      // Surface Meta's error (without the token) to aid debugging; status mirrors Meta.
      return json({ error: "Meta API error", details: result }, res.status);
    }
    return json({ success: true, events_received: result.events_received ?? null });
  } catch (err) {
    return json({ error: err.message }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
