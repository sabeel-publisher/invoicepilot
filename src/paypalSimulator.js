/**
 * In-memory simulator of the PayPal Invoicing API surface we use.
 *
 * Purpose: the whole agent flow (draft -> create -> send -> pay -> track)
 * runs end-to-end with ZERO credentials, so judges can run the demo before
 * a PayPal developer app exists. It implements the exact same interface as
 * the real client in paypal.js; the server picks the real client when
 * PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are set, the simulator otherwise.
 *
 * It models the real lifecycle: DRAFT -> SENT -> (UNPAID) -> PAID, and
 * invoice numbers / ids shaped like PayPal's (INV2-XXXX-XXXX-XXXX).
 */

let counter = 1000;

function fakeId() {
  counter += 1;
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV2-${seg()}-${seg()}-${String(counter).padStart(4, '0')}`;
}

export class PayPalSimulator {
  constructor() {
    this.mode = 'simulator';
    this.invoices = new Map();
  }

  async createInvoice(draft) {
    const id = fakeId();
    const total = draft.items.reduce((s, i) => s + i.quantity * i.unitAmount, 0);
    const invoice = {
      id,
      status: 'DRAFT',
      detail: {
        invoice_number: `IP-${counter}`,
        invoice_date: new Date().toISOString().slice(0, 10),
        payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: draft.dueDate },
        currency_code: draft.currency || 'USD',
        note: draft.note || '',
        memo: 'Created by InvoicePilot (PayPal simulator)',
      },
      invoicer: { name: { given_name: 'InvoicePilot', surname: 'Demo' }, email_address: 'seller@invoicepilot.example' },
      primary_recipients: [
        { billing_info: { name: { given_name: draft.clientName || 'Client' }, email_address: draft.clientEmail || 'client@example.com' } },
      ],
      items: draft.items.map((i) => ({
        name: i.name,
        quantity: String(i.quantity),
        unit_amount: { currency_code: draft.currency || 'USD', value: i.unitAmount.toFixed(2) },
        unit_of_measure: i.unit === 'HOURS' ? 'HOURS' : 'AMOUNT',
      })),
      amount: { currency_code: draft.currency || 'USD', value: total.toFixed(2) },
      links: [{ href: `https://www.sandbox.paypal.com/invoice/payerView/details/${id}`, rel: 'payer-view', method: 'GET' }],
    };
    this.invoices.set(id, invoice);
    return invoice;
  }

  async sendInvoice(id) {
    const inv = this.#get(id);
    if (inv.status !== 'DRAFT') throw new Error(`Cannot send invoice in status ${inv.status}`);
    inv.status = 'UNPAID';
    inv.sentAt = new Date().toISOString();
    return inv;
  }

  /** Simulates the client paying from the payer-view link. */
  async recordPayment(id) {
    const inv = this.#get(id);
    if (inv.status !== 'UNPAID') throw new Error(`Cannot pay invoice in status ${inv.status}`);
    inv.status = 'PAID';
    inv.payments = {
      amount: inv.amount,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'PAYPAL',
      payment_id: `SIMPAY-${counter}`,
    };
    return inv;
  }

  async getInvoice(id) {
    return this.#get(id);
  }

  async listInvoices() {
    return [...this.invoices.values()];
  }

  #get(id) {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`Invoice ${id} not found`);
    return inv;
  }
}
