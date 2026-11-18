// Test-only "GitHub": the system git's smart-HTTP CGI (`git http-backend`) over bare repos in `root`.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

export function bareRepo(root, name) {
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', path.join(root, `${name}.git`)]);
  return `${name}.git`;
}

export async function startGitServer(root) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const cgi = spawn('git', ['http-backend'], { env: { ...process.env,
      GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: '1', REMOTE_USER: 'test', // REMOTE_USER enables receive-pack
      PATH_INFO: url.pathname, QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method,
      CONTENT_TYPE: req.headers['content-type'] ?? '' } });
    req.pipe(cgi.stdin);
    let head = Buffer.alloc(0); let sent = false;
    cgi.stdout.on('data', chunk => {
      if (sent) return void res.write(chunk);
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) return;
      for (const line of head.subarray(0, end).toString().split('\r\n')) {
        const [k, ...v] = line.split(':'); const value = v.join(':').trim();
        if (k.toLowerCase() === 'status') res.statusCode = parseInt(value, 10); else res.setHeader(k, value);
      }
      sent = true; res.write(head.subarray(end + 4));
    });
    cgi.on('close', () => res.end());
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: name => `http://127.0.0.1:${server.address().port}/${name}`, close: () => new Promise(r => server.close(r)) };
}
