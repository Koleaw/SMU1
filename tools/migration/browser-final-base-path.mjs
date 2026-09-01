import path from 'node:path';

export function normalizeBrowserFinalBasePath(value) {
  const raw = String(value || '/').trim();
  if (!raw || raw === '/') return '/';
  if (raw.includes('\\') || raw.includes('?') || raw.includes('#')) {
    throw new TypeError(`Invalid browser QA BASE_PATH: ${raw}`);
  }
  const normalized = `/${raw.replace(/^\/+|\/+$/gu, '')}`;
  if (normalized.split('/').some((part) => part === '.' || part === '..')) {
    throw new TypeError(`Invalid browser QA BASE_PATH: ${raw}`);
  }
  return normalized;
}

export function withBrowserFinalBasePath(route, basePath = '/') {
  const base = normalizeBrowserFinalBasePath(basePath);
  const value = String(route || '/');
  if (!value.startsWith('/') || value.startsWith('//')) {
    throw new TypeError(`Browser QA route must be an absolute pathname: ${value}`);
  }
  const parsed = new URL(value, 'http://browser-final.invalid/');
  const pathname = base === '/'
    ? parsed.pathname
    : parsed.pathname === '/'
      ? `${base}/`
      : `${base}${parsed.pathname}`;
  return `${pathname}${parsed.search}${parsed.hash}`;
}

export function withoutBrowserFinalBasePath(pathname, basePath = '/') {
  const base = normalizeBrowserFinalBasePath(basePath);
  const value = String(pathname || '/');
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (base === '/') return value;
  if (value === base) return '/';
  if (!value.startsWith(`${base}/`)) return null;
  return value.slice(base.length) || '/';
}

export function resolveBrowserFinalDistRequest(distRoot, pathname, basePath = '/') {
  const root = path.resolve(distRoot);
  const logicalPathname = withoutBrowserFinalBasePath(pathname, basePath);
  if (logicalPathname === null) return Object.freeze({ status: 'outside-base', logicalPathname: null, filename: null });
  const filename = logicalPathname === '/404.html'
    ? path.join(root, '404.html')
    : path.resolve(root, `.${logicalPathname}`);
  const inside = filename === root || filename.startsWith(`${root}${path.sep}`);
  return Object.freeze({
    status: inside ? 'ok' : 'unsafe',
    logicalPathname,
    filename: inside ? filename : null
  });
}
