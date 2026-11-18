// functions/avis.js
//
// Short link printed on the shop's review poster (QR code, NFC sticker, typed
// URL): https://ateliersauvageheusy.be/avis -> the shop's Google review form.
//
// The poster points here rather than straight at Google (or at a third-party
// QR redirect service) so the destination can change without reprinting, and
// so phones preview the shop's own domain when the code is scanned.
//
// 302, not 301: a permanent redirect gets cached by phones and browsers, and
// then a change of target would not reach people who scanned before.

const GOOGLE_REVIEW_URL = "https://g.page/r/CSGxQ_6wJGxsEBM/review";

export function onRequest() {
    return new Response(null, {
        status: 302,
        headers: {
            Location: GOOGLE_REVIEW_URL,
            "Cache-Control": "no-store",
        },
    });
}
