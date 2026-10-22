#!/usr/bin/env node
// Tiny API for the workbench example (zero dependencies). Listens on 127.0.0.1 only.
//   node example-api.mjs [--port 4318]
//
//   GET  /health        200 {"status":"ok"}
//   POST /api/orders    201 with the created order, and appends "OrderCreated id=..." to app.log
//                       (400 when item or a positive qty is missing)
//   POST /api/refunds   400: refunds are not implemented, so the example's AC3 fails honestly

import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({ options: { port: { type: 'string', default: '4318' } } });
const LOG = join(dirname(fileURLToPath(import.meta.url)), 'app.log');
const log = (level, message) => appendFileSync(LOG, `${new Date().toISOString()} ${level.padEnd(5)} ${message}\n`, 'utf8');
let next = 1000;

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': `req-${Date.now().toString(36)}` });
  res.end(JSON.stringify(body));
};

const readJson = (req) => new Promise((done) => {
  let text = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { text += c; });
  req.on('end', () => { try { done(JSON.parse(text || '{}')); } catch { done(null); } });
});

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });

  if (req.method === 'POST' && url.pathname === '/api/orders') {
    const body = await readJson(req);
    if (!body || typeof body.item !== 'string' || !(Number(body.qty) > 0)) {
      log('WARN', 'OrderRejected reason=invalid-body');
      return send(res, 400, { error: 'item and a positive qty are required' });
    }
    const order = { id: `ord-${next++}`, item: body.item, qty: Number(body.qty), status: 'created' };
    log('INFO', `OrderCreated id=${order.id} item=${order.item} qty=${order.qty}`);
    return send(res, 201, order);
  }

  if (req.method === 'POST' && url.pathname === '/api/refunds') {
    await readJson(req);
    log('WARN', 'RefundRejected reason=not-implemented');
    return send(res, 400, { error: 'refunds are not supported yet', code: 'REFUNDS_DISABLED' });
  }

  return send(res, 404, { error: 'not found' });
}).listen(Number(opts.port), '127.0.0.1', () => {
  log('INFO', `example-api listening on 127.0.0.1:${opts.port}`);
  console.log(`example-api: http://127.0.0.1:${opts.port}/ (log: ${LOG})`);
});
