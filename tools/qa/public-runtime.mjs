import fs from 'node:fs';

// Official Microsoft image; the OCI index digest was verified against its bytes.
// This fixes browsers, fonts and user-space libraries across hosted runner rolls.
export const PUBLIC_QA_IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';
export const PUBLIC_QA_CHROME = '/ms-playwright/chromium-1243/chrome-linux64/chrome';

export function publicRuntimeImage({ environment = process.env, platform = process.platform,
  exists = fs.existsSync, read = filename => fs.readFileSync(filename, 'utf8') } = {}) {
  const configured = environment.H6_QA_CONTAINER_IMAGE;
  if (!configured) return environment.ImageVersion || environment.RUNNER_OS || platform;
  if (configured !== PUBLIC_QA_IMAGE || platform !== 'linux'
    || environment.CHROME_PATH !== PUBLIC_QA_CHROME
    || !exists('/.dockerenv') || !exists(PUBLIC_QA_CHROME)) {
    throw new Error('Public QA requires its digest-pinned container and bundled Chromium.');
  }
  const marker = JSON.parse(read('/ms-playwright/.docker-info'));
  if (marker.driverVersion !== '1.63.0' || marker.dockerImageName !== 'mcr.microsoft.com/playwright:v1.63.0-noble') {
    throw new Error('Public QA container marker does not match the pinned browser image.');
  }
  return configured;
}
