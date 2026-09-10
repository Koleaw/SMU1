import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The acceptance API writes into its disposable content tree. Serve those real
// promoted bytes at their canonical URLs, just as the ordinary editor does.
// No staging data or arbitrary files are exposed by this test-only middleware.
export function isolatedMediaPreview(contentRoot) {
  const uploadRoot = path.resolve(contentRoot, 'public', 'uploads');
  return {
    name: 'smu1-isolated-media-preview',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const match = /^\/uploads\/([a-f0-9]{64}\.(png|jpe?g))(?:\?.*)?$/u.exec(req.url || '');
        if (!match || !['GET', 'HEAD'].includes(req.method)) return next();
        try {
          const bytes = await readFile(path.join(uploadRoot, match[1]));
          res.statusCode = 200;
          res.setHeader('Content-Type', match[2] === 'png' ? 'image/png' : 'image/jpeg');
          res.setHeader('Content-Length', bytes.length);
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.end(req.method === 'HEAD' ? undefined : bytes);
        } catch (error) {
          if (error.code === 'ENOENT') return next();
          next(error);
        }
      });
    }
  };
}
