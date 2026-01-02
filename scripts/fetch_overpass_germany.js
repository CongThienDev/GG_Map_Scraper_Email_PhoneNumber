#!/usr/bin/env node
// Fetch all admin_level=8 boundaries in Germany from Overpass and split into Polygon_All_DE/polygon_<City>.json
// Usage: node scripts/fetch_overpass_germany.js

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, '..', 'Polygon_All_DE');
fs.mkdirSync(OUT_DIR, { recursive: true });

const query = `
[out:json][timeout:1800];
area["ISO3166-1"="DE"][admin_level=2]->.germany;
(
  relation["boundary"="administrative"]["admin_level"="8"](area.germany);
);
out geom;
`;

function overpassRequest(body){
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'overpass-api.de',
      path: '/api/interpreter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'maps-scraper/1.0 (polygon prefetch)'
      }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write('data=' + encodeURIComponent(body));
    req.end();
  });
}

function toSafeName(name){
  return (name || '')
    .normalize('NFC')
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue')
    .replace(/Ä/g,'Ae').replace(/Ö/g,'Oe').replace(/Ü/g,'Ue')
    .replace(/ß/g,'ss')
    .replace(/[^\wäöüÄÖÜß-]+/g,'_');
}

function relationToPolygons(rel){
  if (!rel || !Array.isArray(rel.members)) return null;
  const outers = rel.members.filter(m => m.role === 'outer' && Array.isArray(m.geometry));
  if (!outers.length) return null;
  // Overpass geometry is [{lat,lon},...]; build ring
  const rings = outers.map(m => m.geometry.map(p => [p.lon, p.lat]));
  return rings;
}

async function main(){
  console.log('[OVERPASS] downloading Germany admin_level=8 …');
  const data = await overpassRequest(query);
  if (!data.elements) throw new Error('No elements');
  let ok = 0, skip = 0;
  for (const rel of data.elements){
    if (rel.type !== 'relation') continue;
    const name = rel.tags?.name || rel.tags?.['name:de'] || '';
    if (!name) { skip++; continue; }
    const poly = relationToPolygons(rel);
    if (!poly || !poly.length) { skip++; continue; }
    const safe = toSafeName(name);
    const outPath = path.join(OUT_DIR, `polygon_${safe}.json`);
    if (fs.existsSync(outPath)) { skip++; continue; }
    fs.writeFileSync(outPath, JSON.stringify({ city: name, polygon: poly }, null, 2), 'utf8');
    ok++;
    if (ok % 100 === 0) console.log(`[SAVE] ${ok} files… latest ${outPath}`);
  }
  console.log(`[DONE] saved ${ok} polygons, skipped ${skip}`);
}

main().catch(e => { console.error(e); process.exit(1); });
