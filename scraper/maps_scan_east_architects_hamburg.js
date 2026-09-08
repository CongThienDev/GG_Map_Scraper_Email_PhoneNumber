// scraper/maps_scan_east_architects_hamburg.js
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const jitter = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const tinyBreath = async () => { await sleep(jitter(180, 400)); };  // 0.18–0.4s

// ====== ENV HELPERS ======
const env = (name, fallback = '') => (process.env[name] ?? fallback);
const envInt = (name, fallback) => {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
};
const envBool = (name, fallback) => {
  const v = (process.env[name] || '').toLowerCase();
  if (v === 'true') return true;
  if (v === 'false') return false;
  return fallback;
};
const parseKeywords = (s, fb = []) =>
  (s && s.split(/[|,]/).map(x => x.trim()).filter(Boolean)) || fb;

// ====== CONFIG (ENV overridable) ======
const START = {
  lat: parseFloat(env('START_LAT', '53.5511')),
  lng: parseFloat(env('START_LNG', '9.9937')),
};

let KEYWORDS = parseKeywords(env('KEYWORDS', ''), [
  'Maler',
  'Painter',
]);
const CITY = env('CITY', 'Hamburg');
const COUNTRY = env('COUNTRY', 'Germany');

const TARGET_SCALE_TEXT = new RegExp(
  `(^|\\s)${env('TARGET_SCALE_TEXT', '500\\s*m')}(\\s|$)`, 'i'
);

const SCROLL_DELAY_MS = envInt('SCROLL_DELAY_MS', 1000);
const MAX_SCROLLS = envInt('MAX_SCROLLS', 280);

// ====== LOGGING ======
const LOG_LEVEL = env('LOG_LEVEL', 'info');
const SHOW_URL_IN_LOG = envBool('SHOW_URL_IN_LOG', false);

const log = {
  dbg: (...a) => (LOG_LEVEL === 'debug') && console.log(...a),
  info: (...a) => console.log(...a),
};

// ==== GLOBAL STATE ====
let STT = 0;
let BROWSER = null;
let disconnected = false;
let CURRENT_KEYWORD = '';
const cellSummaries = []; // lưu thống kê từng grid
let TOTAL_CELLS = 0;

// ====== SPEED / TIME BUDGET ======
const CELL_TIME_BUDGET_MS = envInt('CELL_TIME_BUDGET_MS', 210000);
const SCROLL_FAST_RUNS = envInt('SCROLL_FAST_RUNS', 30);
const SCROLL_FAST_DELAY = envInt('SCROLL_FAST_DELAY', 220);
const SCROLL_SLOW_DELAY = envInt('SCROLL_SLOW_DELAY', 800);
const STAGNANT_LIMIT_SLOW = envInt('STAGNANT_LIMIT_SLOW', 16);
// kill/relaunch browser định kỳ để tránh phình RAM
const BROWSER_MAX_AGE_MS = envInt('BROWSER_MAX_AGE_MS', 30 * 60 * 1000); // mặc định 30 phút để giảm relaunch
let BROWSER_LAUNCHED_AT = 0;


// ====== LOCALE SWITCH ======
const LOCALE = env('LOCALE', 'default'); // 'default' | 'de'

// ====== SESSION / SCROLL TUNING ======
const RESET_EVERY_CELLS = envInt('RESET_EVERY_CELLS', 3);
const MAX_LINKS_PER_CELL = envInt('MAX_LINKS_PER_CELL', 0);
const MAX_CELLS = envInt('MAX_CELLS', 0);
const POLYGON_PATH = env('POLYGON_PATH', '').trim();
const FALLBACK_RADIUS_METERS = envInt('FALLBACK_RADIUS_METERS', 0); // dùng khi phải tạo bbox thô quanh START
// thư mục chứa sẵn polygon city (đặt bên cạnh results)
const POLYGON_DIR = path.join(__dirname, '..', 'Polygon_List');

// ====== CSV / DIRS ======
// mặc định lưu ngay trong repo để chạy local/vps đều ổn
const RESULTS_DIR = env('RESULTS_DIR', pathSafe(path.join(__dirname, '..', 'results')));
const CSV_PATH = env('CSV_PATH', pathSafe(path.join(
  RESULTS_DIR,
  `${env('CSV_BASENAME', `${CITY}_${(KEYWORDS[0] || 'keyword').replace(/\W+/g, '_')}.csv`)}`
)));
const SEEN_PATH = env('SEEN_PATH', pathSafe(path.join(RESULTS_DIR, 'seen_cache.json')));
const CENTERS_PATH = env('CENTERS_PATH', path.join(RESULTS_DIR, 'centers.json'));
const POLYGON_OUT_PATH = env('POLYGON_OUT_PATH', path.join(RESULTS_DIR, 'polygon_used.json'));

// ====== CHECKPOINT & PROFILE ======
const CHECKPOINT_PATH = env('CHECKPOINT_PATH', pathSafe(path.join(RESULTS_DIR, 'checkpoint.json')));
const PROFILE_DIR = env('PROFILE_DIR', process.env.PPTR_PROFILE_DIR || pathSafe(path.join(__dirname, '..', 'tmp', 'pptr-profile')));
const HEADLESS = envBool('HEADLESS', false);

// On recent macOS versions, older Chrome for Testing builds bundled by Puppeteer
// can fail before Chrome starts (Node reports `spawn ... -88`).  Prefer an
// explicitly configured executable, then the installed stable Chrome on macOS.
function resolveBrowserExecutable() {
  const configured = env('PUPPETEER_EXECUTABLE_PATH', '').trim();
  if (configured) return configured;

  if (process.platform === 'darwin') {
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (fs.existsSync(systemChrome)) return systemChrome;
  }

  return undefined; // Let Puppeteer select its managed browser on other platforms.
}

const BROWSER_EXECUTABLE_PATH = resolveBrowserExecutable();

function pathSafe(p){ return p; }

// 1. đảm bảo thư mục tồn tại
try {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
} catch (e) {
  console.error('[FATAL] Cannot create results dir:', RESULTS_DIR, e);
  process.exit(1);
}
try { fs.mkdirSync(PROFILE_DIR, { recursive: true }); } catch { }

