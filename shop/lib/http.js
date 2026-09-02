// Small helpers shared by the Pages Functions.

export const SAFE_NUMBER = /^[0-9a-zA-Z]{1,20}$/;
export const LANGS = ["fr", "en", "nl", "de"];

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function fail(status, code, extra = {}) {
  return json({ error: code, ...extra }, status);
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export function pickLang(value) {
  return LANGS.includes(value) ? value : "fr";
}

export function langPrefix(lang) {
  return lang === "fr" ? "" : `/${lang}`;
}

// Uniform, deduplicated, validated list of item numbers or null.
export function parseNumbers(value, max = 10) {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) return null;
  const out = [];
  for (const raw of value) {
    if (typeof raw !== "string") return null;
    const number = raw.trim();
    if (!SAFE_NUMBER.test(number)) return null;
    if (!out.includes(number)) out.push(number);
  }
  return out;
}
