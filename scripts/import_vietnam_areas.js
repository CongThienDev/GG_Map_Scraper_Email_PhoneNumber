#!/usr/bin/env node
/* Imports current Vietnam provinces + practical crawl areas; no bulk Nominatim/Overpass calls. */
const fs = require("fs");
const path = require("path");
const https = require("https");

const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data", "vietnam");
const boundaryDir = path.join(dataDir, "boundaries");
const apiBase =
  process.env.GEOBOUNDARIES_API || "https://www.geoboundaries.org/api/current/gbOpen/VNM";
const provinceUrl =
  process.env.VN_PROVINCES_GEOJSON_URL ||
  "https://raw.githubusercontent.com/nguyenduy1133/Free-GIS-Data/main/Vietnam%20Administrative%20Divisions%20%28Post-2025%29%20-%20%C4%90%C6%A1n%20v%E1%BB%8B%20h%C3%A0nh%20ch%C3%ADnh%20Vi%E1%BB%87t%20Nam%20%28T%E1%BB%AB%202025%29/Provinces.geojson";
const userAgent = process.env.GEOBOUNDARIES_USER_AGENT || "maps-prospects/1.0";
const specialAreaParents = { "Con Dao": "Hồ Chí Minh" };

function getJson(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": userAgent } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (!redirects)
          return reject(new Error("Too many redirects while downloading boundary data"));
        return resolve(getJson(new URL(response.headers.location, url).toString(), redirects - 1));
      }
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        if ((response.statusCode || 500) >= 400)
          return reject(new Error(`Boundary source HTTP ${response.statusCode}`));
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Boundary source returned invalid JSON: ${error.message}`));
        }
      });
    });
    request.setTimeout(180000, () => request.destroy(new Error("Boundary download timed out")));
    request.on("error", reject);
  });
}

function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const squared = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const distance = (point, a, b) => {
    let dx = b[0] - a[0],
      dy = b[1] - a[1];
    if (dx || dy) {
      const t = Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy))
      );
      dx = point[0] - (a[0] + dx * t);
      dy = point[1] - (a[1] + dy * t);
    } else {
      dx = point[0] - a[0];
      dy = point[1] - a[1];
    }
    return dx * dx + dy * dy;
  };
  const walk = (first, last) => {
    let max = squared,
      at = -1;
    for (let i = first + 1; i < last; i += 1) {
      const current = distance(points[i], points[first], points[last]);
      if (current > max) {
        at = i;
        max = current;
      }
    }
    if (at !== -1) {
      keep[at] = 1;
      walk(first, at);
      walk(at, last);
    }
  };
  walk(0, points.length - 1);
  return points.filter((_, index) => keep[index]);
}

function outerRings(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates.slice(0, 1);
  if (geometry?.type === "MultiPolygon")
    return geometry.coordinates.map((polygon) => polygon[0]).filter(Boolean);
  return [];
}

function bbox(rings) {
  const points = rings.flat();
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function toArea(feature, level) {
  const rings = outerRings(feature.geometry).filter((ring) => ring.length >= 4);
  if (!rings.length) return null;
  const sourceId = String(
    feature.properties?.shapeID || feature.properties?.Ma || feature.properties?.shapeName || ""
  );
  const id = `gb-${sourceId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}`;
  if (id === "gb-") return null;
  return {
    id,
    sourceId,
    name: String(feature.properties?.TinhThanh || feature.properties?.shapeName || sourceId),
    nameEn: "",
    level,
    kind: level === 4 ? "province" : "crawl-area",
    bbox: bbox(rings),
    geometry: {
      type: "MultiPolygon",
      coordinates: rings.map((ring) => [simplify(ring, level === 4 ? 0.0008 : 0.0003)]),
    },
    fullPolygon: rings,
  };
}

async function downloadLevel(level) {
  const metadata = await getJson(`${apiBase}/ADM${level}/`);
  if (!metadata.gjDownloadURL) throw new Error(`No GeoJSON download URL for ADM${level}`);
  return { metadata, geojson: await getJson(metadata.gjDownloadURL) };
}

async function main() {
  console.log("[VN] Downloading current provincial boundaries (post-2025)…");
  const provinceGeojson = await getJson(provinceUrl);
  console.log("[VN] Downloading static crawl-area boundaries (ADM2)…");
  const adm2 = await downloadLevel(2);
  const provinces = (provinceGeojson.features || [])
    .map((feature) => toArea(feature, 4))
    .filter(Boolean);
  const crawlAreas = (adm2.geojson.features || [])
    .map((feature) => toArea(feature, 6))
    .filter(Boolean);
  crawlAreas.forEach((area) => {
    const [minX, minY, maxX, maxY] = area.bbox;
    const center = [(minX + maxX) / 2, (minY + maxY) / 2];
    const samples = [
      center,
      ...area.fullPolygon.flatMap((ring) => ring.filter((_, index) => index % 20 === 0)),
    ];
    const candidate = provinces
      .map((province) => ({
        province,
        score: samples.filter((point) =>
          province.fullPolygon.some((ring) => pointInRing(point, ring))
        ).length,
      }))
      .sort((a, b) => b.score - a.score)[0];
    const parent =
      (candidate?.score > 0 ? candidate.province : null) ||
      provinces.find((province) => province.name.includes(specialAreaParents[area.name])) ||
      null;
    area.parentId = parent?.id || "";
    area.parentName = parent?.name || "Chưa xác định";
  });
  fs.mkdirSync(boundaryDir, { recursive: true });
  for (const area of crawlAreas) {
    fs.writeFileSync(
      path.join(boundaryDir, `${area.id}.json`),
      JSON.stringify({ city: area.name, polygon: area.fullPolygon }),
      "utf8"
    );
    delete area.fullPolygon;
  }
  provinces.forEach((area) => delete area.fullPolygon);
  const catalog = {
    version: 1,
    countryCode: "VN",
    source: `Post-2025 provincial GeoJSON + geoBoundaries ADM2 (${adm2.metadata.boundaryYearRepresented || "unknown"})`,
    importedAt: new Date().toISOString(),
    areas: [...provinces, ...crawlAreas],
  };
  fs.mkdirSync(dataDir, { recursive: true });
  const tempPath = path.join(dataDir, `catalog-${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, JSON.stringify(catalog), "utf8");
  fs.renameSync(tempPath, path.join(dataDir, "catalog.json"));
  console.log(
    `[VN] Ready: ${provinces.length} tỉnh/thành cấp tỉnh, ${crawlAreas.length} khu vực crawl.`
  );
}

main().catch((error) => {
  console.error(`[VN] Import failed: ${error.message}`);
  process.exit(1);
});
