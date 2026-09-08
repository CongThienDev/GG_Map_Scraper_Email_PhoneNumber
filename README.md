# GG Map Scraper Email/PhoneNumber

Node.js app to run multi-job Google Maps scraping with a web UI, job queue, live logs, and checkpoint/resume.

## Tech stack

- Node.js + Express
- Puppeteer scraper worker
- Session auth + rate limit
- Jest + Supertest tests
- ESLint + Prettier
- Zod env validation

## Project structure

- `server.js`: bootstrap
- `app/createApp.js`: app composition
- `app/routes/*`: HTTP routes
- `app/services/*`: job queue, scraper process orchestration, polygon jobs
- `scraper/maps_scan_east_architects_hamburg.js`: scraping worker
- `public/index.html`: UI

## Local run

1. Install deps:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Start server:

```bash
npm start
```

4. Open `http://localhost:8080/login`

## Quality commands

- Run tests:

```bash
npm test
```

- Lint:

```bash
npm run lint
```

- Auto-fix lint:

```bash
npm run lint:fix
```

- Format:

```bash
npm run format
```

- Check format only:

```bash
npm run format:check
```

## Prefetch Polygon For One City

```bash
npm run polygon:city -- --city "Hà Nội" --country "Vietnam"
```

Optional output path:

```bash
npm run polygon:city -- --city "Hà Nội" --country "Vietnam" --out "Polygon_List/polygon_H__N_i.json"
```

Fetch directly by OSM relation id (more stable than city search):

```bash
npm run polygon:city -- --osm-id "R1903516" --city "Hà Nội" --out "Polygon_List/polygon_H__N_i.json"
```

## Vietnam area catalog and batch crawl

The **Bản đồ Việt Nam** tab imports administrative boundaries once, saves full polygons in
`data/vietnam/boundaries/`, and creates one crawl job for every selected area. It does not
bulk-query Nominatim. Click **Nạp/cập nhật catalog** in the UI, or run:

```bash
npm run areas:vn
```

The import uses current post-2025 province geometry for filters, plus static `geoBoundaries`
ADM2 geometry for the 708 practical crawl areas; it then saves the result locally. Set
`VN_PROVINCES_GEOJSON_URL` or `GEOBOUNDARIES_API` only when using a compatible mirror. The
browser receives simplified display geometry; the scraper receives the full local polygon for
each job.

## Environment validation (fail-fast)

Env is validated at startup in `app/config/env.js` via `zod`.
Server exits immediately with clear error messages when required values are missing or invalid.

Required:

- `SESSION_SECRET`
- `ADMIN_USER`
- `ADMIN_HASH`

## Docker (one-command run)

Build and run:

```bash
docker compose up -d --build
```

Stop:

```bash
docker compose down
```

App listens on `http://localhost:8080`.

## Limitations

- Google Maps DOM changes can break selectors and require scraper updates.
- Large crawling workloads require stable network and memory tuning.
- Respect target terms of service and local data regulations.
