const express = require("express");
const request = require("supertest");
const { createSystemRoutes } = require("../app/routes/systemRoutes");

test("GET /system/metrics returns the service snapshot without client caching", async () => {
  const snapshot = { collectedAt: "2026-09-10T00:00:00.000Z", host: { status: "available" } };
  const app = express();
  app.use(createSystemRoutes({ systemMetricsService: { snapshot: () => snapshot } }));

  const response = await request(app).get("/system/metrics");

  expect(response.status).toBe(200);
  expect(response.body).toEqual(snapshot);
  expect(response.headers["cache-control"]).toBe("no-store");
});
