#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { fileURLToPath } from 'node:url';

// Simple static server to avoid shelling out to serve CLI
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const defaultPort = Number(process.env.PDF_PORT || 4173);
const port = defaultPort;
const outputArg = process.argv[2];
const outputPath = path.resolve(projectRoot, outputArg || path.join('exports', 'deck.pdf'));

const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

function createStaticServer(root) {
  return createServer(async (req, res) => {
    try {
      const reqUrl = new url.URL(req.url, `http://localhost:${port}`);
      let pathname = path.join(root, reqUrl.pathname);
      if (pathname.endsWith('/')) {
        pathname = path.join(pathname, 'index.html');
      }
      const stat = await fs.stat(pathname).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(pathname).toLowerCase();
      res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
      createReadStream(pathname).pipe(res);
    } catch (error) {
      res.writeHead(500);
      res.end(error.message);
    }
  });
}

const server = createStaticServer(projectRoot);

server.listen(port, async () => {
  console.log(`PDF export server running at http://localhost:${port}`);
  const { launch } = await import('puppeteer');
  const browser = await launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${port}/deck.html`, { waitUntil: 'networkidle2' });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(`✅ Saved PDF to ${outputPath}`);
  } catch (error) {
    console.error('❌ PDF export failed:', error);
    process.exitCode = 1;
  } finally {
    await browser.close();
    server.close();
  }
});
