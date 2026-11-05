/**
 * AI layer: turns a plain-English description of freelance work into a
 * structured invoice draft.
 *
 * Two modes:
 *  1. If OPENAI_API_KEY is set, an OpenAI-compatible chat model produces the
 *     draft as JSON (and we validate/normalise it).
 *  2. Otherwise a deterministic heuristic parser handles the common shapes
 *     ("Logo design for Maria's bakery, $450, due Friday", "3 hours of
 *     consulting at $80/hr for Acme", ...). This keeps the demo fully
 *     runnable offline with zero API keys.
 */

const WEEKDAYS = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

function nextWeekday(from, dayIdx) {
  const d = new Date(from);
  let add = (dayIdx - d.getDay() + 7) % 7;
  if (add === 0) add = 7; // "due Friday" said on Friday means next Friday
  d.setDate(d.getDate() + add);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function parseDueDate(text, now) {
  const lower = text.toLowerCase();
  const inDays = lower.match(/in\s+(\d+)\s+days?/);
  if (inDays) {
    const d = new Date(now);
    d.setDate(d.getDate() + Number(inDays[1]));
    return isoDate(d);
  }
  if (/tomorrow/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  }
  if (/next week/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    return isoDate(d);
  }
  for (const [name, idx] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b(due\\s+)?(on\\s+)?${name}\\b`).test(lower)) {
      return isoDate(nextWeekday(now, idx));
    }
  }
  const explicit = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (explicit) return explicit[1];
  // Default: net 7
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  return isoDate(d);
}

function cleanDescription(raw) {
  let s = raw
    .replace(/\$[\d,]+(\.\d{1,2})?/g, ' ')
    .replace(/\b\d+(\.\d+)?\s*(hours?|hrs?)\b/gi, ' ')
    .replace(/\bat\s+\$?[\d.]+\s*\/?\s*(per\s+)?(hour|hr)\b/gi, ' ')
    .replace(/\bdue\b.*$/i, ' ')
    .replace(/\bin\s+\d+\s+days?\b.*$/i, ' ')
    .replace(/\bfor\s+[A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*)*/g, (m) => m) // keep client phrase for extraction below
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s,;:-]+$/g, '');
  return s || 'Freelance services';
}

function extractClient(text) {
  const m = text.match(/\bfor\s+([A-Z][\w&'.-]*(?:\s+(?:[A-Z][\w&'.-]*|&\s*\w+))*)/);
  if (m) return m[1].replace(/['’]s$/, "'s").trim();
  const m2 = text.match(/\bfor\s+([\w&'.-]+(?:\s+[\w&'.-]+){0,2})/);
  return m2 ? m2[1].trim() : null;
}

/**
 * parseInvoiceText(text, now?) -> draft
 * draft = { clientName, items: [{name, quantity, unitAmount, unit}], currency, dueDate, note, confidence }
 */
export function parseInvoiceText(text, now = new Date()) {
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty job description');
  }
  const items = [];

  // Shape A: "N hours of X at $R/hr" / "N hrs X @ $R per hour"
  const hourly = text.match(
    /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s+(?:of\s+)?(.+?)\s+(?:at|@)\s*\$?([\d,]+(?:\.\d{1,2})?)\s*\/?\s*(?:per\s+)?(?:hour|hr)\b/i
  );
  // Shape B: flat amount somewhere: "... $450 ..."
  const flat = text.match(/\$([\d,]+(?:\.\d{1,2})?)/);

  if (hourly) {
    const qty = Number(hourly[1]);
    const rate = Number(hourly[3].replace(/,/g, ''));
    items.push({
      name: hourly[2].trim().replace(/[\s,]+$/, ''),
      quantity: qty,
      unitAmount: rate,
      unit: 'HOURS',
    });
  } else if (flat) {
    const amount = Number(flat[1].replace(/,/g, ''));
    const name = cleanDescription(text).replace(/^for\s+/i, '');
    items.push({ name: name || 'Freelance services', quantity: 1, unitAmount: amount, unit: 'AMOUNT' });
  } else {
    // No money mentioned: draft with a placeholder the user must fill in.
    items.push({ name: cleanDescription(text), quantity: 1, unitAmount: 0, unit: 'AMOUNT' });
  }

  const total = items.reduce((s, i) => s + i.quantity * i.unitAmount, 0);
  return {
    clientName: extractClient(text),
    items,
    currency: 'USD',
    total,
    dueDate: parseDueDate(text, now),
    note: `Invoice drafted by InvoicePilot AI from: "${text.trim()}"`,
    confidence: hourly || flat ? 'high' : 'low',
  };
}

/** Optional LLM path: used only when OPENAI_API_KEY is present. */
export async function parseWithLLM(text, fetchImpl = fetch) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return parseInvoiceText(text);
  const res = await fetchImpl('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Extract an invoice draft as JSON: {clientName, items:[{name, quantity, unitAmount}], currency, dueDate (YYYY-MM-DD)}. Today is ' +
            isoDate(new Date()) +
            '. Default currency USD, default due date 7 days out.',
        },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!res.ok) return parseInvoiceText(text); // graceful fallback
  const data = await res.json();
  const draft = JSON.parse(data.choices[0].message.content);
  draft.items = (draft.items || []).map((i) => ({ unit: 'AMOUNT', ...i }));
  draft.total = draft.items.reduce((s, i) => s + i.quantity * i.unitAmount, 0);
  draft.note = `Invoice drafted by InvoicePilot AI (LLM) from: "${text.trim()}"`;
  draft.confidence = 'high';
  return draft;
}
