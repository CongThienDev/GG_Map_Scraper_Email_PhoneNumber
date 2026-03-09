const express = require("express");
const fs = require("fs");
const path = require("path");

const { applySecurityMiddleware } = require("./middleware/security");
const { createAuth } = require("./middleware/auth");
const { createAuthRoutes } = require("./routes/authRoutes");
const { createJobRoutes } = require("./routes/jobRoutes");
const { createPolygonRoutes } = require("./routes/polygonRoutes");
const { createJobStore } = require("./services/jobStore");
const { createScraperService } = require("./services/scraperService");
const { createPolygonService } = require("./services/polygonService");

function createApp(config) {
  const app = express();
  applySecurityMiddleware(app, config);

  const { loginLimiter, requireAuth } = createAuth({ idleTimeoutMs: config.defaults.idleTimeoutMs });
  const authRoutes = createAuthRoutes({
    adminUser: config.adminUser,
    adminHash: config.adminHash,
    loginLimiter,
  });

  const store = createJobStore();
  const scraperService = createScraperService({ config, store });
  const polygonService = createPolygonService({ rootDir: config.rootDir });

  app.use(authRoutes);
  app.use(requireAuth);

  fs.mkdirSync(config.resultsBase, { recursive: true });
  app.use(express.static(config.publicDir));
  app.use("/results", express.static(config.resultsBase, { fallthrough: true }));

  app.use(createJobRoutes({ scraperService }));
  app.use(createPolygonRoutes({ polygonService }));

  app.use((err, req, res, next) => {
    console.error("[UNHANDLED]", err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

module.exports = {
  createApp,
};
