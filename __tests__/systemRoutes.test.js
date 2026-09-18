const express = require("express");
const request = require("supertest");
const { createSystemRoutes, proxyStatus } = require("../app/routes/systemRoutes");

test("GET /system/metrics returns the service snapshot plus proxy status without client caching", async () => {
  const snapshot = { collectedAt: "2026-09-10T00:00:00.000Z", host: { status: "available" } };
  const app = express();
  app.use(createSystemRoutes({ systemMetricsService: { snapshot: () => snapshot } }));

  const response = await request(app).get("/system/metrics");

  expect(response.status).toBe(200);
  expect(response.body).toMatchObject(snapshot);
  expect(response.body.proxy).toMatchObject({ enabled: expect.any(Boolean), active: expect.any(Boolean) });
  expect(response.headers["cache-control"]).toBe("no-store");
});

test("proxyStatus reports active + masked credentials when fully configured", () => {
  const env = process.env;
  process.env = {
    ...env,
    PROXY_ENABLED: "true",
    PROXY_HOST: "rp.scrapegw.com",
    PROXY_PORT: "6060",
    PROXY_USERNAME: "0tt9iqxs49v6hp3-country-us",
    PROXY_PASSWORD: "secretpass",
    BLOCK_ASSETS: "true",
  };
  try {
    const status = proxyStatus();
    expect(status.active).toBe(true);
    expect(status.endpoint).toBe("rp.scrapegw.com:6060");
    expect(status.geo).toBe("US");
    expect(status.username).not.toContain("country-us"); // masked
    expect(status.blockAssets).toBe(true);
  } finally {
    process.env = env;
  }
});

test("proxyStatus is inactive and flags misconfig when enabled without credentials", () => {
  const env = process.env;
  process.env = { ...env, PROXY_ENABLED: "true", PROXY_HOST: "", PROXY_PORT: "", PROXY_USERNAME: "", PROXY_PASSWORD: "" };
  try {
    const status = proxyStatus();
    expect(status.enabled).toBe(true);
    expect(status.active).toBe(false);
    expect(status.reason).toMatch(/thiếu/i);
  } finally {
    process.env = env;
  }
});