// 2. đảm bảo file CSV tồn tại (touch nếu chưa có)
if (!fs.existsSync(CSV_PATH)) {
  try {
    fs.writeFileSync(CSV_PATH, '', { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') {
      console.error('[FATAL] Cannot create CSV file at', CSV_PATH, e);
      process.exit(1);
    }
  }
}

// 3. sau khi chắc chắn file có rồi thì đọc trạng thái để set append
const FILE_EXISTS = fs.existsSync(CSV_PATH);
const FILE_HAS_DATA = FILE_EXISTS && fs.statSync(CSV_PATH).size > 0;

// tập khóa đã thấy để chống trùng đa cell/đa keyword
const seenKeys = new Set();

function loadSeenCache() {
  try {
    const raw = fs.readFileSync(SEEN_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) arr.forEach(k => seenKeys.add(String(k)));
  } catch { }
}

function saveSeenCache() {
  try { fs.writeFileSync(SEEN_PATH, JSON.stringify(Array.from(seenKeys), null, 2), 'utf8'); } catch { }
}

function primeSeenFromCSV() {
  if (!FILE_HAS_DATA) return;
  try {
    const raw = fs.readFileSync(CSV_PATH, 'utf8').split('\n').slice(1); // bỏ header
    raw.forEach(line => {
      const match = line.match(/https?:[^,\s]+google[^,\s]+/i);
      if (match) {
        const key = makeKey({ url: match[0] });
        if (key) seenKeys.add(key);
      }
    });
  } catch { }
}

loadSeenCache();
primeSeenFromCSV();

const csvWriter = createCsvWriter({
  path: CSV_PATH,
  header: [
    { id: 'stt', title: 'STT' },
    { id: 'name', title: 'Name' },
    { id: 'address', title: 'Address' },
    { id: 'phone', title: 'Phone Number' },
    { id: 'website', title: 'Website' },
    { id: 'social', title: 'Social' },
    { id: 'rating', title: 'Rating' },
    { id: 'review_count', title: 'Review Count' },
    { id: 'category', title: 'category' },
    { id: 'city', title: 'City' },
    { id: 'google_maps_url', title: 'google_maps_url' },
    { id: 'center_lat', title: 'center_lat' },
    { id: 'center_lng', title: 'center_lng' },
  ],
  append: FILE_HAS_DATA
});
const CSV_FLUSH_SIZE = Math.max(1, envInt('CSV_FLUSH_SIZE', 20));
const pendingCsvRows = [];

async function flushCsvRows(force = false) {
  if (!pendingCsvRows.length) return;
  if (!force && pendingCsvRows.length < CSV_FLUSH_SIZE) return;
  const rows = pendingCsvRows.splice(0, pendingCsvRows.length);
  try {
    await csvWriter.writeRecords(rows);
  } catch (e) {
    pendingCsvRows.unshift(...rows);
    throw e;
  }
}

async function enqueueCsvRow(row) {
  pendingCsvRows.push(row);
  if (pendingCsvRows.length >= CSV_FLUSH_SIZE) {
    await flushCsvRows(true);
  }
}

// ====== CHECKPOINT ======
function loadStartCellIndex(defaultIdx = 0) {
  const fromArg = process.argv.find(a => a.startsWith('--from='));
  if (fromArg) {
    const v = parseInt(fromArg.split('=')[1], 10);
    if (!Number.isNaN(v) && v >= 1) return v - 1;
  }
  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const ck = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
      if (ck && typeof ck.nextCellIndex === 'number') return ck.nextCellIndex;
    } catch { }
  }
  return defaultIdx;
}

async function relaunchBrowser() {
  try { await BROWSER?.close().catch(() => { }); } catch { }
  BROWSER = await puppeteer.launch({
    headless: HEADLESS,
    protocolTimeout: 120000,
    executablePath: BROWSER_EXECUTABLE_PATH,
    userDataDir: PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1366,768',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  BROWSER_LAUNCHED_AT = Date.now(); 

  BROWSER.on('disconnected', () => {
    disconnected = true;
    console.log('[WARN] Browser disconnected (relaunch instance)');
  });

  disconnected = false;
  const p = await hardResetSession(BROWSER);
  return p;
}

function saveCheckpoint(nextCellIndex, meta = {}) {
  const data = {
    city: CITY,
    keywords: KEYWORDS,
    nextCellIndex,
    stt: STT,
    timestamp: new Date().toISOString(),
    ...meta,
  };
  try { fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch { }
}

// ====== helpers ======
function metersToDegLat(m) { return m / 110574; }
function metersToDegLngAtLat(m, lat) { return m / (111320 * Math.cos(lat * Math.PI / 180)); }
const cleanPUA = (t = '') => t.replace(/[\uE000-\uF8FF]/g, '').replace(/^\s*[\uE000-\uF8FF]?\s*/, '').trim();

async function acceptConsentIfAny(page) {
  try {
    // nếu h1 là "Before you continue to Google" thì xử lý ngay
    const title = await page.evaluate(() => document.querySelector('h1')?.innerText?.trim() || '');
    if (/before you continue to google/i.test(title)) {
      // tìm nút accept
      const btn = await page.$('button, [role="button"]');
      const btns = await page.$$('button, [role="button"]');
      for (const b of btns) {
        const t = (await b.evaluate(el => (el.innerText || el.getAttribute('aria-label') || '').trim())).toLowerCase();
        if (/(accept all|accept|agree|i agree|alle akzeptieren|zustimmen|ich stimme zu)/i.test(t)) {
          await b.click().catch(() => {});
          await sleep(600);
          return;
        }
      }
    }

    // fallback: quét tất cả button như trước
    const btns2 = await page.$$('button,[role="button"]');
    for (const b of btns2) {
      const t = (await page.evaluate(el => (el.innerText || el.getAttribute('aria-label') || ''), b)).toLowerCase();
      if (/(accept all|accept|agree|alle akzeptieren|zustimmen|ich stimme zu|akzeptieren)/i.test(t)) {
        await b.click().catch(() => {});
        await sleep(500);
      }
    }
  } catch (e) {
    console.log('[WARN] acceptConsentIfAny failed:', e.message);
  }
}



async function hardResetSession(browser) {
  const p = await browser.newPage();
  try {
    const client = (typeof p.createCDPSession === 'function')
      ? await p.createCDPSession()
      : (p.target && typeof p.target().createCDPSession === 'function')
        ? await p.target().createCDPSession()
        : null;

    if (client) {
      try { await client.send('Network.clearBrowserCookies'); } catch { }
      try { await client.send('Network.clearBrowserCache'); } catch { }
      for (const origin of ['https://www.google.com', 'https://www.google.de']) {
        try { await client.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' }); } catch { }
      }
    } else {
      try {
        await p.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await p.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch { } });
      } catch { }
    }
  } catch { }

  await applyLocale(p, browser);
  await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36');
  return p;
}

async function isEndOfList(page) {
  const txt = await page.evaluate(() => document.body?.innerText || '');
  const pats = [
    /you['’]ve reached the end of the list/i,
    /das ende der liste ist erreicht/i,
    /đã đến cuối danh sách/i
  ];
  return pats.some(re => re.test(txt));
}

async function isAwSnap(page) {
  try {
    const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || "");
    return /aw,\s*snap!/i.test(txt) || /Something went wrong while displaying this webpage/i.test(txt);
  } catch { return false; }
}

async function recoverAwSnapAndRetry(currentPage, url, { attempts = 2 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      await currentPage.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      await sleep(800);
      if (!(await isAwSnap(currentPage))) return currentPage;
    } catch { }
    try {
      const newPage = await BROWSER.newPage();
      await newPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36');
      try { await currentPage.close().catch(() => { }); } catch { }
      currentPage = newPage;
      const ok = await safeGoto(currentPage, url, { retries: 1, wait: 'domcontentloaded' });
      if (ok && !(await isAwSnap(currentPage))) return currentPage;
    } catch { }
  }
  try { currentPage = await relaunchBrowser(); } catch { }
  const ok = await safeGoto(currentPage, url, { retries: 1, wait: 'domcontentloaded' });
  return ok && !(await isAwSnap(currentPage)) ? currentPage : null;
}

async function applyLocale(page /*, browser */) {
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language',  { get: () => 'en-US' });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
  });
}

