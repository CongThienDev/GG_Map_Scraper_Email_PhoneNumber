const express = require("express");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const { parse: csvParse } = require("csv-parse/sync");

function createJobRoutes({ scraperService, areaCatalogService, unitedStatesAreaCatalogService }) {
  const router = express.Router();

  function createBatchJobs(req, res, catalogService, country) {
    if (!catalogService) return res.status(501).json({ error: "Area catalog is unavailable" });
    const ids = Array.isArray(req.body?.areaIds)
      ? [...new Set(req.body.areaIds.filter((id) => typeof id === "string"))].slice(0, 300)
      : [];
    const keywords = req.body?.keywords;
    const stepMeters = req.body?.STEP_METERS;
    if (!ids.length) return res.status(400).json({ error: "Hãy chọn ít nhất một khu vực" });

    const areas = catalogService.getAreasByIds(ids);
    if (areas.length !== ids.length) {
      return res.status(400).json({ error: "Một hoặc nhiều khu vực không hợp lệ" });
    }

    const missingPolygon = areas.find((area) => !catalogService.polygonPathFor(area));
    if (missingPolygon) {
      return res.status(409).json({
        error: `Chưa có polygon đầy đủ cho ${missingPolygon.name}. Hãy import lại catalog.`,
      });
    }

    const created = [];
    for (const area of areas) {
      const result = scraperService.createJob({
        city: area.name,
        country,
        keywords,
        STEP_METERS: stepMeters,
        POLYGON_PATH: catalogService.polygonPathFor(area),
      });
      if (result.error)
        return res.status(400).json({ error: result.error, created: created.length });
      created.push({
        id: result.job.id,
        areaId: area.id,
        city: area.name,
        queued: Boolean(result.queued),
        queuePosition: result.queuePosition || null,
      });
    }
    return res.status(201).json({ created, count: created.length });
  }

  router.post("/jobs/batch", (req, res) => {
    return createBatchJobs(req, res, areaCatalogService, "Việt Nam");
  });

  router.post("/jobs/batch/us", (req, res) =>
    createBatchJobs(req, res, unitedStatesAreaCatalogService, "United States")
  );

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
      reportCsvUrl: job.resultsPaths.REPORT_CSV_PATH
        ? `/results/${path.relative(scraperService.resultsBase, job.resultsPaths.REPORT_CSV_PATH)}`
        : null,
      checkpointUrl: `/results/${path.relative(scraperService.resultsBase, job.resultsPaths.CHECKPOINT_PATH)}`,
      queued: Boolean(queued),
    });
  });

  router.get("/jobs", (req, res) => {
    res.json(scraperService.listJobs());
  });

  router.patch("/jobs/settings", (req, res) => {
    const result = scraperService.setMaxConcurrent(req.body?.maxConcurrent);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.json(result);
  });

  router.get("/jobs/:id/status", (req, res) => {
    const job = scraperService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });
    res.json({
      id: job.id,
      status: job.status,
      queuePosition: scraperService.queuePosition(job.id),
      report: scraperService.getJobReport?.(job.id) || null,
      ...job.resultsPaths,
    });
  });

  router.get("/jobs/:id/excel", async (req, res) => {
    const job = scraperService.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Not found" });

    const csvPath = job.resultsPaths.CSV_PATH;

    try {
      const records =
        csvPath && fs.existsSync(csvPath)
          ? csvParse(fs.readFileSync(csvPath, "utf8"), { columns: true, skip_empty_lines: true })
          : [];
      const report = scraperService.getJobReport?.(job.id) || {};
      const wb = new ExcelJS.Workbook();
      const summary = wb.addWorksheet("Job report");
      summary.columns = [
        { header: "Metric", key: "metric", width: 30 },
        { header: "Value", key: "value", width: 48 },
      ];
      Object.entries(report).forEach(([metric, value]) => summary.addRow({ metric, value }));
      summary.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      summary.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
      summary.views = [{ state: "frozen", ySplit: 1 }];

      const ws = wb.addWorksheet("Leads");

      if (records.length) {
        ws.columns = Object.keys(records[0]).map((k) => ({ header: k, key: k }));
        records.forEach((r) => ws.addRow(r));
        ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
        ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
        ws.views = [{ state: "frozen", ySplit: 1 }];
        ws.columns.forEach((column) => {
          column.width = Math.min(50, Math.max(12, String(column.header || "").length + 2));
        });
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
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let idx = Math.max(0, job.logs.length - 100);

    const sendNew = () => {
      while (idx < job.logs.length) {
        const line = job.logs[idx].replace(/\n/g, "\\n");
        res.write(`data: ${line}\n\n`);
        idx += 1;
      }
      res.flush?.();

      if (["finished", "failed", "paused", "interrupted"].includes(job.status)) {
        res.write(`event: status\ndata: ${job.status}\n\n`);
        res.flush?.();
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

  router.post("/jobs/:id/resume", (req, res) => {
    const ret = scraperService.resumeJob(req.params.id);
    if (ret.notFound) return res.status(404).json({ error: "Not found" });
    if (ret.error) return res.status(409).json({ error: ret.error });
    return res.json({ id: ret.job.id, status: ret.job.status, queued: Boolean(ret.queued) });
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
