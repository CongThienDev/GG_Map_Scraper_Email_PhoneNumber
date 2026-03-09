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

    const ret = service.createJob({ city: "Hamburg", keywords: "architect,painter" });

    expect(ret.queued).toBe(false);
    expect(ret.job.status).toBe("running");
    expect(spawn).toHaveBeenCalledTimes(1);

    child.emit("exit", 0);
    expect(ret.job.status).toBe("finished");
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
    expect(progress.centersInline).toHaveLength(1);
    expect(progress.polygonInline.city).toBe("Cologne");
  });

  test("stopJob marks queued job as failed", () => {
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

    expect(ret.status).toBe("failed");
    expect(second.job.status).toBe("failed");
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
