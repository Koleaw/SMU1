import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const SAFE_SLUG_RE = /^[a-z0-9_-]+$/;
const DEV_DEFAULTS = {
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'admin',
  SESSION_SECRET: 'dev-session-secret-change-me',
  ADMIN_API_PORT: '8787',
  ADMIN_ALLOWED_ORIGIN: '',
  CONTENT_WRITE_MODE: 'local'
};

const COLLECTIONS = {
  'product-sections': {
    label: 'Разделы продукции',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/product-sections')
  },
  services: {
    label: 'Услуги',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/services')
  },
  'product-categories': {
    label: 'Категории изделий',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/product-categories')
  },
  products: {
    label: 'Изделия',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/products')
  },
  projects: {
    label: 'Выполненные объекты',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/projects')
  },
  jobs: {
    label: 'Вакансии',
    type: 'directory',
    path: path.join(repoRoot, 'src/content/jobs')
  },
  'site-settings': {
    label: 'Настройки сайта',
    type: 'single-file',
    path: path.join(repoRoot, 'src/content/site-settings/global.json'),
    slug: 'global'
  }
};

const sessions = new Map();
const UPLOADS_DIR = path.join(repoRoot, 'public', 'uploads');
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.svg']);

function parseEnvText(source = '') {
  const lines = source.split(/\r?\n/);
  const result = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['\"]|['\"]$/g, '');
    result[key] = value;
  }
  return result;
}

async function loadEnvConfig() {
  const files = ['.env.local', '.env.admin.local'];
  const merged = {};

  for (const filename of files) {
    const fullPath = path.join(repoRoot, filename);
    try {
      const content = await fs.readFile(fullPath, 'utf8');
      Object.assign(merged, parseEnvText(content));
    } catch {
      // optional env file
    }
  }
  Object.assign(merged, Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === 'string' && value.length > 0)
  ));

  let usingDevCredentials = false;
  const config = {
    ADMIN_USERNAME: merged.ADMIN_USERNAME ?? DEV_DEFAULTS.ADMIN_USERNAME,
    ADMIN_PASSWORD: merged.ADMIN_PASSWORD ?? DEV_DEFAULTS.ADMIN_PASSWORD,
    SESSION_SECRET: merged.SESSION_SECRET ?? DEV_DEFAULTS.SESSION_SECRET,
    ADMIN_API_PORT: Number(merged.ADMIN_API_PORT ?? DEV_DEFAULTS.ADMIN_API_PORT),
    ADMIN_ALLOWED_ORIGIN: merged.ADMIN_ALLOWED_ORIGIN ?? DEV_DEFAULTS.ADMIN_ALLOWED_ORIGIN,
    CONTENT_WRITE_MODE: merged.CONTENT_WRITE_MODE ?? DEV_DEFAULTS.CONTENT_WRITE_MODE
  };

  if (!merged.ADMIN_USERNAME || !merged.ADMIN_PASSWORD || !merged.SESSION_SECRET) {
    usingDevCredentials = true;
  }

  return { config, usingDevCredentials };
}

function parseCookies(request) {
  const header = request.headers.cookie;
  if (!header) return {};

  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((pair) => {
        const [key, ...rest] = pair.split('=');
        return [key, decodeURIComponent(rest.join('='))];
      })
  );
}

function buildAllowedOrigins(extraOrigin) {
  const defaults = new Set(['http://localhost:4321', 'http://127.0.0.1:4321']);
  const normalizedExtraOrigin = String(extraOrigin ?? '').trim();
  if (normalizedExtraOrigin) {
    defaults.add(normalizedExtraOrigin);
  }
  return defaults;
}

