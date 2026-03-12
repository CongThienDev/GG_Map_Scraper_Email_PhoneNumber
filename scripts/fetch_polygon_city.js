#!/usr/bin/env node
// scripts/fetch_polygon_city.js
// Fetch a single city polygon and save as JSON compatible with scraper.
//
// Usage:
//   node scripts/fetch_polygon_city.js --city "Hà Nội" --country "Vietnam"
//   node scripts/fetch_polygon_city.js --city "Hà Nội" --country "Vietnam" --out scraper/polygon_H__N_i.json

const fs = require('fs');
const path = require('path');
const https = require('https');

const args = process.argv.slice(2);

function getArg(name, fallback = '') {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const v = args[idx + 1];
  if (!v || v.startsWith('--')) return fallback;
  return v;
}

const city = getArg('city', process.env.CITY || '').trim();
const country = getArg('country', process.env.COUNTRY || '').trim();
const outArg = getArg('out', '').trim();
const osmIdArg = getArg('osm-id', process.env.OSM_ID || '').trim();
const delayMs = Number(process.env.POLY_DELAY_MS || 900);

if (!city && !osmIdArg) {
  console.error('Missing input. Use --city "Hà Nội" or --osm-id "R1903516"');
  process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const polygonDir = path.join(projectRoot, 'Polygon_List');
fs.mkdirSync(polygonDir, { recursive: true });

const UA = { 'User-Agent': 'maps-scraper/1.0 (polygon prefetch city)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toSafeName(name) {
  return name
    .normalize('NFC')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\wäöüÄÖÜß-]+/g, '_');
}

function stripDiacritics(s = '') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function cityAliases(input) {
  const base = input.trim();
  const aliases = new Set([base]);
  const noAccent = stripDiacritics(base);
  aliases.add(noAccent);
  aliases.add(noAccent.replace(/\s+/g, ' ').trim());
  aliases.add(noAccent.replace(/\s+/g, ''));
  return Array.from(aliases).filter(Boolean);
}

function httpGetJSON(url, maxRetries = 4) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      https
        .get(url, { headers: UA }, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            const status = res.statusCode || 0;
            if (status === 429 || status >= 500) {
              if (n < maxRetries) {
                const wait = 600 * Math.pow(2, n);
                console.log(`[POLY] HTTP ${status}, retry in ${wait}ms`);
                return setTimeout(() => attempt(n + 1), wait);
              }
              return reject(new Error(`HTTP ${status}`));
            }
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(e);
            }
          });
        })
        .on('error', (e) => {
          if (n < maxRetries) {
            const wait = 600 * Math.pow(2, n);
            console.log(`[POLY] network error ${e.message}, retry in ${wait}ms`);
            return setTimeout(() => attempt(n + 1), wait);
          }
          reject(e);
        });
    };
    attempt(0);
  });
}

function normalizeOsmId(raw = '') {
  const v = raw.trim().toUpperCase();
  if (!v) return '';
  if (/^[RNW]\d+$/.test(v)) return v;
  if (/^\d+$/.test(v)) return `R${v}`;
  return '';
}

function pickBestHit(items, preferredCountry = '') {
  const countryLC = preferredCountry.toLowerCase();
  const wantedTypes = new Set(['administrative', 'city', 'municipality', 'borough']);

  const withBoundary = items.filter(
    (x) => x && x.geojson && x.class === 'boundary' && (wantedTypes.has(x.type) || x.type === 'city')
  );
  const countryMatched = withBoundary.filter((x) => {
    if (!countryLC) return true;
    const c = (x?.address?.country || '').toLowerCase();
    return c.includes(countryLC);
  });
  const candidates = countryMatched.length ? countryMatched : withBoundary.length ? withBoundary : items.filter((x) => x && x.geojson);

  candidates.sort((a, b) => {
    const aRel = a.osm_type === 'relation' ? 1 : 0;
    const bRel = b.osm_type === 'relation' ? 1 : 0;
    if (bRel !== aRel) return bRel - aRel;
    return (b.importance || 0) - (a.importance || 0);
  });
  return candidates[0] || null;
}

function geojsonToPolygon(gj) {
  if (!gj) return null;
  if (gj.type === 'Polygon') return [gj.coordinates[0]];
  if (gj.type === 'MultiPolygon') return gj.coordinates.map((rings) => rings[0]);
  return null;
}

function buildQueries(cityName, countryName) {
  const cc = countryName ? `&country=${encodeURIComponent(countryName)}` : '';
  return [
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=8&city=${encodeURIComponent(cityName)}${cc}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=10&q=${encodeURIComponent(cityName + (countryName ? `, ${countryName}` : ''))}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=10&q=${encodeURIComponent(cityName)}`
  ];
}

async function fetchPolygon(cityName, countryName) {
  const aliases = cityAliases(cityName);
  for (const name of aliases) {
    const queries = buildQueries(name, countryName);
    for (const q of queries) {
      try {
        console.log('[POLY] fetch:', q);
        const res = await httpGetJSON(q).catch(() => null);
        if (Array.isArray(res) && res.length) {
          const hit = pickBestHit(res, countryName);
          if (hit && hit.geojson) {
            return { nameUsed: name, geojson: hit.geojson };
          }
        }
      } catch (e) {
        console.log('[POLY] error:', e.message);
      }
      await sleep(delayMs);
    }
  }
  return null;
}

async function fetchByOsmId(rawId) {
  const osmId = normalizeOsmId(rawId);
  if (!osmId) return null;
  const url = `https://nominatim.openstreetmap.org/lookup?format=jsonv2&addressdetails=1&polygon_geojson=1&osm_ids=${encodeURIComponent(osmId)}`;
  console.log('[POLY] lookup:', url);
  const res = await httpGetJSON(url).catch(() => null);
  if (!Array.isArray(res) || !res.length) return null;
  const hit = res[0];
  if (!hit || !hit.geojson) return null;
  return {
    nameUsed: hit?.name || hit?.display_name || city || osmId,
    geojson: hit.geojson
  };
}

async function main() {
  const labelForName = city || normalizeOsmId(osmIdArg) || 'city';
  const safe = toSafeName(labelForName);
  const defaultOut = path.join(polygonDir, `polygon_${safe}.json`);
  const outPath = outArg
    ? path.isAbsolute(outArg)
      ? outArg
      : path.join(projectRoot, outArg)
    : defaultOut;

  let found = null;
  if (osmIdArg) {
    found = await fetchByOsmId(osmIdArg);
  }
  if (!found && city) {
    found = await fetchPolygon(city, country);
  }
  if (!found) {
    console.error(
      `[FAIL] không lấy được polygon cho "${city || osmIdArg}"${country ? `, ${country}` : ''}`
    );
    process.exit(2);
  }

  const polygon = geojsonToPolygon(found.geojson);
  if (!polygon || !polygon.length) {
    console.error('[FAIL] có kết quả nhưng geojson không phải Polygon/MultiPolygon');
    process.exit(3);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    JSON.stringify({ city: city || String(found.nameUsed || labelForName), polygon }, null, 2),
    'utf8'
  );
  console.log(`[OK] saved ${outPath}`);
  console.log(`[INFO] city alias used: ${found.nameUsed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
