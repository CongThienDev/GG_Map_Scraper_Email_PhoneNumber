const { URL } = require("node:url");

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function extractGoogleMapsIdentity(value) {
  const raw = asText(value);
  if (!raw) return "";

  // A Place ID is the most portable identity Google exposes in Maps URLs.
  // It can occur in a normal place URL or inside a reserve/details URL.
  const placeId = /ChI[A-Za-z0-9_-]{8,}/.exec(raw);
  if (placeId) return `place:${placeId[0]}`;

  try {
    const url = new URL(raw);
    const cid = url.searchParams.get("cid");
    if (cid) return `cid:${cid}`;
  } catch {
    // Some Maps URLs are relative or incomplete. The regex fallbacks below
    // still make them useful for deduplication.
  }

  const cid = /[?&]cid=(\d+)/i.exec(raw);
  if (cid) return `cid:${cid[1]}`;

  // Maps inserts an opaque feature identifier after !1s. It is not always
  // followed immediately by !8m2, so only stop at the next ! separator.
  const feature = /!1s([^!]+)/.exec(raw);
  if (feature) return `feature:${feature[1]}`;

  return "";
}

function normalizeDomain(value) {
  const raw = asText(value);
  if (!raw) return "";
  try {
    const host = new URL(raw).hostname || "";
    return host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function makeLeadKey({ url = "", website = "", phone = "" } = {}) {
  const mapsIdentity = extractGoogleMapsIdentity(url);
  if (mapsIdentity) return mapsIdentity;

  const domain = normalizeDomain(website);
  const phoneClean = asText(phone).replace(/\D+/g, "");
  if (domain && phoneClean) return `domtel:${domain}:${phoneClean}`;
  if (domain) return `dom:${domain}`;
  if (phoneClean) return `tel:${phoneClean}`;
  return "";
}

module.exports = { extractGoogleMapsIdentity, makeLeadKey, normalizeDomain };
