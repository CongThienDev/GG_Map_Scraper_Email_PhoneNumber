const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { parse: csvParse } = require("csv-parse/sync");

function createJobRoutes({ scraperService }) {
  const router = express.Router();

  router.post("/jobs", (req, res) => {
    const created = scraperService.createJob(req.body || {});
    if (created.error) return res.status(400).json({ error: created.error });

    const { job, queued, queuePosition } = created;
    return res.json({
      id: job.id,
      status: queued ? "queued" : job.status,
      queuePosition,
      ...job.resultsPaths,
      csvUrl: `/results/${path.relative(scraperService.resultsBase, job.resultsPaths.CSV_PATH)}`,
      checkpointUrl: `/results/${path.relative(scraperService.resultsBase, job.resultsPaths.CHECKPOINT_PATH)}`,
      queued: Boolean(queued),
    });
  });

  router.get("/jobs", (req, res) => {
    res.json(scraperService.listJobs());
  });

  router.get("/jobs/:id/status", (req, res) => {
    const job = scraperService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({ id: job.id, status: job.status, ...job.resultsPaths });
  });

  router.get("/jobs/:id/excel", async (req, res) => {
    const job = scraperService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });

    const csvPath = job.resultsPaths.CSV_PATH;
    if (!csvPath || !fs.existsSync(csvPath))
      return res.status(404).json({ error: "CSV not found" });

    try {
      const csvContent = fs.readFileSync(csvPath, "utf8");
      const records = csvParse(csvContent, { columns: true, skip_empty_lines: true });
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("data");

      if (records.length) {
        ws.columns = Object.keys(records[0]).map((k) => ({ header: k, key: k }));
        records.forEach((r) => ws.addRow(r));
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"${path.basename(csvPath, ".csv")}.xlsx\"`
      );
      await wb.xlsx.write(res);
      res.end();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get("/jobs/:id/progress", (req, res) => {
    const progress = scraperService.getJobProgress(req.params.id);
    if (!progress) return res.status(404).json({ error: "Not found" });
    res.json(progress);
  });

  router.get("/jobs/:id/logs", (req, res) => {
    const job = scraperService.getJob(req.params.id);
    if (!job) return res.status(404).send("Not found");
    res.type("text/plain").send(job.logs.join(""));
  });

  router.get("/jobs/:id/stream", (req, res) => {
    const job = scraperService.getJob(req.params.id);
    if (!job) return res.status(404).end();

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let idx = Math.max(0, job.logs.length - 100);

    const sendNew = () => {
      while (idx < job.logs.length) {
        const line = job.logs[idx].replace(/\n/g, "\\n");
        res.write(`data: ${line}\n\n`);
        idx += 1;
      }

      if (job.status === "finished" || job.status === "failed") {
        res.write(`event: status\ndata: ${job.status}\n\n`);
        clearInterval(intervalId);
        res.end();
      }
    };

    const intervalId = setInterval(sendNew, 500);
    sendNew();
    req.on("close", () => clearInterval(intervalId));
  });

  router.post("/jobs/:id/stop", (req, res) => {
    const ret = scraperService.stopJob(req.params.id);
    if (ret.notFound) return res.status(404).json({ error: "Not found" });
    if (ret.error) return res.status(500).json({ error: ret.error });
    return res.json({ ok: true, status: ret.status });
  });

  router.delete("/jobs/:id", (req, res) => {
    const ret = scraperService.removeJob(req.params.id);
    if (ret.notFound) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true });
  });

  return router;
}

module.exports = {
  createJobRoutes,
};
