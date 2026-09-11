import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const port = Number(process.argv[2] ?? 4179);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const filename = pathname === '/' ? 'good.html' : pathname === '/bad' ? 'bad.html' : undefined;
  if (!filename) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  try {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(await readFile(new URL(filename, import.meta.url)));
  } catch {
    response.writeHead(500).end('Fixture unavailable');
  }
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
