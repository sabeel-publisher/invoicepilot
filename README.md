# 🧾 InvoicePilot — the AI invoicing agent for freelancers

**Built for the PayPal AI Hackathon (Devpost).** Freelancers lose hours to
invoicing admin and weeks to late payments. InvoicePilot replaces the whole
chase with one sentence:

> *"Logo design for Maria's bakery, $450, due Friday"*

The agent turns that sentence into a structured invoice, creates and sends a
**real PayPal invoice**, tracks its status on a dashboard, and drafts
polite, escalating follow-up emails when a client goes quiet — agent-to-human
commerce, end to end.

## How it uses PayPal + AI

- **PayPal Invoicing API v2** (`src/paypal.js`): OAuth2 client-credentials
  flow, create invoice → send invoice → payer-view link. Uses the free
  PayPal **Sandbox** when `PAYPAL_CLIENT_ID/SECRET` are configured.
- **AI drafting** (`src/ai.js`): natural-language → structured invoice draft.
  Uses an OpenAI-compatible model when `OPENAI_API_KEY` is set; otherwise a
  built-in deterministic parser handles flat-fee and hourly phrasings, so the
  demo runs with **zero API keys**.
- **Agent follow-ups** (`src/agent.js`): overdue detection + tone-escalating
  reminder drafts (friendly → first notice → second notice).
- **Zero-credential demo mode**: with no PayPal credentials, a faithful
  in-memory simulator of the Invoicing API (`src/paypalSimulator.js`) runs
  the identical flow — DRAFT → UNPAID → PAID — so anyone can try it instantly.

## Run it

```bash
npm test          # 5 tests: parser, lifecycle, agent summaries
npm start         # http://localhost:3000
```

To go live against the PayPal Sandbox: create a free app at
<https://developer.paypal.com>, copy `.env.example` to `.env`, fill in the
client id/secret, restart. Nothing else changes.

## Layout

| File | Role |
|---|---|
| `src/ai.js` | NL → invoice draft (LLM or built-in parser) |
| `src/paypal.js` | Real PayPal REST client + gateway factory |
| `src/paypalSimulator.js` | Offline simulator, same interface |
| `src/agent.js` | Summaries, overdue logic, follow-up drafting |
| `src/server.js` | HTTP API + serves the UI |
| `public/index.html` | One-page product UI |

## License

MIT — see `LICENSE`.
