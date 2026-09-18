const express = require("express");

function boolEnv(name, fallback = false) {
  const v = String(process.env[name] ?? "").toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

// Che bớt chuỗi nhạy cảm: giữ vài ký tự đầu, còn lại thay bằng •
function mask(value, keep = 4) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= keep) return s[0] + "•".repeat(Math.max(1, s.length - 1));
  return s.slice(0, keep) + "•".repeat(Math.min(8, s.length - keep));
}

// Tách phần geo (vd "-country-us") ra khỏi username để hiển thị cho dễ đọc
function geoFromUsername(username) {
  const m = String(username || "").match(/-country-([a-z]{2})/i);
  return m ? m[1].toUpperCase() : "";
}

function proxyStatus() {
  const enabledFlag = boolEnv("PROXY_ENABLED", false);
  const host = (process.env.PROXY_HOST || "").trim();
  const port = (process.env.PROXY_PORT || "").trim();
  const username = (process.env.PROXY_USERNAME || "").trim();
  const password = process.env.PROXY_PASSWORD || "";
  const configured = Boolean(host && port && username && password);
  const active = enabledFlag && configured;

  return {
    enabled: enabledFlag,
    configured,
    active,
    endpoint: active ? `${host}:${port}` : "",
    geo: geoFromUsername(username),
    username: active ? mask(username, 6) : "",
    sticky: boolEnv("PROXY_STICKY", true),
    stickyTemplate: process.env.PROXY_STICKY_TEMPLATE || "-session-{id}",
    blockAssets: boolEnv("BLOCK_ASSETS", false),
    blockAssetTypes: (process.env.BLOCK_ASSET_TYPES || "image,media")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    verifyIp: boolEnv("PROXY_VERIFY_IP", active),
    reason: enabledFlag && !configured ? "PROXY_ENABLED=true nhưng thiếu HOST/PORT/USERNAME/PASSWORD." : "",
  };
}

function createSystemRoutes({ systemMetricsService }) {
  const router = express.Router();

  router.get("/system/metrics", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ...systemMetricsService.snapshot(), proxy: proxyStatus() });
  });

  router.get("/system/proxy", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(proxyStatus());
  });

  return router;
}

module.exports = { createSystemRoutes, proxyStatus };
