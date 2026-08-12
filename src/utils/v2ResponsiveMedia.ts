import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export type V2ResponsiveMediaRole =
  | 'hero'
  | 'card'
  | 'gallery'
  | 'thumbnail'
  | 'lightbox'
  | 'archive'
  | 'gateway'
  | 'poster'
  | 'home-card'
  | 'proof'
  | 'project';

export type V2MediaRole = V2ResponsiveMediaRole;

export interface V2ResponsiveMediaCandidate {
  path: string;
  src: string;
  width: number;
  height: number;
  bytes: number;
}

export interface V2ResponsiveMediaSource {
  type: 'image/avif' | 'image/webp';
  candidates: V2ResponsiveMediaCandidate[];
}

export interface V2ResolvedResponsiveMedia {
  canonicalSrc: string;
  src: string;
  srcCandidates: V2ResponsiveMediaCandidate[];
  sources: V2ResponsiveMediaSource[];
  avif: V2ResponsiveMediaCandidate[];
  webp: V2ResponsiveMediaCandidate[];
  fallback: V2ResponsiveMediaCandidate[];
  fallbackType: 'image/jpeg' | 'image/png';
  sizes: string;
  width?: number;
  height?: number;
  sourceHash?: string;
  alpha?: boolean;
  optimized: boolean;
}

interface ManifestVariant {
  path: string;
  format: 'avif' | 'webp' | 'jpeg' | 'png';
  width: number;
  height: number;
  bytes: number;
  sha256: string;
}

interface ManifestEntry {
  source: {
    path: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    format: string;
    orientation: number;
    alpha: boolean;
  };
  roles: string[];
  consumers: string[];
  variants: ManifestVariant[];
}

interface ResponsiveMediaManifest {
  schemaVersion: number;
  generator: {
    roleWidths?: Record<string, number[]>;
  };
  entries: Record<string, ManifestEntry>;
}

const MANIFEST_PATH = resolve(process.cwd(), 'public/_media/h5/manifest.json');
const PUBLIC_ROOT = resolve(process.cwd(), 'public');
const DEFAULT_WIDTHS = [160, 240, 320, 480, 768, 1024, 1440, 1920];
const DEFAULT_ROLE_WIDTHS: Record<V2ResponsiveMediaRole, readonly number[]> = {
  hero: DEFAULT_WIDTHS,
  card: [320, 480, 768, 1024],
  gallery: DEFAULT_WIDTHS,
  thumbnail: [160, 240, 320],
  lightbox: [768, 1024, 1440, 1920],
  archive: [320, 480, 768, 1024, 1440],
  gateway: [480, 768, 1024, 1440, 1920],
  poster: [480, 768, 1024, 1440, 1920],
  'home-card': [320, 480, 768, 1024],
  proof: [320, 480, 768, 1024, 1440],
  project: [320, 480, 768, 1024, 1440]
};
const DEFAULT_SIZES: Record<V2ResponsiveMediaRole, string> = {
  hero: '100vw',
  card: '(max-width: 760px) calc(100vw - 32px), (max-width: 1180px) calc(50vw - 32px), 420px',
  gallery: '(max-width: 760px) calc(100vw - 32px), (max-width: 1180px) 58vw, 760px',
  thumbnail: '104px',
  lightbox: '100vw',
  archive: '(max-width: 760px) calc(100vw - 32px), 62vw',
  gateway: '(max-width: 760px) calc(100vw - 32px), min(1360px, calc(100vw - 64px))',
  poster: '100vw',
  'home-card': '(max-width: 760px) calc(100vw - 32px), 50vw',
  proof: '(max-width: 760px) calc(100vw - 32px), 58vw',
  project: '(max-width: 760px) calc(100vw - 32px), 62vw'
};

let manifestCache: ResponsiveMediaManifest | null | undefined;
const variantAvailability = new Map<string, boolean>();

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object';

const loadManifest = (): ResponsiveMediaManifest | null => {
  if (manifestCache !== undefined) return manifestCache;
  try {
    const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !isRecord(parsed.entries)) {
      manifestCache = null;
    } else {
      manifestCache = parsed as unknown as ResponsiveMediaManifest;
    }
  } catch {
    manifestCache = null;
  }
  return manifestCache;
};

