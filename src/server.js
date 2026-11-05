/**
 * InvoicePilot server — zero-dependency HTTP app.
 *
 * Flow: describe work in plain English -> AI drafts the invoice -> one click
 * creates + sends a PayPal invoice (real sandbox API when credentials are
 * configured, built-in simulator otherwise) -> dashboard tracks status ->
 * agent drafts follow-ups for overdue invoices.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseInvoiceText, parseWithLLM } from './ai.js';
import { createPayPalGateway } from './paypal.js';
import { summariseInvoices, draftFollowUp, isOverdue, payerLink } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gateway = createPayPalGateway();

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export function createServer(gw = gateway) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        const html = await readFile(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end(html);
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        return json(res, 200, { ok: true, paypalMode: gw.mode });
      }
      // 1) AI draft from plain English
      if (req.method === 'POST' && url.pathname === '/api/draft') {
        const { text } = await readBody(req);
        const draft = await parseWithLLM(text);
        return json(res, 200, { draft });
      }
      // 2) Create + send the PayPal invoice from a draft
      if (req.method === 'POST' && url.pathname === '/api/invoices') {
        const { draft, clientEmail } = await readBody(req);
        if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) {
          return json(res, 400, { error: 'draft.items required' });
        }
        const created = await gw.createInvoice({ ...draft, clientEmail });
        const sent = await gw.sendInvoice(created.id);
        return json(res, 201, { invoice: sent, payerLink: payerLink(sent) });
      }
      // 3) Dashboard data
      if (req.method === 'GET' && url.pathname === '/api/invoices') {
        const invoices = await gw.listInvoices();
        return json(res, 200, { summary: summariseInvoices(invoices), invoices });
      }
      // 4) Simulate client payment (simulator mode only)
      const payMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/pay$/);
      if (req.method === 'POST' && payMatch) {
        const updated = await gw.recordPayment(payMatch[1]);
        return json(res, 200, { invoice: updated });
      }
      // 5) Agent follow-up draft for one invoice
      const followMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/follow-up$/);
      if (req.method === 'GET' && followMatch) {
        const invoice = await gw.getInvoice(followMatch[1]);
        return json(res, 200, { overdue: isOverdue(invoice), followUp: draftFollowUp(invoice) });
      }
      return json(res, 404, { error: 'not found' });
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => {
    console.log(`InvoicePilot running on http://localhost:${port} (PayPal mode: ${gateway.mode})`);
  });
}
