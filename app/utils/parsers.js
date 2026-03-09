function sanitize(input) {
  return (input || "")
    .toString()
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 100);
}

function toInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  const s = (value || "").toString().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

module.exports = {
  sanitize,
  toInt,
  toBool,
};