async function safeGoto(page, url, { retries = 3, wait = 'domcontentloaded' } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      await page.goto(url, { waitUntil: wait, timeout: 60000 });
      await sleep(800);
      if (await isAwSnap(page)) throw new Error('AwSnap');
      return true;
    } catch (e) {
      if (i === retries) return false;
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch { }
      await sleep(800);
      if (await isAwSnap(page)) {
        return false;
      }
      await sleep(1000 * (i + 1));
    }
  }
  return false;
}

async function gotoCenter(page, lat, lng, zoom = 17) {
  const base = 'https://www.google.com';
  const qs = '?hl=en&gl=US';
  const url = `${base}/maps/@${lat},${lng},${zoom}z${qs}`;
  const ok = await safeGoto(page, url, { retries: 2 });
  if (!ok) throw new Error('gotoCenter failed (AwSnap)');
  await sleep(1500);
}

async function wheelSidebar(page, sidebar) {
  await sidebar.evaluate(async (n) => {
    const step = 600;
    for (let k = 0; k < 3; k++) {
      n.dispatchEvent(new WheelEvent('wheel', { deltaY: step, bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
    }
  });
}

async function ensureScale100m(page) {
  for (let tries = 0; tries < 20; tries++) {
    const txt = await page.evaluate(() => {
      const elts = Array.from(document.querySelectorAll('*')).slice(-300);
      return elts.map(e => (e.innerText || '').trim()).filter(Boolean).join(' | ');
    });
    if (TARGET_SCALE_TEXT.test(txt)) return true;
    const zoomIn = await page.$('button[aria-label*="Zoom in"], button[aria-label*="Vergrößern"], button[aria-label*="Phóng to"]');
    const zoomOut = await page.$('button[aria-label*="Zoom out"], button[aria-label*="Verkleinern"], button[aria-label*="Thu nhỏ"]');
    if (/(\s|^)200\s*m(\s|$)|(\s|^)500\s*m(\s|$)/i.test(txt)) { if (zoomIn) await zoomIn.click(); }
    else if (/(\s|^)50\s*m(\s|$)|(\s|^)20\s*m(\s|$)/i.test(txt)) { if (zoomOut) await zoomOut.click(); }
    else { if (zoomIn) await zoomIn.click(); }
    await sleep(500);
  }
  return false;
}

async function disableUpdateWhenMapMoves(page) {
  const found = await page.$$('label[for*="EIMUcheckbox"], div[role="checkbox"], input[type="checkbox"]');
  for (const el of found) {
    const text = (await page.evaluate(e => e.innerText || e.getAttribute('aria-label') || '', el) || '').toLowerCase();
    if (text.includes('update results when map moves') || text.includes('karte verschieben') || text.includes('cập nhật kết quả khi bản đồ di chuyển')) {
      const checked = await page.evaluate(e => (e.getAttribute('aria-checked') === 'true') || (e.tagName === 'INPUT' && e.checked), el);
      if (checked) { await el.click().catch(() => { }); await sleep(200); }
    }
  }
}

function unwrapGoogleRedirect(u) {
  try {
    const url = new URL(u, 'https://www.google.com');
    if ((/google\.(com|de|com\.vn)$/i.test(url.hostname)) && (url.pathname === '/url' || url.pathname.startsWith('/maps/url'))) {
      return decodeURIComponent(url.searchParams.get('q') || url.searchParams.get('url') || u);
    }
    return u;
  } catch { return u; }
}

function extractCid(u = '') {
  try {
    const url = new URL(u);
    const cidParam = url.searchParams.get('cid');
    if (cidParam) return cidParam;
  } catch { }
  const m = /[?&]cid=(\d+)/i.exec(u);
  if (m) return m[1];
  const m2 = /!1s([^!]+)!8m2/.exec(u);
  if (m2) return m2[1];
  return '';
}

function normalizeDomain(u = '') {
  try {
    const host = new URL(u).hostname || '';
    return host.replace(/^www\./i, '').toLowerCase();
  } catch { return ''; }
}

function makeKey({ url = '', website = '', phone = '' }) {
  const cid = extractCid(url);
  if (cid) return `cid:${cid}`;
  const dom = normalizeDomain(website);
  const phoneClean = (phone || '').replace(/\D+/g, '');
  if (dom && phoneClean) return `domtel:${dom}:${phoneClean}`;
  if (dom) return `dom:${dom}`;
  if (phoneClean) return `tel:${phoneClean}`;
  return '';
}

// ====== POLYGON / GRID (OSM) ======
// luôn lấy đường dẫn tuyệt đối tới thư mục scraper, tránh phụ thuộc cwd
const SCRAPER_DIR = __dirname;

// tạo ra nhiều biến thể tên file để phòng vụ NFC/NFD hoặc thay umlaut
function polygonFileCandidatesFor(city) {
  const variants = new Set();
  const roots = [
    SCRAPER_DIR,
    path.join(SCRAPER_DIR, '..'),
    POLYGON_DIR
  ]; // ưu tiên thư mục scraper, root repo, rồi thư mục polygons
  const nfc = city.normalize('NFC');
  const nfd = city.normalize('NFD');
  const ascii = city
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');

  const toSafe = (s) => s.replace(/[^\wäöüÄÖÜß-]/g, '_');

  roots.forEach(root => {
    [city, nfc, nfd, ascii].forEach(c => {
      variants.add(path.join(root, `polygon_${toSafe(c)}.json`));
    });
  });

  if (POLYGON_PATH) {
    const custom = path.isAbsolute(POLYGON_PATH)
      ? POLYGON_PATH
      : path.join(SCRAPER_DIR, '..', POLYGON_PATH);
    variants.add(custom);
  }

  return Array.from(variants);
}

function httpGetJSON(url, headers = {}, maxRetries = 4) {
  return new Promise((resolve, reject) => {
    const tryOnce = (attempt) => {
      https.get(url, { headers }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const status = res.statusCode || 0;

          // Nominatim hay trả 429 khi spam
          if (status === 429 || status >= 500) {
            if (attempt < maxRetries) {
              const wait = 500 * Math.pow(2, attempt);
              console.log(`[POLY] HTTP ${status}, retry in ${wait}ms`);
              return setTimeout(() => tryOnce(attempt + 1), wait);
            }
            return reject(new Error(`HTTP ${status} from Nominatim`));
          }

          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', (e) => {
        if (attempt < maxRetries) {
          const wait = 500 * Math.pow(2, attempt);
          console.log(`[POLY] network error ${e.message}, retry in ${wait}ms`);
          return setTimeout(() => tryOnce(attempt + 1), wait);
        }
        reject(e);
      });
    };
    tryOnce(0);
  });
}

function pickBestHit(arr) {
  const wantedTypes = new Set(['administrative', 'city', 'municipality', 'borough']);
  let candidates = arr.filter(x =>
    x && x.geojson && x.class === 'boundary' &&
    (wantedTypes.has(x.type) || x.type === 'city')
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

async function getCityPolygon(city) {
  const cacheCandidates = polygonFileCandidatesFor(city);

  // 1) ưu tiên file có sẵn (thử từng biến thể)
  for (const cachePath of cacheCandidates) {
    if (fs.existsSync(cachePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (parsed && Array.isArray(parsed.polygon) && parsed.polygon.length) {
          console.log('[POLY] use local file:', cachePath);
          return parsed.polygon;
        } else {
          console.log('[POLY] local file exists but empty, will refetch:', cachePath);
        }
      } catch (e) {
        console.log('[POLY] local file broken, will refetch:', e.message);
      }
      // có file nhưng hỏng thì vẫn xuống dưới fetch
      break;
    }
  }

  // 2) phải gọi Nominatim
  const UA = { 'User-Agent': 'maps-scraper/1.0 (contact: you@example.com)' };
  const queries = [
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=5&city=${encodeURIComponent(city)}&country=${encodeURIComponent(COUNTRY)}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=10&q=${encodeURIComponent(city + ', ' + COUNTRY)}`,
    `https://nominatim.openstreetmap.org/search?format=jsonv2&polygon_geojson=1&addressdetails=1&dedupe=1&limit=10&q=${encodeURIComponent(city)}`
  ];

  let data = null;
  for (const url of queries) {
    try {
      console.log('[POLY] fetch:', url);
      const res = await httpGetJSON(url, UA).catch(() => null);
      if (Array.isArray(res) && res.length) {
        data = res;
        break;
      }
    } catch {}
    await sleep(800);
  }

  // nếu vẫn không có -> báo lỗi nhưng phải dùng tên file đầu tiên trong candidates
  if (!Array.isArray(data) || data.length === 0) {
    const suggested = path.basename(cacheCandidates[0]);
    // nếu có fallback radius và có START thì dựng bbox thô để không fail
    if (FALLBACK_RADIUS_METERS > 0 && Number.isFinite(START.lat) && Number.isFinite(START.lng)) {
      console.log(`[POLY] using rough bbox fallback with radius ${FALLBACK_RADIUS_METERS}m`);
      const r = FALLBACK_RADIUS_METERS;
      const dLat = metersToDegLat(r);
      const dLng = metersToDegLngAtLat(r, START.lat);
      const poly = [
        [
          [START.lng - dLng, START.lat - dLat],
          [START.lng + dLng, START.lat - dLat],
          [START.lng + dLng, START.lat + dLat],
          [START.lng - dLng, START.lat + dLat],
          [START.lng - dLng, START.lat - dLat]
        ]
      ];
      return poly;
    }

    throw new Error(
      `Không lấy được polygon cho thành phố "${city}". Tạo file ${suggested} (đặt trong Polygon_List/, scraper/ hoặc project root) hoặc truyền POLYGON_PATH để chạy lại.`
    );
  }

  const hit = pickBestHit(data);
  if (!hit || !hit.geojson) {
    const suggested = path.basename(cacheCandidates[0]);
    throw new Error(
      `Không lấy được polygon cho thành phố "${city}" (không có boundary phù hợp). Tạo file ${suggested} thủ công rồi chạy lại.`
    );
  }

  const gj = hit.geojson;
  let polys = [];
  if (gj.type === 'Polygon') {
    polys = [gj.coordinates];
  } else if (gj.type === 'MultiPolygon') {
    polys = gj.coordinates;
  } else {
    throw new Error('GeoJSON không phải Polygon/MultiPolygon');
  }

  const polygon = polys.map(rings => rings[0]);

  // lưu lại theo tên chuẩn đầu tiên
  const savePath = cacheCandidates.find(p => p.startsWith(POLYGON_DIR + path.sep)) || cacheCandidates[0];
  fs.writeFileSync(savePath, JSON.stringify({ city, polygon }, null, 2), 'utf8');
  console.log('[POLY] saved to', savePath);

  return polygon;
}



function polygonBBox(multiPoly) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const ring of multiPoly) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return { minLng, minLat, maxLng, maxLat };
}

function pointInMultiPolygon(lat, lng, multiPoly) {
  const inRing = (ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const intersect = ((yi > lat) !== (yj > lat)) &&
        (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  };
  for (const ring of multiPoly) if (inRing(ring)) return true;
  return false;
}

function buildGridCentersInPolygon(multiPoly, STEP_METERS = 2000) {
  const { minLng, minLat, maxLng, maxLat } = polygonBBox(multiPoly);
  const dLat = metersToDegLat(STEP_METERS);
  const midLat = (minLat + maxLat) / 2;
  const dLng = metersToDegLngAtLat(STEP_METERS, midLat);

  const rows = [];
  for (let lat = minLat; lat <= maxLat + 1e-9; lat += dLat) {
    const row = [];
    for (let lng = minLng; lng <= maxLng + 1e-9; lng += dLng) {
      if (pointInMultiPolygon(lat, lng, multiPoly)) {
        row.push({ lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) });
      }
    }
    if (row.length) rows.push(row);
  }
  const centers = [];
  rows.forEach((row, i) => centers.push(...(i % 2 ? row.slice().reverse() : row)));
  return centers;
}

// ====== scraping helpers ======
async function getDetailsFromOpenPanel(page) {
  return await page.evaluate(() => {
    const out = { name: '', address: '', phone: '', website: '', social: '', rating: '', review_count: '' };
    // Tên: ưu tiên div[role="main"][aria-label] (bền hơn h1 — trang list có nhiều h1 gây lấy nhầm "Results")
    const mainPanel = document.querySelector('div[role="main"][aria-label]');
    out.name = (mainPanel?.getAttribute('aria-label') || document.querySelector('h1')?.innerText || '').trim();

    // Rating: aria-label dạng "4.8 stars" (tránh histogram "5 stars, 665 reviews")
    const starEl = Array.from(document.querySelectorAll('[aria-label]'))
      .map(e => (e.getAttribute('aria-label') || '').trim())
      .find(t => /^[\d.,]+\s+stars?$/i.test(t));
    if (starEl) {
      const m = starEl.match(/^([\d.,]+)/);
      if (m) out.rating = m[1].replace(',', '.');
    }
    if (!out.rating) {
      const rtSpan = Array.from(document.querySelectorAll('span'))
        .map(s => (s.innerText || '').trim())
        .find(t => /^\d[.,]\d$/.test(t));
      if (rtSpan) out.rating = rtSpan.replace(',', '.');
    }

    // Số review: aria-label dạng "730 reviews" (tổng, tránh dòng histogram "5 stars, 665 reviews")
    const revLabel = Array.from(document.querySelectorAll('[aria-label]'))
      .map(e => (e.getAttribute('aria-label') || '').trim())
      .find(t => /^[\d.,]+\s+reviews?$/i.test(t));
    if (revLabel) {
      const m = revLabel.match(/^([\d.,]+)/);
      if (m) out.review_count = m[1].replace(/[.,]/g, '');
    }

    // Website: ưu tiên nút chính chủ của Google Maps (data-item-id="authority"),
    // rồi tới link có aria-label "Website". KHÔNG dùng fallback "link non-Google đầu tiên"
    // vì nó hay vớ nhầm nút Grab/WhatsApp/Facebook.
    const JUNK_HOST = /(^|\.)(grab\.com|wa\.me|whatsapp\.com|facebook\.com|fb\.com|instagram\.com|zalo\.me|booking\.com|tripadvisor\.[a-z.]+|foody\.vn|shopee\.[a-z.]+|linktr\.ee|t\.me|tiktok\.com|youtube\.com|twitter\.com|x\.com|threads\.net|pinterest\.[a-z.]+)$/i;
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };

    let webHref = '';
    const authority = document.querySelector('a[data-item-id="authority"]');
    if (authority?.href) webHref = authority.href;
    if (!webHref) {
      const byLabel = Array.from(document.querySelectorAll('a[href]')).find(a => {
        const t = (a.getAttribute('aria-label') || '').toLowerCase();
        return /^https?:/i.test(a.getAttribute('href') || '') &&
          (t.includes('website') || t.includes('webseite') || t.includes('trang web'));
      });
      if (byLabel?.href) webHref = byLabel.href;
    }

    // Phân loại: link mạng xã hội/đặt hàng -> cột social; còn lại -> website
    if (webHref) {
      if (JUNK_HOST.test(hostOf(webHref))) out.social = webHref;
      else out.website = webHref;
    }
    // Nếu chưa có social, thử bắt 1 link mạng xã hội trên panel để lưu riêng (không nhét vào website)
    if (!out.social) {
      const soc = Array.from(document.querySelectorAll('a[href]')).find(a => {
        const href = a.getAttribute('href') || '';
        return /^https?:/i.test(href) && JUNK_HOST.test(hostOf(href));
      });
      if (soc?.href) out.social = soc.href;
    }
    const tel = document.querySelector('a[href^="tel:"]');
    if (tel) out.phone = (tel.getAttribute('href') || '').replace(/^tel:/, '');
    const labelAddr = Array.from(document.querySelectorAll('[aria-label]')).find(e => /address|adresse|địa chỉ/i.test(e.getAttribute('aria-label') || ''));
    if (labelAddr) out.address = labelAddr.innerText || '';
    if (!out.address) {
      const blocks = Array.from(document.querySelectorAll('div,span')).map(e => e.innerText || '').filter(Boolean);
      const guess = blocks.find(t => /Hamburg|Deutschland|Germany|Đức/i.test(t) && t.length < 200);
      if (guess) out.address = guess;
    }
    return out;
  });
}

async function clearSearchBox(page) {
  const btn = await page.$('button[aria-label*="Clear search"], button[aria-label*="Suche löschen"], button[aria-label*="Xóa tìm kiếm"]');
  if (btn) { await btn.click().catch(() => { }); await sleep(400); }
  const input = await findSearchInput(page, { attempts: 1 });
  if (input) { await input.click({ clickCount: 3 }).catch(() => { }); await page.keyboard.press('Backspace').catch(() => { }); await sleep(200); }
}

async function findSearchInput(page, { attempts = 2 } = {}) {
  const selectors = [
    'input#searchboxinput',
    'input[aria-label*="Search Google Maps"]',
    'input[aria-label*="Search"]',
    'input[role="combobox"]'
  ];

  for (let i = 0; i < attempts; i++) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return el;
    }

    await acceptConsentIfAny(page);
    await sleep(500);
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return el;
    }

    const currentUrl = await page.evaluate(() => location.href).catch(() => '');
    if (!/google\.[^/]+\/maps/i.test(currentUrl)) {
      await safeGoto(page, 'https://www.google.com/maps?hl=en&gl=US', { retries: 1 });
      await sleep(1000);
    } else {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
      await sleep(800);
    }
  }

  return null;
}

