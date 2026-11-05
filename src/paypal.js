/**
 * Real PayPal REST client (Invoicing API v2) — used automatically when
 * PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set (free PayPal developer
 * sandbox app). Same interface as PayPalSimulator so the agent logic,
 * routes and tests are identical in both modes.
 *
 * Docs: https://developer.paypal.com/docs/api/invoicing/v2/
 */

import { PayPalSimulator } from './paypalSimulator.js';

export class PayPalClient {
  constructor({ clientId, clientSecret, baseUrl, fetchImpl = fetch }) {
    this.mode = 'paypal-sandbox';
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = (baseUrl || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '');
    this.fetch = fetchImpl;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async #accessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const res = await this.fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) throw new Error(`PayPal OAuth failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    this.token = data.access_token;
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
    return this.token;
  }

  async #call(path, method, body) {
    const token = await this.#accessToken();
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`PayPal ${method} ${path} failed: ${res.status} ${await res.text()}`);
    return res.status === 204 ? {} : res.json();
  }

  async createInvoice(draft) {
    const payload = {
      detail: {
        invoice_date: new Date().toISOString().slice(0, 10),
        currency_code: draft.currency || 'USD',
        payment_term: { term_type: 'DUE_ON_DATE_SPECIFIED', due_date: draft.dueDate },
        note: draft.note || '',
      },
      invoicer: { name: { given_name: 'InvoicePilot', surname: 'Seller' } },
      primary_recipients: [
        {
          billing_info: {
            name: { given_name: draft.clientName || 'Client' },
            email_address: draft.clientEmail || 'client@example.com',
          },
        },
      ],
      items: draft.items.map((i) => ({
        name: i.name,
        quantity: String(i.quantity),
        unit_amount: { currency_code: draft.currency || 'USD', value: i.unitAmount.toFixed(2) },
        unit_of_measure: i.unit === 'HOURS' ? 'HOURS' : 'AMOUNT',
      })),
      configuration: { partial_payment_allowed: false, send_to_recipient: false },
    };
    const created = await this.#call('/v2/invoicing/invoices', 'POST', payload);
    return this.getInvoice(created.id);
  }

  async sendInvoice(id) {
    await this.#call(`/v2/invoicing/invoices/${id}/send`, 'POST', { send_to_recipient: true });
    return this.getInvoice(id);
  }

  /** Real payments arrive via the payer link / webhooks; there is no
   *  "record payment" API for the seller, so this is intentionally explicit. */
  async recordPayment() {
    throw new Error('In live PayPal mode, payments are recorded by PayPal when the client pays the invoice link (webhook: INVOICING.INVOICE.PAID).');
  }

  async getInvoice(id) {
    return this.#call(`/v2/invoicing/invoices/${id}`, 'GET');
  }

  async listInvoices() {
    const data = await this.#call('/v2/invoicing/invoices?page=1&page_size=20&total_required=true', 'GET');
    return data.items || [];
  }
}

export function createPayPalGateway(env = process.env) {
  if (env.PAYPAL_CLIENT_ID && env.PAYPAL_CLIENT_SECRET) {
    return new PayPalClient({
      clientId: env.PAYPAL_CLIENT_ID,
      clientSecret: env.PAYPAL_CLIENT_SECRET,
      baseUrl: env.PAYPAL_BASE_URL,
    });
  }
  return new PayPalSimulator();
}
