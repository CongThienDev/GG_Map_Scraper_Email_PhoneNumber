const path = require("path");
const { z } = require("zod");

function intFromEnv(defaultValue) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : value;
  }, z.number().int());
}

function boolFromEnv(defaultValue) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return defaultValue;
    const s = String(value).toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return value;
  }, z.boolean());
}

const envSchema = z
  .object({
    PORT: intFromEnv(8080).refine((n) => n > 0 && n <= 65535, "PORT must be 1-65535"),
    COOKIE_SECURE: boolFromEnv(false),
    SESSION_SECRET: z
      .string()
      .min(16, "SESSION_SECRET must be at least 16 chars")
      .refine((v) => v !== "high5hoiangmailcom", "SESSION_SECRET cannot use insecure default"),
    ADMIN_USER: z.string().min(1, "ADMIN_USER is required"),
    ADMIN_HASH: z.string().min(20, "ADMIN_HASH is required"),
    MAX_CONCURRENT: intFromEnv(13).refine((n) => n > 0, "MAX_CONCURRENT must be > 0"),
    STEP_METERS: intFromEnv(1200).refine((n) => n >= 100, "STEP_METERS must be >= 100"),
    MAX_CELLS: intFromEnv(0).refine((n) => n >= 0, "MAX_CELLS must be >= 0"),
    MAX_LINKS_PER_CELL: intFromEnv(0).refine((n) => n >= 0, "MAX_LINKS_PER_CELL must be >= 0"),
    RESET_EVERY_CELLS: intFromEnv(3).refine((n) => n > 0, "RESET_EVERY_CELLS must be > 0"),
    BROWSER_MAX_AGE_MS: intFromEnv(30 * 60 * 1000).refine(
      (n) => n >= 60_000,
      "BROWSER_MAX_AGE_MS must be >= 60000"
    ),
    HEADLESS: boolFromEnv(true),
    POLYGON_PATH: z.string().optional().default(""),
    FALLBACK_RADIUS_METERS: intFromEnv(0).refine(
      (n) => n >= 0,
      "FALLBACK_RADIUS_METERS must be >= 0"
    ),
    ALLOW_ROUGH_BBOX: boolFromEnv(false),
    IDLE_TIMEOUT_MS: intFromEnv(30 * 60 * 1000).refine(
      (n) => n >= 60_000,
      "IDLE_TIMEOUT_MS must be >= 60000"
    ),
  })
  .passthrough();

function loadEnvConfig(rootDir) {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment config - ${details}`);
  }

  const env = parsed.data;
  return {
    port: env.PORT,
    rootDir,
    publicDir: path.join(rootDir, "public"),
    resultsBase: path.join(rootDir, "results"),
    jobsPath: path.join(rootDir, "data", "jobs.json"),
    scriptPath: path.join(rootDir, "scraper", "maps_scan_east_architects_hamburg.js"),
    cookieSecure: env.COOKIE_SECURE,
    sessionSecret: env.SESSION_SECRET,
    adminUser: env.ADMIN_USER,
    adminHash: env.ADMIN_HASH,
    defaults: {
      maxConcurrent: env.MAX_CONCURRENT,
      stepMeters: env.STEP_METERS,
      maxCells: env.MAX_CELLS,
      maxLinksPerCell: env.MAX_LINKS_PER_CELL,
      resetEveryCells: env.RESET_EVERY_CELLS,
      browserMaxAgeMs: env.BROWSER_MAX_AGE_MS,
      headless: env.HEADLESS,
      polygonPath: env.POLYGON_PATH || "",
      fallbackRadiusMeters: env.FALLBACK_RADIUS_METERS,
      allowRoughBbox: env.ALLOW_ROUGH_BBOX,
      idleTimeoutMs: env.IDLE_TIMEOUT_MS,
    },
  };
}

module.exports = {
  loadEnvConfig,
};
