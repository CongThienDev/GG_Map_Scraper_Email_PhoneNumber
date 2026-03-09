const express = require('express');
const request = require('supertest');
const { createJobRoutes } = require('../app/routes/jobRoutes');

function createTestApp(scraperService) {
  const app = express();
  app.use(express.json());
  app.use(createJobRoutes({ scraperService }));
  return app;
}

describe('jobRoutes', () => {
  test('POST /jobs creates job successfully', async () => {
    const scraperService = {
      resultsBase: '/tmp/results',
      createJob: jest.fn().mockReturnValue({
        queued: false,
        job: {
          id: '1',
          status: 'running',
          resultsPaths: { CSV_PATH: '/tmp/results/a.csv' },
        },
      }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app)
      .post('/jobs')
      .send({ city: 'Hamburg', keywords: 'architect,painter' });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('1');
    expect(res.body.queued).toBe(false);
    expect(scraperService.createJob).toHaveBeenCalledTimes(1);
  });

  test('POST /jobs returns 400 when service validation fails', async () => {
    const scraperService = {
      createJob: jest.fn().mockReturnValue({ error: 'Thiếu city hoặc keywords' }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).post('/jobs').send({ city: '', keywords: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Thiếu city hoặc keywords/);
  });

  test('GET /jobs returns list and stats', async () => {
    const payload = { jobs: [{ id: '1' }], stats: { running: 1, queueLength: 0 } };
    const scraperService = {
      listJobs: jest.fn().mockReturnValue(payload),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).get('/jobs');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(payload);
  });

  test('GET /jobs/:id/status returns 404 when missing', async () => {
    const scraperService = {
      getJob: jest.fn().mockReturnValue(null),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).get('/jobs/404/status');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });

  test('POST /jobs/:id/stop maps service error to 500', async () => {
    const scraperService = {
      stopJob: jest.fn().mockReturnValue({ error: 'cannot kill process' }),
    };

    const app = createTestApp(scraperService);
    const res = await request(app).post('/jobs/1/stop');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/cannot kill process/);
  });
});
