const express = require("express");

function createPolygonRoutes({ polygonService }) {
  const router = express.Router();

  router.post("/polygons", (req, res) => {
    const created = polygonService.createJob(req.body || {});
    if (created.error) return res.status(400).json({ error: created.error });
    res.json({ id: created.job.id, status: created.job.status });
  });

  router.get("/polygons/:id/stream", (req, res) => {
    const job = polygonService.getJob(req.params.id);
    if (!job) return res.status(404).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let idx = 0;
    const send = () => {
      while (idx < job.logs.length) {
        res.write(`data: ${job.logs[idx].replace(/\n/g, "\\n")}\n\n`);
        idx += 1;
      }

      if (job.status === "running") {
        setTimeout(send, 400);
      } else {
        res.write(`event: status\ndata: ${job.status}\n\n`);
        res.end();
      }
    };

    send();
  });

  router.get("/polygons/:id/status", (req, res) => {
    const job = polygonService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({ id: job.id, status: job.status });
  });

  return router;
}

module.exports = {
  createPolygonRoutes,
};
