const path = require("path");
const { toInt, toBool } = require("../utils/parsers");

function loadEnvConfig(rootDir) {
  const sessionSecret = process.env.SESSION_SECRET || "high5hoiangmailcom";
  const adminUser = process.env.ADMIN_USER || "";
  const adminHash = process.env.ADMIN_HASH || "";

  if (!process.env.SESSION_SECRET || sessionSecret === "high5hoiangmailcom") {
    throw new Error("SESSION_SECRET chưa đặt hoặc dùng mặc định");
  }

  if (!adminUser || !adminHash) {
    throw new Error("ADMIN_USER/ADMIN_HASH chưa được cấu hình");
  }

  const defaults = {
    maxConcurrent: toInt(process.env.MAX_CONCURRENT, 13),
    stepMeters: toInt(process.env.STEP_METERS, 1200),
    maxCells: toInt(process.env.MAX_CELLS, 0),
    maxLinksPerCell: toInt(process.env.MAX_LINKS_PER_CELL, 0),
    resetEveryCells: toInt(process.env.RESET_EVERY_CELLS, 3),
    browserMaxAgeMs: toInt(process.env.BROWSER_MAX_AGE_MS, 30 * 60 * 1000),
    headless: !((process.env.HEADLESS || "true").toLowerCase() === "false"),
    polygonPath: process.env.POLYGON_PATH || "",
    fallbackRadiusMeters: toInt(process.env.FALLBACK_RADIUS_METERS, 0),
    allowRoughBbox: toBool(process.env.ALLOW_ROUGH_BBOX, false),
    idleTimeoutMs: toInt(process.env.IDLE_TIMEOUT_MS, 30 * 60 * 1000),
  };

  return {
    port: process.env.PORT || 8080,
    rootDir,
    publicDir: path.join(rootDir, "public"),
    resultsBase: path.join(rootDir, "results"),
    scriptPath: path.join(rootDir, "scraper", "maps_scan_east_architects_hamburg.js"),
    cookieSecure: process.env.COOKIE_SECURE === "1",
    sessionSecret,
    adminUser,
    adminHash,
    defaults,
  };
}

module.exports = {
  loadEnvConfig,
};
