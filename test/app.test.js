import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInvoiceText } from '../src/ai.js';
import { PayPalSimulator } from '../src/paypalSimulator.js';
import { summariseInvoices, draftFollowUp, isOverdue } from '../src/agent.js';

test('AI parser: flat-fee job with client and weekday due date', () => {
  const now = new Date('2026-11-05T12:00:00Z'); // a Thursday
  const draft = parseInvoiceText("Logo design for Maria's bakery, $450, due Friday", now);
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].unitAmount, 450);
  assert.equal(draft.total, 450);
  assert.equal(draft.dueDate, '2026-11-06'); // the Friday after Thu Nov 5
  assert.equal(draft.confidence, 'high');
});

test('AI parser: hourly job', () => {
  const draft = parseInvoiceText('6 hours of consulting at $80/hr for Acme Corp, due in 10 days', new Date('2026-11-05T12:00:00Z'));
  assert.equal(draft.items[0].quantity, 6);
  assert.equal(draft.items[0].unitAmount, 80);
  assert.equal(draft.items[0].unit, 'HOURS');
  assert.equal(draft.total, 480);
  assert.equal(draft.dueDate, '2026-11-15');
});

test('AI parser: no amount -> low confidence placeholder draft', () => {
  const draft = parseInvoiceText('Fix the landing page hero section');
  assert.equal(draft.confidence, 'low');
  assert.equal(draft.items[0].unitAmount, 0);
});

test('simulator: full lifecycle DRAFT -> UNPAID -> PAID', async () => {
  const gw = new PayPalSimulator();
  const draft = parseInvoiceText('Website audit, $300, due in 3 days');
  const created = await gw.createInvoice(draft);
  assert.equal(created.status, 'DRAFT');
  const sent = await gw.sendInvoice(created.id);
  assert.equal(sent.status, 'UNPAID');
  const paid = await gw.recordPayment(created.id);
  assert.equal(paid.status, 'PAID');
  assert.equal(paid.amount.value, '300.00');
});

test('agent: summary counts and overdue follow-up escalates', async () => {
  const gw = new PayPalSimulator();
  const old = await gw.createInvoice({ items: [{ name: 'Old job', quantity: 1, unitAmount: 100 }], currency: 'USD', dueDate: '2026-10-20', clientName: 'Late Larry' });
  await gw.sendInvoice(old.id);
  const fresh = await gw.createInvoice({ items: [{ name: 'New job', quantity: 2, unitAmount: 50 }], currency: 'USD', dueDate: '2027-01-01' });
  await gw.sendInvoice(fresh.id);
  const all = await gw.listInvoices();
  const now = new Date('2026-11-05T12:00:00Z');
  const summary = summariseInvoices(all, now);
  assert.equal(summary.unpaid, 2);
  assert.equal(summary.overdue, 1);
  assert.equal(summary.outstandingValue, 200);
  const overdueInv = await gw.getInvoice(old.id);
  assert.equal(isOverdue(overdueInv, now), true);
  const fu = draftFollowUp(overdueInv, now);
  assert.equal(fu.daysOverdue, 16);
  assert.match(fu.subject, /overdue/i);
});
