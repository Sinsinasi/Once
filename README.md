# Once — *fill it once, it speaks for you forever*

A browser extension with a memory, built for **Beyond the Form** (ETH Zürich, Challenge 1).

You tell Once your facts **once**, in plain language. From then on it reads any form,
understands what each field is *really* asking — not by matching labels, but by
reasoning — and fills it. **You review instead of type.** Every field carries a quiet
traffic-light colour so you can read Once's confidence at a glance, and nothing is
ever final without you.

> This repo is the working prototype: a real, installable Chrome extension + a local
> reasoning backend. It fills **PDF AcroForms** end-to-end (drop → understand → review
> → download) and **live HTML forms** on any web page.

---

## What's inside

```
ultifiller/
├─ extension/        Chrome MV3 extension (vanilla JS, no build step)
│  ├─ manifest.json
│  ├─ popup.html / popup.css / popup.js   ← the whole UX
│  └─ lib/pdf-lib.min.js                  ← bundled (CSP blocks CDNs at runtime)
├─ server/           Local Node/Express backend — holds the OpenAI key, does the reasoning
│  ├─ server.js      /api/intake · /api/map · /api/explain  (+ a keyword fallback)
│  └─ .env           OPENAI_API_KEY=…   (gitignored, never committed)
├─ demo-forms/       Generated overlapping AcroForms + real IRS PDFs + a sample web form
│  ├─ ss4-ein.pdf, f1040-individual.pdf   ← primary demo (share name/address/SSN)
│  ├─ sample-web-form.html                ← for the live in-page autofill demo
│  ├─ irs/…                               ← real IRS SS-4/1040/1041/… (fillable AcroForms)
│  └─ make-demo-forms.js                  ← regenerate the demo forms
└─ README.md
```

## The engine: understanding, not matching

`POST /api/map` receives the vault + a list of raw form fields (labels can be legal
jargon, a line number like `Line 25a`, or another language) and returns, per field,
a **value**, a **confidence** (`green` / `amber` / `red`), a plain-language **source**,
and a **sensitive** flag. The hard safety rule is enforced server-side: **sensitive or
high-consequence fields (SSN, EIN, bank, income, signatures…) are always gated to red
("you decide"), no matter how confident the model is.** Once never invents facts.

If the OpenAI call ever fails (bad key, no network, a slow call on stage), the backend
transparently falls back to a deterministic keyword mapper so the demo never dies —
tagged `fallback: true` in the response.

## Run it

**1 — backend**
```bash
cd server
cp .env.example .env      # then put your real OpenAI key in .env
npm install
node server.js            # http://localhost:8787
```

**2 — extension**
1. Open `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Click the Once icon.

**3 — demo**
1. In the popup → **Load demo persona (Amara)** (a fictional persona — house rules ban real data).
2. **Drop `demo-forms/ss4-ein.pdf`** → fields fill with traffic lights; SSN is forced
   red. Tap **?** on any field for a plain-language explanation. **Approve & download**.
3. **Drop `demo-forms/f1040-individual.pdf`** → the shared fields (name, address, SSN)
   fill with **zero new input** — the vault reused itself.
4. Open `demo-forms/sample-web-form.html` → **Fill the form on this page** → live
   in-page autofill with the same confidence colours.

## Scope, honestly

Built as a live prototype: the **data vault**, the **semantic fill engine on real
form fields**, the **traffic-light confidence layer**, the **tap-to-understand
explainer**, and the **human approval step**. Real IRS PDFs fill mechanically, but
their fields carry no readable labels (`f1_1[0]`) — attaching semantic labels by
position (à la CommonForms) and the open-ended "voice" answers are the roadmap.

## Security notes
- The OpenAI key lives only in `server/.env` (gitignored) and never ships in the extension.
- All demo data is fictional. Nothing is submitted without explicit human approval.
