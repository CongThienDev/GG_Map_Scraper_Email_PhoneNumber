const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { sanitize, toInt, toBool } = require("../utils/parsers");
const { buildJobReport, writeJobReport } = require("./jobReportService");

function createScraperService({ config, store }) {
  const { defaults, resultsBase, scriptPath, rootDir } = config;
  let maxConcurrent = defaults.maxConcurrent;

  fs.mkdirSync(resultsBase, { recursive: true });
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Không thấy scraper: ${scriptPath}`);
  }

  function ensureJobTracking(job) {
    job.resultsPaths ||= {};
    if (!job.resultsPaths.REPORT_CSV_PATH && job.resultsPaths.RESULTS_DIR) {
      job.resultsPaths.REPORT_CSV_PATH = path.join(job.resultsPaths.RESULTS_DIR, "job_report.csv");
    }
    if (!job.firstStartedAt && job.startedAt) job.firstStartedAt = job.startedAt;
    if (!Number.isFinite(Number(job.activeDurationMs))) job.activeDurationMs = 0;
    if (!job.activeDurationMs && job.startedAt && job.finishedAt) {
      job.activeDurationMs = Math.max(0, job.finishedAt - job.startedAt);
    }
    if (!job.lastEndedAt && job.finishedAt) job.lastEndedAt = job.finishedAt;
    if (job.status === "finished" && !job.completedAt) job.completedAt = job.finishedAt || null;
  }

  function checkpointFor(job) {
    ensureJobTracking(job);
    return store.readJsonCached(job.resultsPaths?.CHECKPOINT_PATH, {});
  }

  function reportFor(job) {
    return buildJobReport(job, checkpointFor(job));
  }

  function refreshJobReport(job) {
    const report = reportFor(job);
    writeJobReport(job.resultsPaths?.REPORT_CSV_PATH, report);
    return report;
  }

  function finishCurrentRun(job, status) {
    const now = Date.now();
    if (["running", "stopping"].includes(job.status) && job.startedAt) {
      job.activeDurationMs = (Number(job.activeDurationMs) || 0) + Math.max(0, now - job.startedAt);
    }
    job.status = status;
    job.finishedAt = now;
    job.lastEndedAt = now;
    if (status === "finished") job.completedAt = now;
  }

  function restoreUntrackedJobs() {
    const knownCheckpoints = new Set(
      store
        .allJobs()
        .map((job) => job.resultsPaths?.CHECKPOINT_PATH)
        .filter(Boolean)
    );
    for (const entry of fs.readdirSync(resultsBase, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const resultsDir = path.join(resultsBase, entry.name);
      const checkpointPath = fs
        .readdirSync(resultsDir)
        .find((name) => name.startsWith("checkpoint_") && name.endsWith(".json"));
      if (!checkpointPath) continue;

      const fullCheckpointPath = path.join(resultsDir, checkpointPath);
      if (knownCheckpoints.has(fullCheckpointPath)) continue;
      const checkpoint = store.readJsonCached(fullCheckpointPath, null);
      if (!checkpoint?.city || !Array.isArray(checkpoint.keywords) || !checkpoint.keywords.length) {
        continue;
      }

      const csvName = fs.readdirSync(resultsDir).find((name) => name.endsWith(".csv"));
      const profileName = fs
        .readdirSync(resultsDir, { withFileTypes: true })
        .find((child) => child.isDirectory() && child.name.startsWith(".profile"))?.name;
      const nextCellIndex = Number(checkpoint.nextCellIndex) || 0;
      const totalCells = Number(checkpoint.totalCells) || 0;
      const complete = totalCells > 0 && nextCellIndex >= totalCells;
      const id = `legacy-${sanitize(entry.name)}`;
      store.addJob({
        id,
        status: complete ? "finished" : "interrupted",
        createdAt: fs.statSync(resultsDir).birthtimeMs,
        lastError: complete
          ? null
          : "Job cũ được khôi phục từ checkpoint. Có thể tiếp tục từ vị trí đã lưu.",
        logs: [],
        env: {
          CITY: checkpoint.city,
          COUNTRY: "",
          KEYWORDS: checkpoint.keywords,
          RESULTS_DIR: resultsDir,
          CSV_PATH: csvName ? path.join(resultsDir, csvName) : path.join(resultsDir, "results.csv"),
          CHECKPOINT_PATH: fullCheckpointPath,
          PROFILE_DIR: profileName
            ? path.join(resultsDir, profileName)
            : path.join(resultsDir, ".profile"),
          STEP_METERS: defaults.stepMeters,
          MAX_CELLS: defaults.maxCells,
          MAX_LINKS_PER_CELL: defaults.maxLinksPerCell,
          RESET_EVERY_CELLS: defaults.resetEveryCells,
          BROWSER_MAX_AGE_MS: defaults.browserMaxAgeMs,
          HEADLESS: defaults.headless,
          POLYGON_PATH: path.join(resultsDir, "polygon_used.json"),
          FALLBACK_RADIUS_METERS: defaults.fallbackRadiusMeters,
          ALLOW_ROUGH_BBOX: defaults.allowRoughBbox,
          CENTERS_PATH: path.join(resultsDir, "centers.json"),
          POLYGON_OUT_PATH: path.join(resultsDir, "polygon_used.json"),
        },
        resultsPaths: {
          RESULTS_DIR: resultsDir,
          CSV_PATH: csvName ? path.join(resultsDir, csvName) : path.join(resultsDir, "results.csv"),
          CHECKPOINT_PATH: fullCheckpointPath,
          REPORT_CSV_PATH: path.join(resultsDir, "job_report.csv"),
          CENTERS_PATH: path.join(resultsDir, "centers.json"),
          POLYGON_OUT_PATH: path.join(resultsDir, "polygon_used.json"),
        },
      });
    }
  }

  restoreUntrackedJobs();
  store.allJobs().forEach((job) => refreshJobReport(job));
  store.persist();

  function currentRunning() {
    return store.allJobs().filter((j) => j.status === "running").length;
  }

  function makeEnvAndPaths({ city, keywords }) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const citySafe = sanitize(city);
    const kwSafe = sanitize(keywords.join("_"));

    const resultsDir = path.join(resultsBase, `${citySafe}_${kwSafe}_${stamp}`);
    fs.mkdirSync(resultsDir, { recursive: true });

    const csvPath = path.join(resultsDir, `${citySafe}_${kwSafe}.csv`);
    const checkpointPath = path.join(resultsDir, `checkpoint_${citySafe}_${kwSafe}.json`);
    const profileDir = path.join(resultsDir, `.profile_${stamp}`);
    const reportCsvPath = path.join(resultsDir, "job_report.csv");

    return { resultsDir, csvPath, checkpointPath, profileDir, reportCsvPath };
  }

  function pushLog(job, line, stream = "stdout") {
    const entry = `[${new Date().toISOString()}] [${stream}] ${line}`;
    job.logs.push(entry);
    if (job.logs.length > 2000) {
      job.logs.splice(0, job.logs.length - 500);
    }
    if (stream === "stderr") job.stderrTail = `${job.stderrTail || ""}${line}`.slice(-4000);
  }

  function startNextFromQueue() {
    while (currentRunning() < maxConcurrent && store.queueLength() > 0) {
      const nextId = store.shiftQueue();
      const nextJob = store.getJob(nextId);
      if (!nextJob || nextJob.status !== "queued") continue;
      startJob(nextJob);
    }
  }

  function startJob(job) {
    const {
      CITY,
      COUNTRY,
      KEYWORDS,
      RESULTS_DIR,
      CSV_PATH,
      CHECKPOINT_PATH,
      PROFILE_DIR,
      STEP_METERS,
      MAX_CELLS,
      MAX_LINKS_PER_CELL,
      RESET_EVERY_CELLS,
      BROWSER_MAX_AGE_MS,
      HEADLESS,
      POLYGON_PATH,
      FALLBACK_RADIUS_METERS,
      ALLOW_ROUGH_BBOX,
      CENTERS_PATH,
      POLYGON_OUT_PATH,
    } = job.env;

    const childEnv = {
      ...process.env,
      CITY,
      COUNTRY,
      KEYWORDS: KEYWORDS.join("|"),
      RESULTS_DIR,
      CSV_PATH,
      CHECKPOINT_PATH,
      PROFILE_DIR,
      LOG_LEVEL: "info",
      RESET_EVERY_CELLS: String(RESET_EVERY_CELLS),
      MAX_CELLS: String(MAX_CELLS),
      MAX_LINKS_PER_CELL: String(MAX_LINKS_PER_CELL),
      STEP_METERS: String(STEP_METERS),
      BROWSER_MAX_AGE_MS: String(BROWSER_MAX_AGE_MS),
      POLYGON_PATH,
      FALLBACK_RADIUS_METERS: String(FALLBACK_RADIUS_METERS),
      ALLOW_ROUGH_BBOX: ALLOW_ROUGH_BBOX ? "true" : "false",
      START_LAT: "",
      START_LNG: "",
      LOCALE: "default",
      HEADLESS: HEADLESS ? "true" : "false",
      CENTERS_PATH,
      POLYGON_OUT_PATH,
    };

    let child;
    try {
      child = spawn("node", [scriptPath], {
        env: childEnv,
        cwd: path.dirname(scriptPath),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finishCurrentRun(job, "failed");
      job.lastError = `Không thể khởi động worker: ${error.message}`;
      pushLog(job, `${job.lastError}\n`, "process");
      store.persist();
      refreshJobReport(job);
      return;
    }

    job.child = child;
    job.status = "running";
    job.startedAt = Date.now();
    job.firstStartedAt ||= job.startedAt;
    job.finishedAt = null;
    job.lastError = null;
    job.stderrTail = "";
    job.stopRequested = false;
    store.persist();
    refreshJobReport(job);

    child.stdout.on("data", (buf) => pushLog(job, buf.toString(), "stdout"));
    child.stderr.on("data", (buf) => pushLog(job, buf.toString(), "stderr"));
    child.on("error", (error) => {
      job.lastError = `Worker error: ${error.message}`;
      pushLog(job, `${job.lastError}\n`, "error");
      if (job.status === "running") {
        finishCurrentRun(job, "failed");
        store.persist();
        refreshJobReport(job);
        startNextFromQueue();
      }
    });
    child.on("exit", (code, signal) => {
      const wasActive = ["running", "stopping"].includes(job.status);
      if (wasActive) {
        finishCurrentRun(job, job.stopRequested ? "paused" : code === 0 ? "finished" : "failed");
      }
      if (job.status === "failed") {
        job.lastError =
          job.stderrTail?.trim() || `Worker dừng với mã ${code}${signal ? ` (${signal})` : ""}.`;
      }
      pushLog(job, `Process exited with code ${code}${signal ? `, signal ${signal}` : ""}`, "exit");
      store.persist();
      refreshJobReport(job);
      startNextFromQueue();
    });
  }

  function createJob(body) {
    const city = (body.city || "").trim();
    const country = (body.country || "").trim();
    let keywords = body.keywords;
    if (typeof keywords === "string") {
      keywords = keywords
        .split(/[|,]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    if (!city || !Array.isArray(keywords) || keywords.length === 0) {
      return { error: "Thiếu city hoặc keywords" };
    }

    const STEP_METERS = toInt(body.STEP_METERS, defaults.stepMeters);
    const MAX_CELLS = toInt(body.MAX_CELLS, defaults.maxCells);
    const MAX_LINKS_PER_CELL = toInt(body.MAX_LINKS_PER_CELL, defaults.maxLinksPerCell);
    const RESET_EVERY_CELLS = toInt(body.RESET_EVERY_CELLS, defaults.resetEveryCells);
    const BROWSER_MAX_AGE_MS = toInt(body.BROWSER_MAX_AGE_MS, defaults.browserMaxAgeMs);
    const HEADLESS = toBool(body.HEADLESS, defaults.headless);
    const POLYGON_PATH = (body.POLYGON_PATH || defaults.polygonPath).toString().trim();
    const FALLBACK_RADIUS_METERS = toInt(
      body.FALLBACK_RADIUS_METERS,
      defaults.fallbackRadiusMeters
    );
    const ALLOW_ROUGH_BBOX = toBool(body.ALLOW_ROUGH_BBOX, defaults.allowRoughBbox);

    const id = store.nextJobId();
    const { resultsDir, csvPath, checkpointPath, profileDir, reportCsvPath } = makeEnvAndPaths({
      city,
      keywords,
    });
    const centersPath = path.join(resultsDir, "centers.json");
    const polygonOutPath = path.join(resultsDir, "polygon_used.json");

    const job = {
      id,
      status: "queued",
      createdAt: Date.now(),
      firstStartedAt: null,
      activeDurationMs: 0,
      completedAt: null,
      lastEndedAt: null,
      env: {
        CITY: city,
        COUNTRY: country,
        KEYWORDS: keywords,
        RESULTS_DIR: resultsDir,
        CSV_PATH: csvPath,
        CHECKPOINT_PATH: checkpointPath,
        PROFILE_DIR: profileDir,
        STEP_METERS,
        MAX_CELLS,
        MAX_LINKS_PER_CELL,
        RESET_EVERY_CELLS,
        BROWSER_MAX_AGE_MS,
        HEADLESS,
        POLYGON_PATH,
        FALLBACK_RADIUS_METERS,
        ALLOW_ROUGH_BBOX,
        CENTERS_PATH: centersPath,
        POLYGON_OUT_PATH: polygonOutPath,
      },
      logs: [],
      lastError: null,
      stderrTail: "",
      resultsPaths: {
        RESULTS_DIR: resultsDir,
        CSV_PATH: csvPath,
        CHECKPOINT_PATH: checkpointPath,
        REPORT_CSV_PATH: reportCsvPath,
        CENTERS_PATH: centersPath,
        POLYGON_OUT_PATH: polygonOutPath,
      },
    };

    store.addJob(job);
    refreshJobReport(job);
    if (currentRunning() < maxConcurrent) {
      startJob(job);
      return { job, queued: false };
    }

    store.pushQueue(id);
    return { job, queued: true, queuePosition: store.queueLength() };
  }

  function listJobs() {
    const jobs = store
      .allJobs()
      .map((j) => {
        const ck = store.readJsonCached(j.resultsPaths.CHECKPOINT_PATH, {});
        const report = refreshJobReport(j);
        return {
          id: j.id,
          status: j.status,
          createdAt: j.createdAt,
          startedAt: j.startedAt || null,
          finishedAt: j.finishedAt || null,
          lastError: j.lastError || null,
          CITY: j.env.CITY,
          COUNTRY: j.env.COUNTRY,
          KEYWORDS: j.env.KEYWORDS,
          queuePosition: j.status === "queued" ? store.queuePosition(j.id) : null,
          ...j.resultsPaths,
          csvUrl: `/results/${path.relative(resultsBase, j.resultsPaths.CSV_PATH)}`,
          reportCsvUrl: `/results/${path.relative(resultsBase, j.resultsPaths.REPORT_CSV_PATH)}`,
          checkpointUrl: `/results/${path.relative(resultsBase, j.resultsPaths.CHECKPOINT_PATH)}`,
          report,
          checkpointSummary: {
            processedCount: ck.processedCount || 0,
            currentCell: ck.currentCell || ck.nextCellIndex || 0,
            totalCells: ck.totalCells || 0,
            timestamp: ck.timestamp || "",
            benchmarkMetrics: ck.benchmarkMetrics || null,
          },
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

    return {
      jobs,
      stats: {
        running: jobs.filter((j) => j.status === "running").length,
        failed: jobs.filter((j) => j.status === "failed").length,
        queued: jobs.filter((j) => j.status === "queued").length,
        queueLength: store.queueLength(),
        maxConcurrent,
      },
    };
  }

  function setMaxConcurrent(value) {
    const nextMax = Number(value);
    if (!Number.isInteger(nextMax) || nextMax < 1) {
      return { error: "maxConcurrent phải là số nguyên lớn hơn 0" };
    }

    maxConcurrent = nextMax;
    startNextFromQueue();
    return { maxConcurrent };
  }

  function queuePosition(id) {
    const job = store.getJob(id);
    return job?.status === "queued" ? store.queuePosition(id) : null;
  }

  function getJob(id) {
    return store.getJob(id);
  }

  function getJobReport(id) {
    const job = store.getJob(id);
    return job ? refreshJobReport(job) : null;
  }

  function getJobProgress(id) {
    const j = store.getJob(id);
    if (!j) return null;

    const ck = store.readJsonCached(j.resultsPaths.CHECKPOINT_PATH, {});
    const report = refreshJobReport(j);
    const centers = store.readJsonCached(j.resultsPaths.CENTERS_PATH, []);
    const polygonInline = store.readJsonCached(j.resultsPaths.POLYGON_OUT_PATH, null);

    const centersUrl =
      j.resultsPaths.CENTERS_PATH && fs.existsSync(j.resultsPaths.CENTERS_PATH)
        ? `/results/${path.relative(resultsBase, j.resultsPaths.CENTERS_PATH)}`
        : null;
    const polygonUrl =
      j.resultsPaths.POLYGON_OUT_PATH && fs.existsSync(j.resultsPaths.POLYGON_OUT_PATH)
        ? `/results/${path.relative(resultsBase, j.resultsPaths.POLYGON_OUT_PATH)}`
        : null;

    const totalCells = ck.totalCells || (Array.isArray(centers) ? centers.length : 0);
    let currentCell = ck.currentCell || ck.nextCellIndex || 0;
    if (!currentCell && j.status === "running") {
      currentCell = (ck.nextCellIndex || 0) + 1;
    }

    return {
      id: j.id,
      status: j.status,
      city: j.env.CITY,
      totalCells,
      currentCell,
      gridRows: ck.gridRows || [],
      gridRowsString: ck.gridRowsString || "",
      anchorsCollected: ck.anchorsCollected,
      rowsWritten: ck.rowsWritten,
      processedCount: ck.processedCount,
      benchmarkMetrics: ck.benchmarkMetrics || null,
      lastKeyword: ck.lastKeyword || "",
      timestamp: ck.timestamp || "",
      lastCenter: ck.lastCenter || null,
      centersUrl,
      polygonUrl,
      centersInline: Array.isArray(centers) ? centers : [],
      polygonInline,
      queuePosition: queuePosition(j.id),
      report,
    };
  }

  function stopJob(id) {
    const j = store.getJob(id);
    if (!j) return { notFound: true };

    if (j.status === "queued") {
      store.removeFromQueue(j.id);
      j.status = "paused";
      j.lastEndedAt = Date.now();
      j.lastError = null;
      store.persist();
      refreshJobReport(j);
      return { status: j.status };
    }

    if (j.status !== "running") {
      return { status: j.status };
    }

    try {
      j.stopRequested = true;
      j.child.kill("SIGINT");
      j.status = "stopping";
      store.persist();
      refreshJobReport(j);
      return { status: j.status };
    } catch (e) {
      return { error: String(e) };
    }
  }

  function resumeJob(id) {
    const job = store.getJob(id);
    if (!job) return { notFound: true };
    if (!["failed", "paused", "interrupted"].includes(job.status)) {
      return { error: "Chỉ có thể tiếp tục job đã lỗi, tạm dừng hoặc bị gián đoạn" };
    }
    if (!fs.existsSync(job.resultsPaths.CHECKPOINT_PATH)) {
      return { error: "Không tìm thấy checkpoint để tiếp tục job này" };
    }

    if (currentRunning() < maxConcurrent) {
      startJob(job);
      return { job, queued: false };
    }
    job.status = "queued";
    store.pushQueue(job.id);
    store.persist();
    refreshJobReport(job);
    return { job, queued: true, queuePosition: store.queueLength() };
  }

  function removeJob(id) {
    const j = store.getJob(id);
    if (!j) return { notFound: true };

    if (j.status === "queued") {
      store.removeFromQueue(j.id);
    }

    if (j.status === "running") {
      try {
        j.child.kill("SIGINT");
      } catch {
        // ignore
      }
    }

    store.deleteJob(id);
    return { ok: true };
  }

  return {
    createJob,
    listJobs,
    getJob,
    getJobReport,
    getJobProgress,
    queuePosition,
    setMaxConcurrent,
    stopJob,
    resumeJob,
    removeJob,
    rootDir,
    resultsBase,
  };
}

module.exports = {
  createScraperService,
};
