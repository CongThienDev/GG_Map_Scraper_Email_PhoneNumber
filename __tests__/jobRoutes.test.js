const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Buffer } = require("buffer");
const request = require("supertest");
const ExcelJS = require("exceljs");
const { createJobRoutes } = require("../app/routes/jobRoutes");

function createTestApp(scraperService) {
  const app = express();
  app.use(express.json());
  app.use(createJobRoutes({ scraperService }));
  return app;
}

function createTestAppWithCatalog(scraperService, areaCatalogService) {
  const app = express();
  app.use(express.json());
  app.use(createJobRoutes({ scraperService, areaCatalogService }));
  return app;
}

function createTestAppWithUnitedStatesCatalog(scraperService, unitedStatesAreaCatalogService) {
  const app = express();
  app.use(express.json());
  app.use(createJobRoutes({ scraperService, unitedStatesAreaCatalogService }));
  return app;
}

describe("jobRoutes", () => {
  test("POST /jobs creates job successfully", async () => {
    const scraperService = {
      resultsBase: "/tmp/results",
      createJob: jest.fn().mockReturnValue({
        queued: false,
        job: {
          id: "1",
          status: "running",
          resultsPaths: {
            CSV_PATH: "/tmp/results/a.csv",
            CHECKPOINT_PATH: "/tmp/results/checkpoint_a.json",
          },
        },
      }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app)
      .post("/jobs")
      .send({ city: "Hamburg", keywords: "architect,painter" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("1");
    expect(res.body.queued).toBe(false);
    expect(res.body.checkpointUrl).toBe("/results/checkpoint_a.json");
    expect(scraperService.createJob).toHaveBeenCalledTimes(1);
  });

  test("POST /jobs returns 400 when service validation fails", async () => {
    const scraperService = {
      createJob: jest.fn().mockReturnValue({ error: "Thiếu city hoặc keywords" }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).post("/jobs").send({ city: "", keywords: "" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Thiếu city hoặc keywords/);
  });

  test("POST /jobs/batch creates one job per unique catalog area", async () => {
    const scraperService = {
      createJob: jest.fn().mockReturnValue({ job: { id: "job-1" }, queued: false }),
    };
    const area = { id: "osm-r2", name: "Hải Châu", parentName: "Đà Nẵng", level: 6 };
    const areaCatalogService = {
      getAreasByIds: jest.fn().mockReturnValue([area]),
      polygonPathFor: jest.fn().mockReturnValue("/tmp/osm-r2.json"),
    };
    const app = createTestAppWithCatalog(scraperService, areaCatalogService);
    const res = await request(app)
      .post("/jobs/batch")
      .send({ areaIds: ["osm-r2", "osm-r2"], keywords: "spa", STEP_METERS: 1200 });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);
    expect(scraperService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        city: "Hải Châu",
        country: "Vietnam",
        state: "Đà Nẵng",
        POLYGON_PATH: "/tmp/osm-r2.json",
      })
    );
  });

  test("GET /jobs returns list and stats", async () => {
    const payload = { jobs: [{ id: "1" }], stats: { running: 1, queueLength: 0 } };
    const scraperService = {
      listJobs: jest.fn().mockReturnValue(payload),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).get("/jobs");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  test("GET /jobs infers a State only when a legacy US area has one catalog match", async () => {
    const scraperService = {
      listJobs: jest.fn().mockReturnValue({
        jobs: [
          { id: "1", CITY: "Autauga", COUNTRY: "United States", STATE: "" },
          { id: "2", CITY: "Washington", COUNTRY: "United States", STATE: "" },
        ],
        stats: {},
      }),
    };
    const unitedStatesAreaCatalogService = {
      listAreas: jest.fn(({ q }) =>
        q === "Autauga"
          ? [{ name: "Autauga", parentName: "Alabama" }]
          : [
              { name: "Washington", parentName: "Oregon" },
              { name: "Washington", parentName: "Utah" },
            ]
      ),
    };
    const app = createTestAppWithUnitedStatesCatalog(scraperService, unitedStatesAreaCatalogService);

    const res = await request(app).get("/jobs");

    expect(res.body.jobs).toEqual([
      expect.objectContaining({ id: "1", STATE: "Alabama" }),
      expect.objectContaining({ id: "2", STATE: "" }),
    ]);
  });

  test("PATCH /jobs/settings changes the concurrent-job limit", async () => {
    const scraperService = {
      setMaxConcurrent: jest.fn().mockReturnValue({ maxConcurrent: 4 }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).patch("/jobs/settings").send({ maxConcurrent: 4 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ maxConcurrent: 4 });
    expect(scraperService.setMaxConcurrent).toHaveBeenCalledWith(4);
  });

  test("GET /jobs/:id/status returns 404 when missing", async () => {
    const scraperService = {
      getJob: jest.fn().mockReturnValue(null),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).get("/jobs/404/status");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not found");
  });

  test("POST /jobs/:id/stop maps service error to 500", async () => {
    const scraperService = {
      stopJob: jest.fn().mockReturnValue({ error: "cannot kill process" }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).post("/jobs/1/stop");

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/cannot kill process/);
  });

  test("POST /jobs/:id/resume continues a resumable job", async () => {
    const scraperService = {
      resumeJob: jest.fn().mockReturnValue({ job: { id: "1", status: "running" }, queued: false }),
    };
    const app = createTestApp(scraperService);
    const res = await request(app).post("/jobs/1/resume");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "1", status: "running", queued: false });
  });

  test("POST /jobs/:id/clone creates a new job with edited settings", async () => {
    const scraperService = {
      cloneJob: jest.fn().mockReturnValue({
        queued: true,
        queuePosition: 2,
        job: { id: "2", status: "queued", plannedGridCount: 728 },
      }),
    };
    const app = createTestApp(scraperService);
    const res = await request(app)
      .post("/jobs/1/clone")
      .send({ STEP_METERS: 4000, keywords: "architect" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: "2",
      status: "queued",
      queued: true,
      queuePosition: 2,
      plannedGridCount: 728,
    });
    expect(scraperService.cloneJob).toHaveBeenCalledWith("1", {
      STEP_METERS: 4000,
      keywords: "architect",
    });
  });

  test("POST /jobs/:id/estimate returns an edited grid estimate", async () => {
    const scraperService = {
      getJob: jest.fn().mockReturnValue({ env: { POLYGON_PATH: "/tmp/area.json" } }),
      estimateGridCount: jest.fn().mockReturnValue(728),
    };
    const app = createTestApp(scraperService);
    const res = await request(app).post("/jobs/1/estimate").send({ STEP_METERS: 4000 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ plannedGridCount: 728 });
    expect(scraperService.estimateGridCount).toHaveBeenCalledWith("/tmp/area.json", 4000);
  });

  test("GET /jobs/:id/excel includes a job-report sheet and leads sheet", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maps-report-route-"));
    const csvPath = path.join(tempDir, "leads.csv");
    fs.writeFileSync(csvPath, "STT,Name\n1,Example Dental\n", "utf8");
    const scraperService = {
      getJob: jest.fn().mockReturnValue({ id: "1", resultsPaths: { CSV_PATH: csvPath } }),
      getJobReport: jest.fn().mockReturnValue({
        job_id: "1",
        status: "finished",
        created_at: "2026-09-09T00:00:00.000Z",
        completed_at: "2026-09-09T00:01:00.000Z",
        active_duration_seconds: 60,
      }),
    };
    const app = createTestApp(scraperService);

    try {
      const res = await request(app)
        .get("/jobs/1/excel")
        .buffer(true)
        .parse((response, callback) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Job report", "Leads"]);
      expect(workbook.getWorksheet("Job report").getCell("A2").value).toBe("job_id");
      expect(workbook.getWorksheet("Leads").getCell("B2").value).toBe("Example Dental");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