async function searchKeywordAtCenter(page, keyword) {
  const input = await findSearchInput(page, { attempts: 2 });
  if (!input) {
    console.log('  [WARN] search input not found after recover');
    return false;
  }

  try {
    await input.click({ clickCount: 3 }).catch(() => {});
    await page.keyboard.type(keyword, { delay: 30 });
  } catch (err) {
    console.log('[WARN] typing failed, will try recover:', err.message || err);
    return false;
  }

  let pressed = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { await page.keyboard.press('Enter'); pressed = true; break; }
    catch (err) {
      console.log('[WARN] press Enter failed (attempt', attempt, '):', err.message || err);
      const again = await page.$('input#searchboxinput');
      if (again) { await again.click({ clickCount: 3 }).catch(() => {}); await sleep(300); }
    }
  }
  if (!pressed) {
    console.log('[ERROR] cannot press Enter, skip this keyword');
    return false;
  }

  await page
    .waitForSelector('div[role="feed"], .w6VYqd, div[aria-label="Results"]', { timeout: 15000 })
    .catch(() => {});
  await sleep(1600);
  return true;
}

async function getSidebarHandle(page) {
  for (const s of ['div[role="feed"]', '.w6VYqd', 'div[aria-label="Results"]']) { const h = await page.$(s); if (h) return h; }
  return null;
}