const normalizeCanonical = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return trimmed;
  let candidate = trimmed.split(/[?#]/u, 1)[0].replaceAll('\\', '/');
  try {
    candidate = decodeURI(candidate);
  } catch {
    return trimmed;
  }
  const segments = candidate.split('/');
  return segments.some((segment) => segment === '.' || segment === '..') ? trimmed : candidate;
};

const isManifestVariant = (value: unknown): value is ManifestVariant => (
  isRecord(value)
  && typeof value.path === 'string'
  && ['avif', 'webp', 'jpeg', 'png'].includes(String(value.format))
  && Number.isInteger(value.width)
  && Number(value.width) > 0
  && Number.isInteger(value.height)
  && Number(value.height) > 0
  && Number.isInteger(value.bytes)
  && Number(value.bytes) > 0
  && typeof value.sha256 === 'string'
);

const isManifestEntry = (value: unknown): value is ManifestEntry => (
  isRecord(value)
  && isRecord(value.source)
  && typeof value.source.path === 'string'
  && Number.isInteger(value.source.width)
  && Number(value.source.width) > 0
  && Number.isInteger(value.source.height)
  && Number(value.source.height) > 0
  && typeof value.source.alpha === 'boolean'
  && Array.isArray(value.roles)
  && value.roles.every((role) => typeof role === 'string')
  && Array.isArray(value.variants)
  && value.variants.every(isManifestVariant)
);

const publicFileFor = (publicPath: string) => {
  const absolute = resolve(PUBLIC_ROOT, `.${publicPath}`);
  return absolute.startsWith(`${PUBLIC_ROOT}${sep}`) ? absolute : undefined;
};

const isAvailable = (variant: ManifestVariant) => {
  const cached = variantAvailability.get(variant.path);
  if (cached !== undefined) return cached;
  const file = publicFileFor(variant.path);
  let available = false;
  if (file && existsSync(file)) {
    try {
      const details = statSync(file);
      available = details.isFile() && details.size === variant.bytes && variant.bytes > 0;
      if (available) {
        available = createHash('sha256').update(readFileSync(file)).digest('hex') === variant.sha256;
      }
    } catch {
      available = false;
    }
  }
  variantAvailability.set(variant.path, available);
  return available;
};

const roleWidths = (manifest: ResponsiveMediaManifest, role: V2ResponsiveMediaRole) => {
  const configured = manifest.generator?.roleWidths?.[role];
  return new Set(
    Array.isArray(configured) && configured.every((width) => Number.isInteger(width) && width > 0)
      ? configured
      : DEFAULT_ROLE_WIDTHS[role]
  );
};

const candidatesFor = (variants: ManifestVariant[], format: ManifestVariant['format']): V2ResponsiveMediaCandidate[] => (
  variants
    .filter((variant) => variant.format === format)
    .map((variant) => ({
      path: variant.path,
      src: variant.path,
      width: variant.width,
      height: variant.height,
      bytes: variant.bytes
    }))
    .sort((left, right) => left.width - right.width)
);

/**
 * Resolves build-time derivatives without adding BASE_PATH. Astro consumers must
 * pass every returned URL through v2Href (including srcset candidates).
 */
export const resolveV2ResponsiveMedia = (
  canonicalSource: string,
  role: V2ResponsiveMediaRole,
  sizes = DEFAULT_SIZES[role]
): V2ResolvedResponsiveMedia => {
  const canonicalSrc = normalizeCanonical(canonicalSource);
  const failOpen: V2ResolvedResponsiveMedia = {
    canonicalSrc,
    src: canonicalSrc,
    srcCandidates: [],
    sources: [],
    avif: [],
    webp: [],
    fallback: [],
    fallbackType: 'image/jpeg',
    sizes,
    optimized: false
  };
  const manifest = loadManifest();
  const entry = manifest?.entries?.[canonicalSrc];
  if (!manifest || !isManifestEntry(entry)) return failOpen;

  const allowedWidths = roleWidths(manifest, role);
  const variants = entry.variants.filter((variant) => (
    allowedWidths.has(variant.width)
    && Number.isInteger(variant.height)
    && variant.height > 0
    && isAvailable(variant)
  ));
  const avif = candidatesFor(variants, 'avif');
  const webp = candidatesFor(variants, 'webp');
  const fallbackFormat = entry.source.alpha ? 'png' : 'jpeg';
  const srcCandidates = candidatesFor(variants, fallbackFormat);
  const largestFallback = srcCandidates.at(-1);
  const sources: V2ResponsiveMediaSource[] = [];
  if (avif.length > 0) sources.push({ type: 'image/avif', candidates: avif });
  if (webp.length > 0) sources.push({ type: 'image/webp', candidates: webp });

  return {
    canonicalSrc,
    src: largestFallback?.src ?? canonicalSrc,
    srcCandidates,
    sources,
    avif,
    webp,
    fallback: srcCandidates,
    fallbackType: entry.source.alpha ? 'image/png' : 'image/jpeg',
    sizes,
    width: entry.source.width,
    height: entry.source.height,
    sourceHash: entry.source.sha256,
    alpha: entry.source.alpha,
    optimized: sources.length > 0 || Boolean(largestFallback)
  };
};

export const serializeV2ResponsiveSrcset = (
  candidates: readonly V2ResponsiveMediaCandidate[],
  resolveHref: (src: string) => string
) => candidates.map((candidate) => `${resolveHref(candidate.src)} ${candidate.width}w`).join(', ');
