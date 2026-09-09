const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");

jest.mock("child_process", () => ({
  spawn: jest.fn(),
}));

const { spawn } = require("child_process");
const { createJobStore } = require("../app/services/jobStore");
const { createScraperService } = require("../app/services/scraperService");

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  return child;
}

function makeConfig(baseDir, overrides = {}) {
  const scriptDir = path.join(baseDir, "scraper");
  const scriptPath = path.join(scriptDir, "maps_scan_east_architects_hamburg.js");
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(scriptPath, 'console.log("test");\n', "utf8");

  return {
    rootDir: baseDir,
    scriptPath,
    resultsBase: path.join(baseDir, "results"),
    defaults: {
      maxConcurrent: 1,
      stepMeters: 1200,
      maxCells: 0,
      maxLinksPerCell: 0,
      resetEveryCells: 3,
      browserMaxAgeMs: 1800000,
      headless: true,
      polygonPath: "",
      fallbackRadiusMeters: 0,
      allowRoughBbox: false,
      ...overrides,
    },
  };
}

describe("scraperService", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-scraper-test-"));
    spawn.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("creates and starts job immediately when slot is available", () => {
    const child = makeFakeChild();
    spawn.mockReturnValue(child);

    const store = createJobStore();
    const service = createScraperService({ config: makeConfig(tempDir), store });

    const ret = service.createJob({
      city: "Hamburg",
      country: "Germany",
      keywords: "architect,painter",
    });

    expect(ret.queued).toBe(false);
    expect(ret.job.status).toBe("running");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][2].env.COUNTRY).toBe("Germany");

    child.emit("exit", 0);
    expect(ret.job.status).toBe("finished");
  });

  test("writes a CSV report with lifecycle and crawl metrics", () => {
    const child = makeFakeChild();
    spawn.mockReturnValue(child);

    const store = createJobStore();
    const service = createScraperService({ config: makeConfig(tempDir), store });
    const { job } = service.createJob({ city: "Hội An", country: "Việt Nam", keywords: "spa" });
    fs.writeFileSync(
      job.resultsPaths.CHECKPOINT_PATH,
      JSON.stringify({
        currentCell: 4,
        totalCells: 10,
        processedCount: 17,
        benchmarkMetrics: { detailPagesOpened: 20, earlyDuplicatesSkipped: 8, urlsScheduled: 28 },
      }),
      "utf8"
    );

    child.emit("exit", 0);

    expect(job.status).toBe("finished");
    expect(job.completedAt).toEqual(expect.any(Number));
    expect(fs.existsSync(job.resultsPaths.REPORT_CSV_PATH)).toBe(true);
    const [header, row] = fs.readFileSync(job.resultsPaths.REPORT_CSV_PATH, "utf8").trim().split("\n");
    expect(header).toContain("created_at");
    expect(header).toContain("completed_at");
    expect(header).toContain("active_duration_seconds");
    expect(header).toContain("duplicates_avoided");
    expect(row).toContain("finished");
  });

  test("queues jobs when max concurrency is reached and auto-starts on previous exit", () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    spawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    const store = createJobStore();
    const service = createScraperService({
      config: makeConfig(tempDir, { maxConcurrent: 1 }),
      store,
    });

    const first = service.createJob({ city: "Berlin", keywords: "lawyer" });
    const second = service.createJob({ city: "Munich", keywords: "doctor" });

    expect(first.queued).toBe(false);
    expect(second.queued).toBe(true);
    expect(second.job.status).toBe("queued");
    expect(spawn).toHaveBeenCalledTimes(1);

    child1.emit("exit", 0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(second.job.status).toBe("running");

    child2.emit("exit", 0);
    expect(second.job.status).toBe("finished");
  });

  test("starts queued jobs when the concurrent-job limit is increased", () => {
    const child1 = makeFakeChild();
    const child2 = makeFakeChild();
    spawn.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    const store = createJobStore();
    const service = createScraperService({
      config: makeConfig(tempDir, { maxConcurrent: 1 }),
      store,
    });

    service.createJob({ city: "Berlin", keywords: "lawyer" });
    const queued = service.createJob({ city: "Munich", keywords: "doctor" });

    expect(service.listJobs().jobs.find((job) => job.id === queued.job.id).queuePosition).toBe(1);

    expect(service.setMaxConcurrent(2)).toEqual({ maxConcurrent: 2 });
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(queued.job.status).toBe("running");
    expect(service.listJobs().stats.maxConcurrent).toBe(2);
  });

  test("uses the runtime concurrent-job limit when resuming a job", () => {
    const activeChild = makeFakeChild();
    const pausedChild = makeFakeChild();
    const resumedChild = makeFakeChild();
    spawn
      .mockReturnValueOnce(activeChild)
      .mockReturnValueOnce(pausedChild)
      .mockReturnValueOnce(resumedChild);

    const store = createJobStore();
    const service = createScraperService({
      config: makeConfig(tempDir, { maxConcurrent: 2 }),
      store,
    });
    const active = service.createJob({ city: "Berlin", keywords: "lawyer" });
    const paused = service.createJob({ city: "Munich", keywords: "doctor" });
    fs.writeFileSync(paused.job.resultsPaths.CHECKPOINT_PATH, JSON.stringify({ nextCellIndex: 1 }));
    service.stopJob(paused.job.id);
    pausedChild.emit("exit", null, "SIGINT");

    service.setMaxConcurrent(1);
    const resumed = service.resumeJob(paused.job.id);

    expect(active.job.status).toBe("running");
    expect(resumed.queued).toBe(true);
    expect(paused.job.status).toBe("queued");
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test("reads progress payload from checkpoint, centers and polygon files", () => {
    const child = makeFakeChild();
    spawn.mockReturnValue(child);

    const store = createJobStore();
    const service = createScraperService({ config: makeConfig(tempDir), store });
    const { job } = service.createJob({ city: "Cologne", keywords: "restaurant" });

    fs.writeFileSync(
      job.resultsPaths.CHECKPOINT_PATH,
      JSON.stringify({
        currentCell: 2,
        totalCells: 3,
        processedCount: 11,
        lastKeyword: "restaurant",
        benchmarkMetrics: { detailPagesOpened: 10, earlyDuplicatesSkipped: 3 },
      }),
      "utf8"
    );
    fs.writeFileSync(job.resultsPaths.CENTERS_PATH, JSON.stringify([{ lat: 1, lng: 2 }]), "utf8");
    fs.writeFileSync(
      job.resultsPaths.POLYGON_OUT_PATH,
      JSON.stringify({ city: "Cologne", polygon: [] }),
      "utf8"
    );

    const progress = service.getJobProgress(job.id);

    expect(progress).not.toBeNull();
    expect(progress.currentCell).toBe(2);
    expect(progress.totalCells).toBe(3);
    expect(progress.processedCount).toBe(11);
    expect(progress.benchmarkMetrics).toEqual({ detailPagesOpened: 10, earlyDuplicatesSkipped: 3 });
    expect(progress.centersInline).toHaveLength(1);
    expect(progress.polygonInline.city).toBe("Cologne");
  });

  test("stopJob marks queued job as paused", () => {
    const child = makeFakeChild();
    spawn.mockReturnValue(child);

    const store = createJobStore();
    const service = createScraperService({
      config: makeConfig(tempDir, { maxConcurrent: 1 }),
      store,
    });

    service.createJob({ city: "A", keywords: "k" });
    const second = service.createJob({ city: "B", keywords: "k" });

    const ret = service.stopJob(second.job.id);

    expect(ret.status).toBe("paused");
    expect(second.job.status).toBe("paused");
  });

  test("resumes a failed job with its existing checkpoint and output paths", () => {
    const firstChild = makeFakeChild();
    const resumedChild = makeFakeChild();
    spawn.mockReturnValueOnce(firstChild).mockReturnValueOnce(resumedChild);

    const store = createJobStore();
    const service = createScraperService({ config: makeConfig(tempDir), store });
    const { job } = service.createJob({ city: "Hội An", keywords: "nails" });
    const checkpointPath = job.resultsPaths.CHECKPOINT_PATH;
    const csvPath = job.resultsPaths.CSV_PATH;
    fs.writeFileSync(checkpointPath, JSON.stringify({ nextCellIndex: 12 }), "utf8");

    firstChild.stderr.emit("data", "Chrome closed unexpectedly");
    firstChild.emit("exit", 1);
    const ret = service.resumeJob(job.id);

    expect(ret.queued).toBe(false);
    expect(job.status).toBe("running");
    expect(job.lastError).toBeNull();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls[1][2].env.CHECKPOINT_PATH).toBe(checkpointPath);
    expect(spawn.mock.calls[1][2].env.CSV_PATH).toBe(csvPath);
  });

  test("restores a running job as interrupted after a server restart", () => {
    const child = makeFakeChild();
    spawn.mockReturnValue(child);
    const config = makeConfig(tempDir);
    const persistencePath = path.join(tempDir, "data", "jobs.json");
    const firstStore = createJobStore({ persistencePath });
    const service = createScraperService({ config, store: firstStore });
    const { job } = service.createJob({ city: "Hội An", keywords: "spa" });

    const restoredStore = createJobStore({ persistencePath });
    const restored = restoredStore.getJob(job.id);

    expect(restored.status).toBe("interrupted");
    expect(restored.lastError).toMatch(/khởi động lại/);
    expect(restored.resultsPaths.CHECKPOINT_PATH).toBe(job.resultsPaths.CHECKPOINT_PATH);
  });

  test("removeJob kills running process and removes job from store", () => {
    const child = makeFakeChild();
    spawn.mockReturnValue(child);

    const store = createJobStore();
    const service = createScraperService({ config: makeConfig(tempDir), store });
    const { job } = service.createJob({ city: "Frankfurt", keywords: "plumber" });

    const ret = service.removeJob(job.id);

    expect(ret.ok).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGINT");
    expect(service.getJob(job.id)).toBeUndefined();
  });
});
