// Versioned, local-only PDF support assets. Build emits package bytes directly;
// development serves only this enumerated map, never arbitrary disk paths.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
export const pdfVersion = '6.4.299';
export const pdfAssetBase = `/assets/pdfjs-${pdfVersion}/`;
const packageFile = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
export const pdfPackageRoot = path.dirname(packageFile);
if (JSON.parse(fs.readFileSync(packageFile, 'utf8')).version !== pdfVersion) throw Error('PDF.js identity differs from the fixed Trace adoption');
export function localPdfAssets() {
  const files = new Map([['LICENSE', path.join(pdfPackageRoot, 'LICENSE')]]);
  for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    for (const name of fs.readdirSync(path.join(pdfPackageRoot, directory))) {
      const file = path.join(pdfPackageRoot, directory, name);
      if (fs.statSync(file).isFile()) files.set(`${directory}/${name}`, file);
    }
  }
  return files;
}
export function pdfAssetsPlugin() {
  const files = localPdfAssets();
  return {
    name: 'trace-local-pdf-assets',
    generateBundle() {
      for (const [name, file] of files) this.emitFile({ type: 'asset', fileName: pdfAssetBase.slice(1) + name, source: fs.readFileSync(file) });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost').pathname;
        if (!pathname.startsWith(pdfAssetBase)) return next();
        const file = files.get(pathname.slice(pdfAssetBase.length));
        if (!file || !['GET', 'HEAD'].includes(request.method)) { response.statusCode = 404; response.end(); return; }
        response.setHeader('content-type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.ttf') ? 'font/ttf' : 'application/octet-stream');
        if (request.method === 'HEAD') response.end(); else fs.createReadStream(file).pipe(response);
      });
    },
  };
}
