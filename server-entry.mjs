import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyChatgptInventoryMetadata } from './lib/chatgpt-inventory.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data', 'state.json');
const originalCreateServer = http.createServer.bind(http);

function json(res, code, body) {
  res.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(body));
}

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip.includes('127.0.0.1') || ip.includes('::ffff:127.0.0.1');
}

function authorized(req) {
  const required = process.env.SHINO_SYNC_TOKEN;
  if (!required) return isLoopback(req);
  return req.headers.authorization === `Bearer ${required}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 8_000_000) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (error) { reject(error); }
    });
  });
}

http.createServer = function wrappedCreateServer(listener) {
  return originalCreateServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (req.method === 'POST' && url.pathname === '/api/ingest/chatgpt-inventory') {
        if (!authorized(req)) return json(res, 401, {error:'Unauthorized'});
        const payload = await readBody(req);
        const state = JSON.parse(fs.readFileSync(DATA, 'utf8'));
        const result = applyChatgptInventoryMetadata(state, payload);
        fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
        return json(res, 200, {ok:true, ...result});
      }
    } catch (error) {
      return json(res, 500, {error:String(error?.message || error)});
    }
    return listener(req, res);
  });
};

await import('./server.mjs');
