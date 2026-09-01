import fs from 'node:fs/promises';
import path from 'node:path';

export class AstroCliResolutionError extends Error {
  constructor(code, message, { cause, details } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AstroCliResolutionError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function contained(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function resolveAstroCli(repoRoot) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const packageRoot = path.join(resolvedRepoRoot, 'node_modules', 'astro');
  const packageJsonPath = path.join(packageRoot, 'package.json');
  let packageJson;
  try {
    packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new AstroCliResolutionError(
        'ASTRO_PACKAGE_MISSING',
        `Astro package metadata was not found at ${packageJsonPath}. Run npm ci before starting this command.`,
        { cause: error }
      );
    }
    throw new AstroCliResolutionError(
      'ASTRO_PACKAGE_INVALID',
      `Astro package metadata is not valid JSON: ${packageJsonPath}. Run npm ci to restore dependencies.`,
      { cause: error }
    );
  }

  const declaredBin = typeof packageJson?.bin === 'string'
    ? packageJson.bin
    : packageJson?.bin?.astro;
  if (typeof declaredBin !== 'string' || declaredBin.trim() === '') {
    throw new AstroCliResolutionError(
      'ASTRO_CLI_DECLARATION_MISSING',
      `Astro package metadata does not declare bin.astro: ${packageJsonPath}. Run npm ci to restore dependencies.`
    );
  }
  if (path.isAbsolute(declaredBin)) {
    throw new AstroCliResolutionError(
      'ASTRO_CLI_PATH_ESCAPE',
      `Astro bin.astro must be relative to its package root, received: ${declaredBin}`
    );
  }

  const declaredCli = path.resolve(packageRoot, declaredBin);
  if (!contained(packageRoot, declaredCli)) {
    throw new AstroCliResolutionError(
      'ASTRO_CLI_PATH_ESCAPE',
      `Astro bin.astro escapes its package root: ${declaredBin}`
    );
  }

  let realPackageRoot;
  let realCli;
  try {
    [realPackageRoot, realCli] = await Promise.all([
      fs.realpath(packageRoot),
      fs.realpath(declaredCli)
    ]);
  } catch (error) {
    throw new AstroCliResolutionError(
      'ASTRO_CLI_MISSING',
      `Astro CLI declared by package metadata was not found: ${declaredCli}. Run npm ci to restore dependencies.`,
      { cause: error, details: { declaredBin } }
    );
  }
  if (!contained(realPackageRoot, realCli)) {
    throw new AstroCliResolutionError(
      'ASTRO_CLI_PATH_ESCAPE',
      `Astro bin.astro resolves outside its package root: ${declaredBin}`
    );
  }

  const stat = await fs.stat(realCli);
  if (!stat.isFile()) {
    throw new AstroCliResolutionError(
      'ASTRO_CLI_NOT_FILE',
      `Astro bin.astro does not resolve to a regular file: ${realCli}`
    );
  }
  return realCli;
}