async function scrollListToEnd(page, sidebar) {
  // Google Maps virtualizes its feed; cards scrolled out of view can disappear
  // from the DOM. Persist discovered URLs outside the DOM while scrolling.
  const readVisibleLinks = async () => await sidebar.evaluate(sb => Array.from(
    sb.querySelectorAll('a.hfpxzc, a[href*="/maps/place/"], a[href*="/place/"]')
  ).map(a => a.href).filter(Boolean));

  const bringLastCardToCenter = async () => {
    await page.evaluate(() => {
      const cards = document.querySelectorAll('div[role="article"]');
      if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'center' });
    }).catch(() => { });
  };

  const wheelBit = async () => {
    await sidebar.evaluate(n => {
      n.scrollTop = n.scrollHeight;
      const ev = new WheelEvent('wheel', { deltaY: 800, bubbles: true });
      n.dispatchEvent(ev);
    });
  };

  const links = new Set(await readVisibleLinks());
  const collectVisibleLinks = async () => {
    let added = 0;
    for (const href of await readVisibleLinks()) {
      if (!links.has(href)) {
        links.add(href);
        added += 1;
      }
    }
    return added;
  };

  console.log(`  initial visible anchors: ${links.size}`);

  const t0 = Date.now();
  let stagnant = 0;
  let stopReason = 'max_scrolls';

  for (let i = 0; i < SCROLL_FAST_RUNS; i++) {
    await wheelBit();
    await bringLastCardToCenter();
    await sleep(SCROLL_FAST_DELAY);

    const added = await collectVisibleLinks();
    stagnant = added === 0 ? stagnant + 1 : 0;

    if (await isEndOfList(page)) { stopReason = 'end_of_list'; break; }
    // This phase warms up Maps. It may need several short scrolls before more
    // cards are appended, so an early no-growth result is not a stop signal.
    if (Date.now() - t0 > CELL_TIME_BUDGET_MS) { stopReason = 'time_budget'; break; }
  }

  if (stopReason === 'max_scrolls') stagnant = 0;
  for (let i = 0; stopReason === 'max_scrolls' && i < MAX_SCROLLS; i++) {
    if (Date.now() - t0 > CELL_TIME_BUDGET_MS) { stopReason = 'time_budget'; break; }

    await wheelBit();
    await bringLastCardToCenter();
    await sleep(SCROLL_SLOW_DELAY);

    const added = await collectVisibleLinks();
    stagnant = added === 0 ? stagnant + 1 : 0;

    const end = await isEndOfList(page);
    if (end) { stopReason = 'end_of_list'; break; }
    if (stagnant >= STAGNANT_LIMIT_SLOW) { stopReason = 'stagnant_list'; break; }
    if (Date.now() - t0 > CELL_TIME_BUDGET_MS) { stopReason = 'time_budget'; break; }
  }

  try { await page.waitForNetworkIdle({ idleTime: 1500, timeout: 8000 }); } catch { }
  await sleep(400);

  await collectVisibleLinks();
  const durationMs = Date.now() - t0;
  console.log(`  [SCROLL] reason=${stopReason} urls=${links.size} duration_ms=${durationMs}`);
  return { links: Array.from(links), count: links.size, stopReason, durationMs };
}

