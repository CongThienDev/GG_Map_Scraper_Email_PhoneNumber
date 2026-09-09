const express = require("express");
const compression = require("compression");
const fs = require("fs");

const { applySecurityMiddleware } = require("./middleware/security");
const { createAuth } = require("./middleware/auth");
const { createAuthRoutes } = require("./routes/authRoutes");
const { createJobRoutes } = require("./routes/jobRoutes");
const { createPolygonRoutes } = require("./routes/polygonRoutes");
const { createAreaRoutes } = require("./routes/areaRoutes");
const { createJobStore } = require("./services/jobStore");
const { createScraperService } = require("./services/scraperService");
const { createPolygonService } = require("./services/polygonService");
const { createAreaCatalogService } = require("./services/areaCatalogService");
const {
  createVietnamImportService,
  createUnitedStatesImportService,
} = require("./services/vietnamImportService");

function createApp(config) {
  const app = express();
  applySecurityMiddleware(app, config);
  app.use(compression());

  const { loginLimiter, requireAuth } = createAuth({
    idleTimeoutMs: config.defaults.idleTimeoutMs,
  });
  const authRoutes = createAuthRoutes({
    adminUser: config.adminUser,
    adminHash: config.adminHash,
    loginLimiter,
  });

  const store = createJobStore({ persistencePath: config.jobsPath });
  const scraperService = createScraperService({ config, store });
  const polygonService = createPolygonService({ rootDir: config.rootDir });
  const areaCatalogService = createAreaCatalogService({ rootDir: config.rootDir });
  const unitedStatesAreaCatalogService = createAreaCatalogService({
    rootDir: config.rootDir,
    countryCode: "US",
    dataDirectory: "united-states",
    sortLocale: "en",
  });
  const vietnamImportService = createVietnamImportService({ rootDir: config.rootDir });
  const unitedStatesImportService = createUnitedStatesImportService({ rootDir: config.rootDir });

  app.use(authRoutes);
  app.use(requireAuth);

  fs.mkdirSync(config.resultsBase, { recursive: true });
  app.use(express.static(config.publicDir));
  app.use("/results", express.static(config.resultsBase, { fallthrough: true }));

  app.use(
    createJobRoutes({
      scraperService,
      areaCatalogService,
      unitedStatesAreaCatalogService,
    })
  );
  app.use(createPolygonRoutes({ polygonService }));
  app.use(
    createAreaRoutes({
      areaCatalogService,
      vietnamImportService,
      unitedStatesAreaCatalogService,
      unitedStatesImportService,
    })
  );

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
