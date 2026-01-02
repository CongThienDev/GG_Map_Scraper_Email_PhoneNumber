#!/usr/bin/env node
// scripts/fetch_polygons_batch.js
// Prefetch city polygons to local files to avoid runtime Nominatim calls.
// Usage:
//   node scripts/fetch_polygons_batch.js Hamburg Berlin
//   node scripts/fetch_polygons_batch.js --file city_list.txt
// Output files: polygon_<City>.json in project root.

const fs = require('fs');
const path = require('path');
const https = require('https');

const UA = { 'User-Agent': 'maps-scraper/1.0 (batch polygon prefetch)' };
const projectRoot = path.join(__dirname, '..');
const polygonDir = path.join(projectRoot, 'Polygon_List');
try { fs.mkdirSync(polygonDir, { recursive: true }); } catch { }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function readCitiesFromArgs() {
  const args = process.argv.slice(2);
  const fileArgIdx = args.indexOf('--file');
  if (fileArgIdx !== -1) {
    const filePath = args[fileArgIdx + 1];
    if (!filePath) throw new Error('Missing filename after --file');
    const content = fs.readFileSync(filePath, 'utf8');
    return content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }
  return args.filter(a => !a.startsWith('--')).map(s => s.trim()).filter(Boolean);
}

function toSafeName(city) {
  return city
    .normalize('NFC')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\wäöüÄÖÜß-]+/g, '_');
}

function httpGetJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: UA }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function pickBestHit(arr, country) {
  const wantedTypes = new Set(['administrative', 'city', 'municipality', 'borough']);
  let candidates = arr.filter(x =>
    x && x.geojson && x.class === 'boundary' &&
    (wantedTypes.has(x.type) || x.type === 'city') &&
    (!country || (x.address && x.address.country && x.address.country.toLowerCase().includes(country.toLowerCase())))
  );
  if (!candidates.length) candidates = arr.filter(x => x && x.geojson);
  candidates.sort((a, b) => {
    const aRel = (a.osm_type === 'relation') ? 1 : 0;
    const bRel = (b.osm_type === 'relation') ? 1 : 0;
    if (bRel !== aRel) return bRel - aRel;
    return (b.importance || 0) - (a.importance || 0);
  });
  return candidates[0] || null;
}

async function fetchPolygon(city, country = '') {
  const queries = [
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=5&city=${encodeURIComponent(city)}${country ? `&country=${encodeURIComponent(country)}` : ''}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=10&q=${encodeURIComponent(city + (country ? ', ' + country : ''))}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=10&q=${encodeURIComponent(city)}`
  ];

  for (const url of queries) {
    try {
      console.log('[POLY] fetch:', url);
      const res = await httpGetJSON(url);
      if (Array.isArray(res) && res.length) {
        const hit = pickBestHit(res, country);
        if (hit && hit.geojson) return hit.geojson;
      }
    } catch (e) {
      console.log('[POLY] error:', e.message);
    }
    await sleep(800);
  }
  return null;
}

function geojsonToPolygon(gj) {
  if (!gj) return null;
  if (gj.type === 'Polygon') return [gj.coordinates[0]];
  if (gj.type === 'MultiPolygon') return gj.coordinates.map(r => r[0]);
  return null;
}

async function main() {
  const cities = readCitiesFromArgs();
  if (!cities.length) {
    console.error('Usage: node scripts/fetch_polygons_batch.js City1 City2 ...');
    console.error('   or: node scripts/fetch_polygons_batch.js --file city_list.txt');
    process.exit(1);
  }

  const country = process.env.COUNTRY || '';

  for (const city of cities) {
    const safe = toSafeName(city);
    const outPath = path.join(polygonDir, `polygon_${safe}.json`);
    const altPath = path.join(projectRoot, `polygon_${safe}.json`);
    if (fs.existsSync(outPath) || fs.existsSync(altPath)) {
      console.log(`[SKIP] ${city} -> đã có file ${fs.existsSync(outPath) ? outPath : altPath}`);
      continue;
    }

    const gj = await fetchPolygon(city, country);
    const poly = geojsonToPolygon(gj);
    if (!poly) {
      console.log(`[FAIL] ${city} -> không lấy được polygon`);
      continue;
    }

    fs.writeFileSync(outPath, JSON.stringify({ city, polygon: poly }, null, 2), 'utf8');
    console.log(`[OK] ${city} -> saved ${outPath} (${poly.length} ring(s))`);
    await sleep(1200); // nhẹ nhàng để tránh rate-limit
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