let CURRENT_CELL_IDX = 0;

if (FILE_HAS_DATA) {
  try {
    const text = fs.readFileSync(CSV_PATH, 'utf8').trim();
    const lastLine = text.split('\n').filter(Boolean).slice(-1)[0] || '';
    const firstField = (lastLine.split(',')[0] || '').trim();
    const lastCount = parseInt(firstField, 10);
    if (!Number.isNaN(lastCount)) STT = lastCount;
  } catch { }
}
let CURRENT_CELL = { ...START };

process.on('SIGINT', async () => {
  console.log('\n[SIGINT] Ctrl+C → closing browser…');
  try { await flushCsvRows(true); } catch { }
  try { await BROWSER?.close(); } catch { }
  try { saveCheckpoint(CURRENT_CELL_IDX, { note: 'Saved on SIGINT' }); } catch { }
  try { saveSeenCache(); } catch { }
  console.log(`[INFO] CSV saved: ${CSV_PATH} (tổng dòng: ${STT})`);
  process.exit(0);
});

async function extractByClickingCards(page, sidebar) {
  const out = [];
  const seen = new Set();
  const cards = await sidebar.$$('div[role="article"]');
  log.dbg(`  [DBG] initial cards in sidebar = ${cards.length}`);

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card) break;

    const name = (await card.$eval('h3,[aria-level="3"]', el => el.innerText).catch(() => ''))?.trim() || '';
    const placeUrl = await card.$eval('a.hfpxzc, a[jsaction][href*="/maps/place/"], a[href*="/maps/place/"], a[href*="/place/"]', a => a.href).catch(() => '');

    if (!placeUrl || !name || seen.has(placeUrl)) continue;
    const titleAnchor = await card.$('a.hfpxzc, a[jsaction][href*="/maps/place/"], a[href*="/maps/place/"], a[href*="/place/"]');
    if (titleAnchor) await titleAnchor.click().catch(() => { }); else await card.click().catch(() => { });

    const opened = await page.waitForSelector('h1', { timeout: 15000 }).then(() => true).catch(() => false);
    await acceptConsentIfAny(page);
    if (!opened || await isAwSnap(page)) {
      const href = await page.evaluate(() => location.href).catch(() => null);
      const p = await recoverAwSnapAndRetry(page, href || 'about:blank', { attempts: 2 });
      if (!p) { seen.add(placeUrl); continue; }
      page = p;
    }

    await page.evaluate(() => { (document.querySelector('[role="dialog"]') || document).scrollBy(0, 800); }).catch(() => { });
    await sleep(300);

