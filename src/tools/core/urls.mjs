// Project snapshots keep their portable root-relative paths. Resolve only the
// displayed/exported result against the current deployment's public base.
export function publicProductUrl(path, publicBase) {
  const base = new URL(publicBase);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Некорректный адрес сайта.');
  base.search = ''; base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  return new URL(String(path).replace(/^\//, ''), base).href;
}
