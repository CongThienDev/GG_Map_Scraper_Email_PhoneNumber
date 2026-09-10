const fs = require("fs");

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toIso(value) {
  const timestamp = asNumber(value, 0);
  return timestamp > 0 ? new Date(timestamp).toISOString() : "";
}

function seconds(value) {
  return Math.round(Math.max(0, asNumber(value)) / 1000);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function activeDurationMs(job, now) {
  const completed = asNumber(job.activeDurationMs);
  if (!["running", "stopping"].includes(job.status)) return completed;
  return completed + Math.max(0, now - asNumber(job.startedAt, now));
}

function buildJobReport(job, checkpoint = {}, now = Date.now()) {
  const metrics = checkpoint.benchmarkMetrics || {};
  const totalCells = asNumber(checkpoint.totalCells) || asNumber(job.plannedGridCount);
  const completedCells = asNumber(checkpoint.currentCell || checkpoint.nextCellIndex);
  const leadsFound = asNumber(checkpoint.processedCount);
  const urlsDiscovered = asNumber(metrics.urlsDiscovered);
  const urlsScheduled = asNumber(metrics.urlsScheduled);
  const duplicatesAvoided = asNumber(metrics.earlyDuplicatesSkipped);
  const detailPagesOpened = asNumber(metrics.detailPagesOpened);
  const activeMs = activeDurationMs(job, now);
  const endTimestamp = asNumber(job.lastEndedAt || job.finishedAt);
  const elapsedEnd = endTimestamp || now;

  return {
    job_id: String(job.id),
    status: job.status || "",
    city: job.env?.CITY || "",
    country: job.env?.COUNTRY || "",
    keywords: Array.isArray(job.env?.KEYWORDS) ? job.env.KEYWORDS.join(" | ") : "",
    grid_step_meters: asNumber(job.env?.STEP_METERS),
    created_at: toIso(job.createdAt),
    first_started_at: toIso(job.firstStartedAt),
    last_started_at: toIso(job.startedAt),
    completed_at: toIso(job.completedAt),
    last_ended_at: toIso(endTimestamp),
    queue_wait_seconds: job.firstStartedAt
      ? seconds(asNumber(job.firstStartedAt) - asNumber(job.createdAt))
      : "",
    active_duration_seconds: seconds(activeMs),
    elapsed_duration_seconds: seconds(elapsedEnd - asNumber(job.createdAt, elapsedEnd)),
    total_cells: totalCells,
    completed_cells: completedCells,
    completion_percent: totalCells ? Number(((completedCells / totalCells) * 100).toFixed(2)) : "",
    leads_found: leadsFound,
    detail_pages_opened: detailPagesOpened,
    urls_discovered: urlsDiscovered,
    urls_scheduled: urlsScheduled,
    duplicates_avoided: duplicatesAvoided,
    duplicate_rate_percent: urlsScheduled
      ? Number(((duplicatesAvoided / urlsScheduled) * 100).toFixed(2))
      : "",
    browser_recoveries: asNumber(metrics.browserRecoveries),
    leads_per_active_hour: activeMs
      ? Number(((leadsFound / activeMs) * 3600000).toFixed(2))
      : "",
    report_generated_at: new Date(now).toISOString(),
  };
}

function writeJobReport(filePath, report) {
  if (!filePath) return;
  const header = Object.keys(report);
  const body = header.map((key) => csvCell(report[key]));
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${header.join(",")}\n${body.join(",")}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

module.exports = { buildJobReport, writeJobReport };