const det = await getDetailsFromOpenPanel(page);
det.website = det.website ? unwrapGoogleRedirect(det.website) : '';
det.address = cleanPUA(det.address);

// ⬇️ thêm guard này
const nameLower = (det.name || '').toLowerCase();
if (/before you continue to google/i.test(nameLower)) {
  console.log('  [SKIP] consent page, not a business');

  // quay lại list rồi qua card tiếp theo
  const backBtn = await page.$('button[aria-label*="Back" i], button[aria-label*="Zurück" i], button[aria-label*="Quay lại" i]');
  if (backBtn) await backBtn.click().catch(() => {});
  else await page.keyboard.press('Escape').catch(() => {});
  await page.waitForSelector('div[role="feed"], .w6VYqd, div[aria-label="Results"]', { timeout: 15000 }).catch(() => {});
  await sleep(200);
  continue; // ⬅️ rất quan trọng: KHÔNG ghi CSV, KHÔNG tăng STT
}

// nếu không phải consent thì mới ghi CSV
STT += 1;
await enqueueCsvRow({
  stt: STT, name: det.name || '', address: det.address || '', phone: det.phone || '',
  website: det.website || '', social: det.social || '', rating: det.rating || '', review_count: det.review_count || '',
  category: CURRENT_KEYWORD, city: CITY,
  google_maps_url: placeUrl, center_lat: CURRENT_CELL.lat, center_lng: CURRENT_CELL.lng
});
console.log(`  [COUNT] ${STT} → ${det.name} | ${det.website || '(no site)'}`);


    const backBtn = await page.$('button[aria-label*="Back" i], button[aria-label*="Zurück" i], button[aria-label*="Quay lại" i]');
    if (backBtn) await backBtn.click().catch(() => { }); else await page.keyboard.press('Escape').catch(() => { });
    await page.waitForSelector('div[role="feed"], .w6VYqd, div[aria-label="Results"]', { timeout: 15000 }).catch(() => { });
    await sleep(200);

    out.push({ name: det.name, website: det.website, placeUrl });
    seen.add(placeUrl);
  }
  log.dbg(`  [DBG] done extractByClickingCards; got ${out.length}`);
  return out;
}

async function openEachPlaceAndGrab(page, links) {
  let curPage = page;
  const list = (MAX_LINKS_PER_CELL && MAX_LINKS_PER_CELL > 0) ? links.slice(0, MAX_LINKS_PER_CELL) : links.slice();

  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    try {
      if (disconnected || !BROWSER?.isConnected()) {
        console.log('[INFO] Relaunching browser...');
        curPage = await relaunchBrowser();
      }

      let okGoto = await safeGoto(curPage, url, { retries: 1, wait: 'domcontentloaded' });
      if (!okGoto || await isAwSnap(curPage)) {
        const p = await recoverAwSnapAndRetry(curPage, url, { attempts: 2 });
        if (!p) continue;
        curPage = p;
      }

      const ok = await curPage.waitForSelector('h1', { timeout: 8000 }).then(() => true).catch(() => false);
      if (!ok || await isAwSnap(curPage)) {
        const p = await recoverAwSnapAndRetry(curPage, url, { attempts: 1 });
        if (!p) continue;
        curPage = p;
      }

      await curPage.evaluate(() => { (document.querySelector('[role="dialog"]') || document).scrollBy(0, 600); }).catch(() => { });
      await sleep(180);

const det = await getDetailsFromOpenPanel(curPage);
det.website = det.website ? unwrapGoogleRedirect(det.website) : '';
det.address = cleanPUA(det.address);

// ⬇️ guard chống popup
const nameLower = (det.name || '').toLowerCase();
if (/before you continue to google/i.test(nameLower)) {
  console.log('  [SKIP] consent page (openEachPlaceAndGrab)');
  await tinyBreath();   // nghỉ 1 tí kẻo spam
  continue;             // không ghi CSV, sang link kế
}

const key = makeKey({ url, website: det.website, phone: det.phone });
if (key && seenKeys.has(key)) {
  log.dbg(`  [SKIP] dup ${key}`);
  continue;
}

STT += 1;
await enqueueCsvRow({
  stt: STT, name: det.name || '', address: det.address || '', phone: det.phone || '',
  website: det.website || '', social: det.social || '', rating: det.rating || '', review_count: det.review_count || '',
  category: CURRENT_KEYWORD, city: CITY,
  google_maps_url: url, center_lat: CURRENT_CELL.lat, center_lng: CURRENT_CELL.lng
});
if (key) seenKeys.add(key);
if (STT % 50 === 0) saveSeenCache();
log.info(`  [COUNT] ${STT} → ${det.name} | ${det.website || '(no site)'} ${key ? '| key=' + key : ''}`);


      if (STT % 40 === 0) {
        try { await curPage.close(); } catch { }
        curPage = await hardResetSession(BROWSER);
      }
      if (STT % 25 === 0) {
        await flushCsvRows(true);
        saveCheckpoint(CURRENT_CELL_IDX, { processedCount: STT, note: 'periodic-save' });
      }
    } catch (err) {
      if (/Connection closed/i.test(String(err))) {
        curPage = await relaunchBrowser();
        continue;
      }
      console.log('  [WARN] openEachPlaceAndGrab error:', err?.message || err);
    }
    await tinyBreath();
  }
  return curPage;
}

