import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const STATIC_DIR = path.join(__dirname, '..', 'dist', 'school', 'browser');
const PORT = process.env.PORT || 3000;
const DELAY_MS = 500;

process.on('uncaughtException', (err) => console.error('Uncaught:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** Fetch JSON from an HTTPS URL */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { Accept: 'application/json' } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
    }).on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Collection state ───────────────────────────────────────────────
let collectionProgress = { status: 'idle', current: 0, total: 0, message: '' };

async function collectData() {
  if (collectionProgress.status === 'collecting') return;
  collectionProgress = { status: 'collecting', current: 0, total: 0, message: 'Зареждане на списък с училища...' };

  try {
    const schoolsUrl =
      'https://kg.sofia.bg/api/public/kg/type/school/all?filterType=by_region&kgType=0&regionId=0';
    const schoolsResp = await fetchJson(schoolsUrl);
    const schools = schoolsResp.items?.kinderGardens ?? [];

    collectionProgress = { status: 'collecting', current: 0, total: schools.length, message: `Намерени ${schools.length} училища` };

    const cachedSchools = [];

    for (let i = 0; i < schools.length; i++) {
      const school = schools[i];
      const schoolId = school.id;
      const schoolName = school.name?.publicName ?? school.nameStr ?? `Училище ${schoolId}`;

      collectionProgress = {
        status: 'collecting',
        current: i + 1,
        total: schools.length,
        message: `${schoolName} (${i + 1}/${schools.length})`,
      };

      // Fetch school details
      await delay(DELAY_MS);
      let detailResp;
      try {
        detailResp = await fetchJson(`https://kg.sofia.bg/api/public/1/dz/${schoolId}`);
      } catch (err) {
        console.error(`Failed to fetch detail for ${schoolName}: ${err.message}`);
        continue;
      }

      const createdAt = detailResp.createdAt;

      // Check cache — skip if createdAt is unchanged
      const cacheFile = path.join(DATA_DIR, `school-${schoolId}.json`);
      if (fs.existsSync(cacheFile)) {
        try {
          const cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
          if (cachedData.createdAt === createdAt) {
            cachedSchools.push(cachedData.school);
            continue;
          }
        } catch { /* re-fetch on parse error */ }
      }

      const dz = detailResp.items?.dz;
      const featureGroup = dz?.featureGroups?.[0];
      const groupId = featureGroup?.groupId;
      const spots = featureGroup?.spots ?? [];
      const generalSpots = spots.find((s) => s.type === 'general') ?? {};

      const schoolData = {
        id: schoolId,
        nameStr: dz?.nameFull ?? schoolName,
        region: dz?.region ?? school.region ?? '',
        free: generalSpots.svobodni ?? 0,
        signed: generalSpots.zapisani ?? 0,
        unsigned: generalSpots.nezapisani ?? 0,
        capacity: generalSpots.capacity ?? 0,
        available: generalSpots.svobodni ?? 0,
      };

      cachedSchools.push(schoolData);

      // Fetch children waiting list
      let children = [];
      if (groupId) {
        await delay(DELAY_MS);
        try {
          const childrenResp = await fetchJson(
            `https://kg.sofia.bg/api/stat-rating/waiting/${groupId}`
          );
          const listWaiting = childrenResp.items?.listWaiting ?? [];
          children = listWaiting.map((c, idx) => ({
            id: c.id,
            schoolId,
            childNum: typeof c.childNum === 'string' ? parseInt(c.childNum, 10) : c.childNum,
            name: [c.firstName, c.middleName, c.lastName].filter(Boolean).join(' '),
            displayText: c.displayText ?? '',
            points: c.points ?? 0,
            wishOrder: c.wishOrder ?? 0,
            order: idx + 1,
            otherSchools: [],
          }));
        } catch (err) {
          console.error(`Failed to fetch children for ${schoolName}: ${err.message}`);
        }
      }

      // Save to cache
      const cacheData = {
        school: schoolData,
        children,
        createdAt,
        collectedAt: new Date().toISOString(),
      };
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), 'utf-8');
    }

    // Save combined schools list
    fs.writeFileSync(
      path.join(DATA_DIR, 'schools.json'),
      JSON.stringify({ items: cachedSchools }, null, 2),
      'utf-8'
    );

    collectionProgress = {
      status: 'done',
      current: schools.length,
      total: schools.length,
      message: `Готово! Събрани ${cachedSchools.length} училища.`,
    };
  } catch (err) {
    collectionProgress = { status: 'error', current: 0, total: 0, message: err.message };
  }
}

// ─── HTTP Server ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── POST /api/sync — start collection ──
  if (url.pathname === '/api/sync' && req.method === 'POST') {
    if (collectionProgress.status === 'collecting') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: false, message: 'Вече се събират данни' }));
    } else {
      collectData().catch((err) => {
        console.error('Collection failed:', err);
        collectionProgress = { status: 'error', current: 0, total: 0, message: err.message };
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ started: true }));
    }
    return;
  }

  // ── GET /api/sync/status — poll progress ──
  if (url.pathname === '/api/sync/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(collectionProgress));
    return;
  }

  // ── GET /api/schools ──
  if (url.pathname === '/api/schools' && req.method === 'GET') {
    const file = path.join(DATA_DIR, 'schools.json');
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(fs.readFileSync(file, 'utf-8'));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ items: [] }));
    }
    return;
  }

  // ── GET /api/waitlist-deep?school_id=N ──
  if (url.pathname === '/api/waitlist-deep' && req.method === 'GET') {
    const schoolId = url.searchParams.get('school_id');
    if (!schoolId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing school_id' }));
      return;
    }
    const file = path.join(DATA_DIR, `school-${path.basename(schoolId)}.json`);
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ items: data.children ?? [] }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ items: [] }));
    }
    return;
  }

  // ── Static files (Angular build) ──
  serveStatic(url.pathname, res);
});

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

function serveStatic(pathname, res) {
  // Prevent path traversal
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(STATIC_DIR, safePath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback: serve index.html for any non-file route
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
}

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
