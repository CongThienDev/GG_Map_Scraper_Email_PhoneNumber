const express = require("express");

function createSystemRoutes({ systemMetricsService }) {
  const router = express.Router();

  router.get("/system/metrics", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(systemMetricsService.snapshot());
  });

  return router;
}

module.exports = { createSystemRoutes };