(async () => {
  BROWSER = await puppeteer.launch({
    headless: HEADLESS,
    protocolTimeout: 120000,
    executablePath: BROWSER_EXECUTABLE_PATH,
    userDataDir: PROFILE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1366,768',
      '--disable-gpu',
      '--disable-accelerated-2d-canvas',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });
  BROWSER_LAUNCHED_AT = Date.now(); 

  BROWSER.on('targetcrashed', () => console.log('[WARN] target crashed (renderer)'));
  BROWSER.on('disconnected', () => { disconnected = true; console.log('[WARN] Browser disconnected'); });

  let page = await BROWSER.newPage();
  page.on('error', err => console.log('[PAGE ERROR]', err));
  page.on('pageerror', err => console.log('[PAGE JS ERROR]', err));
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(30000);

  await applyLocale(page, BROWSER);
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36');

  const polygon = await getCityPolygon(CITY);
  const STEP_METERS = envInt('STEP_METERS', 1200); // mặc định đi dày hơn để vét đủ
  const centersAll = buildGridCentersInPolygon(polygon, STEP_METERS);
  const centers = (MAX_CELLS && MAX_CELLS > 0) ? centersAll.slice(0, MAX_CELLS) : centersAll;
  TOTAL_CELLS = centers.length;

  // lưu polygon và centers để UI progress dùng
  try { fs.writeFileSync(POLYGON_OUT_PATH, JSON.stringify({ city: CITY, polygon }, null, 2), 'utf8'); } catch { }
  try { fs.writeFileSync(CENTERS_PATH, JSON.stringify(centers, null, 2), 'utf8'); } catch { }

  console.log(`[INFO] centers in polygon = ${centersAll.length} (processing ${centers.length})`);
  const startIdx = loadStartCellIndex(0);

  // ghi checkpoint ban đầu để UI có totalCells dù chưa chạy
  saveCheckpoint(startIdx, {
    lastCenter: centers[startIdx] || null,
    processedCount: STT,
    gridRows: cellSummaries,
    gridRowsString: "",
    totalCells: TOTAL_CELLS,
    currentCell: startIdx
  });

  for (let idx = startIdx; idx < centers.length; idx++) {
  const sttCellBefore = STT;
  let anchorsThisCell = 0;
  const keywordScans = [];
  // nếu browser đã quá tuổi thì relaunch
  if (Date.now() - BROWSER_LAUNCHED_AT > BROWSER_MAX_AGE_MS) {
    console.log('[INFO] Browser too old, relaunching to free RAM…');
    // đóng page cũ trước
    try { await page.close().catch(() => {}); } catch {}
    page = await relaunchBrowser();
  }
    CURRENT_CELL_IDX = idx;

    if (idx % RESET_EVERY_CELLS === 0) {
      try { await page.close(); } catch { }
      page = await hardResetSession(BROWSER);
    }

    if (await isAwSnap(page)) {
      try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }); } catch { }
      if (await isAwSnap(page)) {
        const newP = await BROWSER.newPage();
        await newP.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36');
        await page.close().catch(() => { });
        page = newP;
      }
    }

    const cur = centers[idx];
    CURRENT_CELL = { ...cur };
    CURRENT_CELL_IDX = idx;

    console.log(`\n=== Cell ${idx + 1}/${centers.length} @ ${cur.lat.toFixed(6)}, ${cur.lng.toFixed(6)} ===`);
    // ghi checkpoint sớm để UI biết đang ở grid nào
    saveCheckpoint(idx, {
      lastCenter: CURRENT_CELL,
      processedCount: STT,
      gridRows: cellSummaries,
      gridRowsString: cellSummaries.map(c => `grid ${c.cell}: ${c.rows}`).join(', '),
      totalCells: TOTAL_CELLS,
      currentCell: idx + 1
    });
    await gotoCenter(page, cur.lat, cur.lng, 17);
    await acceptConsentIfAny(page);
    await ensureScale100m(page);
    await clearSearchBox(page);

    for (const kw of KEYWORDS) {
      CURRENT_KEYWORD = kw;
      const sttBefore = STT;
      const ok = await searchKeywordAtCenter(page, kw);
      await sleep(600);
      if (!ok) { console.log('  ! search box not found, skip kw'); continue; }

      const sidebar = await getSidebarHandle(page);
      if (!sidebar) { console.log('  ! no sidebar'); continue; }

      await disableUpdateWhenMapMoves(page);
      const scan = await scrollListToEnd(page, sidebar);
      anchorsThisCell += scan.count;
      keywordScans.push({
        keyword: kw,
        urls: scan.count,
        stopReason: scan.stopReason,
        durationMs: scan.durationMs
      });
      await sleep(400);

      const links = (MAX_LINKS_PER_CELL && MAX_LINKS_PER_CELL > 0)
        ? scan.links.slice(0, MAX_LINKS_PER_CELL)
        : scan.links;
      console.log(`  [DBG] ${kw} → links collected = ${links.length}`);

      // mở từng URL và ghi CSV nếu chưa trùng
      if (links.length > 0) {
        page = await openEachPlaceAndGrab(page, links);
      }


      await clearSearchBox(page);
      await tinyBreath();

      const sttAfter = STT;
      const wrote = sttAfter - sttBefore;
      await flushCsvRows(true);
      saveCheckpoint(idx + 1, {
        lastCenter: CURRENT_CELL,
        lastKeyword: kw,
        anchorsCollected: scan.count,
        scrollStopReason: scan.stopReason,
        scrollDurationMs: scan.durationMs,
        keywordScans,
        rowsWritten: wrote,
        processedCount: STT
      });
      console.log(`  [SUMMARY] kw="${kw}" anchors=${scan.count} rowsWritten=${wrote} total=${STT}`);
    }

    const rowsThisCell = STT - sttCellBefore;
    cellSummaries.push({ cell: idx + 1, rows: rowsThisCell, anchors: anchorsThisCell });
    const gridRowsString = cellSummaries.map(c => `grid ${c.cell}: ${c.rows}`).join(', ');
    // ghi checkpoint kèm thống kê grid
    saveCheckpoint(idx + 1, {
      lastCenter: CURRENT_CELL,
      processedCount: STT,
      gridRows: cellSummaries,
      gridRowsString,
      totalCells: TOTAL_CELLS,
      currentCell: idx + 1,
      keywordScans,
      lastScroll: keywordScans[keywordScans.length - 1] || null
    });
  }

  await flushCsvRows(true);
  console.log(`\n[FINISHED] CSV: ${CSV_PATH} | tổng dòng: ${STT}`);
  saveSeenCache();
  try { await BROWSER.close(); } catch { }
})();