function setCorsHeaders(req, res, allowedOrigins) {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function slugifyFilename(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';
}

function readRawBody(req, maxBytes = MAX_UPLOAD_SIZE + 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Файл слишком большой. Максимум 10 MB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipartFile(buffer, contentType) {
  const boundaryMatch = String(contentType || '').match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw new Error('Некорректный multipart/form-data');
  const boundary = boundaryMatch[1];
  const delimiter = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(delimiter);
  while (start !== -1) {
    const next = buffer.indexOf(delimiter, start + delimiter.length);
    if (next === -1) break;
    const part = buffer.slice(start + delimiter.length + 2, next - 2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString('utf8');
      if (headers.includes('name="file"')) {
        const fileNameMatch = headers.match(/filename="([^"]*)"/i);
        const filename = fileNameMatch ? fileNameMatch[1] : 'upload.bin';
        const fileBuffer = part.slice(headerEnd + 4);
        return { filename, fileBuffer };
      }
    }
    start = next;
  }
  throw new Error('Файл не найден в multipart-запросе');
}

function normalizeOrderItems(items) {
  if (!Array.isArray(items)) return items;
  return items.map((item, index) => {
    if (item && typeof item === 'object' && !Array.isArray(item) && 'order' in item) {
      return { ...item, order: (index + 1) * 10 };
    }
    return item;
  });
}

function sanitizeSlug(slug) {
  if (!SAFE_SLUG_RE.test(slug)) {
    throw new Error('Некорректный slug. Разрешены только a-z, 0-9, -, _.');
  }
  return slug;
}

function getCollectionConfig(collection) {
  const config = COLLECTIONS[collection];
  if (!config) {
    throw new Error('Коллекция не разрешена');
  }
  return config;
}

async function readJsonFile(fullPath) {
  const content = await fs.readFile(fullPath, 'utf8');
  return JSON.parse(content);
}

async function listCollectionEntries(collection) {
  const config = getCollectionConfig(collection);

  if (config.type === 'single-file') {
    const json = await readJsonFile(config.path);
    return [
      {
        slug: config.slug,
        fileName: path.basename(config.path),
        title: json.title ?? json.companyName ?? 'Настройки',
        isActive: typeof json.isActive === 'boolean' ? json.isActive : null,
        order: typeof json.order === 'number' ? json.order : null,
        summary: {
          shortDescription: json.shortDescription ?? null,
          mode: json.mode ?? null
        }
      }
    ];
  }

  const dirEntries = await fs.readdir(config.path, { withFileTypes: true });
  const items = [];
  for (const entry of dirEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

    const slug = entry.name.replace(/\.json$/i, '');
    if (!SAFE_SLUG_RE.test(slug)) continue;

    const json = await readJsonFile(path.join(config.path, entry.name));
    items.push({
      slug,
      fileName: entry.name,
      title: json.title ?? slug,
      isActive: typeof json.isActive === 'boolean' ? json.isActive : null,
      order: typeof json.order === 'number' ? json.order : null,
      summary: {
        shortDescription: json.shortDescription ?? null,
        mode: json.mode ?? null
      }
    });
  }

  return items.sort((a, b) => {
    const orderA = typeof a.order === 'number' ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === 'number' ? b.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title, 'ru');
  });
}

async function resolveJsonPath(collection, slug) {
  const config = getCollectionConfig(collection);

  if (config.type === 'single-file') {
    if (slug !== config.slug) {
      throw new Error('Запись не найдена');
    }
    return config.path;
  }

  const safeSlug = sanitizeSlug(slug);
  const fullPath = path.join(config.path, `${safeSlug}.json`);
  const normalizedBase = path.resolve(config.path);
  const normalizedPath = path.resolve(fullPath);

  if (!normalizedPath.startsWith(normalizedBase + path.sep)) {
    throw new Error('Неверный путь');
  }

  return fullPath;
}

function getAuthUser(req) {
  const cookies = parseCookies(req);
  const token = cookies['admin_session'];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  return session.username;
}

function requireAuth(req, res) {
  const username = getAuthUser(req);
  if (!username) {
    sendJson(res, 401, { error: 'Требуется авторизация' });
    return null;
  }
  return username;
}

