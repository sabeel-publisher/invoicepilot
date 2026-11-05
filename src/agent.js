/**
 * Agent behaviours on top of the payment gateway:
 *  - status summary for the dashboard
 *  - overdue detection
 *  - AI-drafted, polite follow-up reminders (deterministic templates with
 *    tone escalation; an LLM can be dropped in behind the same function).
 */

export function summariseInvoices(invoices, now = new Date()) {
  const summary = { total: invoices.length, draft: 0, unpaid: 0, paid: 0, overdue: 0, outstandingValue: 0, paidValue: 0 };
  for (const inv of invoices) {
    const value = Number(inv.amount?.value || 0);
    if (inv.status === 'DRAFT') summary.draft += 1;
    else if (inv.status === 'PAID') { summary.paid += 1; summary.paidValue += value; }
    else if (inv.status === 'UNPAID' || inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID') {
      summary.unpaid += 1;
      summary.outstandingValue += value;
      const due = inv.detail?.payment_term?.due_date;
      if (due && new Date(due) < now) summary.overdue += 1;
    }
  }
  summary.outstandingValue = Math.round(summary.outstandingValue * 100) / 100;
  summary.paidValue = Math.round(summary.paidValue * 100) / 100;
  return summary;
}

export function isOverdue(invoice, now = new Date()) {
  if (!['UNPAID', 'SENT', 'PARTIALLY_PAID'].includes(invoice.status)) return false;
  const due = invoice.detail?.payment_term?.due_date;
  return due ? new Date(due) < now : false;
}

/** Drafts a follow-up email for an unpaid invoice; tone escalates with age. */
export function draftFollowUp(invoice, now = new Date()) {
  const client = invoice.primary_recipients?.[0]?.billing_info?.name?.given_name || 'there';
  const amount = invoice.amount ? `${invoice.amount.currency_code} ${invoice.amount.value}` : '';
  const number = invoice.detail?.invoice_number || invoice.id;
  const due = invoice.detail?.payment_term?.due_date || '';
  const daysOverdue = due ? Math.max(0, Math.floor((now - new Date(due)) / 86400000)) : 0;

  let subject, body;
  if (daysOverdue <= 0) {
    subject = `Friendly reminder: invoice ${number} due ${due}`;
    body = `Hi ${client},\n\nJust a friendly heads-up that invoice ${number} for ${amount} is due on ${due}. You can pay it here: ${payerLink(invoice)}\n\nThanks so much!`;
  } else if (daysOverdue <= 7) {
    subject = `Invoice ${number} is ${daysOverdue} day(s) overdue`;
    body = `Hi ${client},\n\nHope you're well — invoice ${number} for ${amount} was due on ${due} and is now ${daysOverdue} day(s) overdue. If it slipped through, you can settle it in one click: ${payerLink(invoice)}\n\nIf you've already paid, please ignore this. Thank you!`;
  } else {
    subject = `Second notice: invoice ${number} overdue by ${daysOverdue} days`;
    body = `Hi ${client},\n\nThis is a second notice that invoice ${number} for ${amount} (due ${due}) remains unpaid, now ${daysOverdue} days overdue. Please arrange payment here: ${payerLink(invoice)}\n\nIf there's an issue with the invoice, reply to this email and we'll sort it out right away.`;
  }
  return { subject, body, daysOverdue };
}

export function payerLink(invoice) {
  const link = (invoice.links || []).find((l) => l.rel === 'payer-view');
  return link ? link.href : `https://www.paypal.com/invoice/payerView/details/${invoice.id}`;
}
