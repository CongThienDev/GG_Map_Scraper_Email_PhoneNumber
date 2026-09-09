const express = require("express");

function createAreaRoutes({
  areaCatalogService,
  vietnamImportService,
  unitedStatesAreaCatalogService,
  unitedStatesImportService,
}) {
  const router = express.Router();

  function mountCatalogRoutes(
    prefix,
    catalogService,
    importService,
    parentQueryName = "provinceId"
  ) {
    router.get(`${prefix}/status`, (req, res) => res.json(catalogService.status()));
    router.get(`${prefix}/provinces`, (req, res) =>
      res.json({ provinces: catalogService.provinces() })
    );
    router.get(`${prefix}`, (req, res) => {
      res.json({
        areas: catalogService.listAreas({
          provinceId: String(req.query[parentQueryName] || ""),
          q: String(req.query.q || ""),
          includeProvinces: req.query.includeProvinces === "true",
        }),
      });
    });
    router.get(`${prefix}/geojson`, (req, res) => {
      const ids = String(req.query.ids || "")
        .split(",")
        .filter(Boolean)
        .slice(0, 1000);
      res.setHeader("Cache-Control", "private, max-age=300");
      res.json(
        catalogService.geoJson({
          provinceId: String(req.query[parentQueryName] || ""),
          ids,
        })
      );
    });

    router.post(`${prefix}/import`, (req, res) => {
      if (!importService) return res.status(501).json({ error: "Area importer is unavailable" });
      const { job, alreadyRunning } = importService.start();
      res.status(alreadyRunning ? 202 : 201).json({
        id: job.id,
        status: job.status,
        alreadyRunning,
      });
    });

    router.get(`${prefix}/import/:id/stream`, (req, res) => {
      const job = importService?.getJob(req.params.id);
      if (!job) return res.status(404).end();
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      let index = 0;
      const send = () => {
        while (index < job.logs.length)
          res.write(`data: ${job.logs[index++].replace(/\n/g, "\\n")}\n\n`);
        if (job.status === "running") return setTimeout(send, 500);
        res.write(`event: status\ndata: ${job.status}\n\n`);
        res.end();
      };
      send();
    });
  }

  router.get("/areas/vn/status", (req, res) => res.json(areaCatalogService.status()));
  router.get("/areas/vn/provinces", (req, res) =>
    res.json({ provinces: areaCatalogService.provinces() })
  );
  router.get("/areas/vn", (req, res) => {
    res.json({
      areas: areaCatalogService.listAreas({
        provinceId: String(req.query.provinceId || ""),
        q: String(req.query.q || ""),
        includeProvinces: req.query.includeProvinces === "true",
      }),
    });
  });
  router.get("/areas/vn/geojson", (req, res) => {
    const ids = String(req.query.ids || "")
      .split(",")
      .filter(Boolean)
      .slice(0, 1000);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.json(areaCatalogService.geoJson({ provinceId: String(req.query.provinceId || ""), ids }));
  });

  router.post("/areas/vn/import", (req, res) => {
    if (!vietnamImportService)
      return res.status(501).json({ error: "Vietnam importer is unavailable" });
    const { job, alreadyRunning } = vietnamImportService.start();
    res.status(alreadyRunning ? 202 : 201).json({ id: job.id, status: job.status, alreadyRunning });
  });

  router.get("/areas/vn/import/:id/stream", (req, res) => {
    const job = vietnamImportService?.getJob(req.params.id);
    if (!job) return res.status(404).end();
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    let index = 0;
    const send = () => {
      while (index < job.logs.length)
        res.write(`data: ${job.logs[index++].replace(/\n/g, "\\n")}\n\n`);
      if (job.status === "running") return setTimeout(send, 500);
      res.write(`event: status\ndata: ${job.status}\n\n`);
      res.end();
    };
    send();
  });

  if (unitedStatesAreaCatalogService) {
    mountCatalogRoutes(
      "/areas/us",
      unitedStatesAreaCatalogService,
      unitedStatesImportService,
      "stateId"
    );
    router.get("/areas/us/states", (req, res) =>
      res.json({ states: unitedStatesAreaCatalogService.provinces() })
    );
  }

  return router;
}

module.exports = { createAreaRoutes };