function buildSessionToken(secret, username) {
  const randomPart = crypto.randomBytes(32).toString('hex');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${username}:${randomPart}`)
    .digest('hex');
  return `${randomPart}.${signature}`;
}

function writeSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

const { config, usingDevCredentials } = await loadEnvConfig();
const allowedOrigins = buildAllowedOrigins(config.ADMIN_ALLOWED_ORIGIN);

if (usingDevCredentials) {
  console.warn('[admin-api] WARNING: используются dev credentials (admin/admin). Добавьте .env.local или .env.admin.local');
}

if (config.CONTENT_WRITE_MODE !== 'local') {
  console.warn(`[admin-api] WARNING: CONTENT_WRITE_MODE=${config.CONTENT_WRITE_MODE}. Stage 1 поддерживает только local.`);
}

const server = http.createServer(async (req, res) => {
  try {
    setCorsHeaders(req, res, allowedOrigins);

    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${config.ADMIN_API_PORT}`);
    const pathname = url.pathname;

    if (!pathname.startsWith('/api/admin')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      const username = String(body.login ?? '').trim();
      const password = String(body.password ?? '');

      if (username !== config.ADMIN_USERNAME || password !== config.ADMIN_PASSWORD) {
        sendJson(res, 401, { error: 'Неверный логин или пароль' });
        return;
      }

      const token = buildSessionToken(config.SESSION_SECRET, username);
      sessions.set(token, { username, createdAt: Date.now() });
      writeSessionCookie(res, token);
      sendJson(res, 200, { ok: true, username });
      return;
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      const cookies = parseCookies(req);
      const token = cookies.admin_session;
      if (token) sessions.delete(token);
      clearSessionCookie(res);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/me' && req.method === 'GET') {
      const username = getAuthUser(req);
      if (!username) {
        sendJson(res, 200, { authenticated: false });
        return;
      }
      sendJson(res, 200, { authenticated: true, username });
      return;
    }

    if (!requireAuth(req, res)) {
      return;
    }

    if (pathname === '/api/admin/upload' && req.method === 'POST') {
      const contentType = req.headers['content-type'] || '';
      if (!String(contentType).includes('multipart/form-data')) {
        sendJson(res, 400, { error: 'Ожидается multipart/form-data' });
        return;
      }

      const raw = await readRawBody(req);
      const { filename, fileBuffer } = parseMultipartFile(raw, contentType);
      if (!fileBuffer?.length) {
        sendJson(res, 400, { error: 'Пустой файл' });
        return;
      }
      if (fileBuffer.length > MAX_UPLOAD_SIZE) {
        sendJson(res, 400, { error: 'Файл слишком большой. Максимум 10 MB.' });
        return;
      }

      const ext = path.extname(filename).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        sendJson(res, 400, { error: 'Разрешены только jpg, jpeg, png, webp, svg' });
        return;
      }

      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      const baseName = slugifyFilename(path.basename(filename, ext));
      const safeName = `${baseName}-${Date.now()}${ext}`;
      const filePath = path.join(UPLOADS_DIR, safeName);
      await fs.writeFile(filePath, fileBuffer);
      sendJson(res, 200, { path: `/uploads/${safeName}` });
      return;
    }

    if (pathname === '/api/admin/collections' && req.method === 'GET') {
      const collections = Object.entries(COLLECTIONS).map(([key, value]) => ({
        key,
        label: value.label
      }));
      sendJson(res, 200, { collections });
      return;
    }

    const matchList = pathname.match(/^\/api\/admin\/content\/([a-z0-9-]+)$/i);
    if (matchList && req.method === 'GET') {
      const [, collection] = matchList;
      const entries = await listCollectionEntries(collection);
      sendJson(res, 200, { entries });
      return;
    }

    const matchEntry = pathname.match(/^\/api\/admin\/content\/([a-z0-9-]+)\/([a-z0-9_-]+)$/i);
    if (matchEntry && req.method === 'GET') {
      const [, collection, slug] = matchEntry;
      const filePath = await resolveJsonPath(collection, slug);
      const content = await readJsonFile(filePath);
      sendJson(res, 200, { content });
      return;
    }

    if (matchEntry && req.method === 'PUT') {
      const [, collection, slug] = matchEntry;
      const filePath = await resolveJsonPath(collection, slug);
      const body = await readBody(req);

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        sendJson(res, 400, { error: 'Ожидается JSON-объект' });
        return;
      }

      await fs.writeFile(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      const saved = await readJsonFile(filePath);
      sendJson(res, 200, { ok: true, content: saved });
      return;
    }

    sendJson(res, 404, { error: 'Маршрут не найден' });
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Неизвестная ошибка' });
  }
});

server.listen(config.ADMIN_API_PORT, () => {
  console.log(`[admin-api] running on http://127.0.0.1:${config.ADMIN_API_PORT}/api/admin`);
  console.log(`[admin-api] CORS origins: ${Array.from(allowedOrigins).join(', ')}`);
});
