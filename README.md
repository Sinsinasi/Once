# Once — *fill it once, it speaks for you forever*

*Beyond the Form ETH HACKATON FIRST PLACE*

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
├─ demo-forms/       Real IRS forms (prepared) + generated forms + a sample web form
│  ├─ prepared/…                          ← REAL IRS 1040/8822/1041/56/4868, labelled + fillable
│  ├─ irs/…                               ← the raw IRS downloads
│  ├─ ss4-ein.pdf, f1040-individual.pdf   ← generated, share name/address/SSN (smooth fallback)
│  ├─ sample-web-form.html                ← for the live in-page autofill demo
│  ├─ prepare-forms.js                    ← recover field labels by position → tooltips
│  └─ make-demo-forms.js                  ← regenerate the generated forms
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
cp .env.example .env      # then paste your Beyond-the-Form team key into .env
npm install
node server.js            # http://localhost:8787
```
The key uses the hackathon proxy (`OPENAI_BASE_URL=https://20.223.175.10.nip.io/v1`,
model `gpt-5.4-mini`) — both already set in `.env.example`.

**2 — extension**
1. Open `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Click the Once icon. The dot top-right is green when the backend is reachable.

**3 — demo (real IRS forms)**
1. In the popup → **Load demo persona (Amara)** (fictional — house rules ban real data).
2. **Drop `demo-forms/prepared/f1040.pdf`** (a real IRS 1040) → the identity block fills
   with traffic lights; the SSN is forced **red**. Tap **?** on a field for a plain-language
   explanation. **Approve & download** the filled PDF.
3. **Drop `demo-forms/prepared/f8822.pdf`** (real IRS Change-of-Address) → name and
   address fill with **zero new input** — the vault reused itself across two real forms.
4. Open `demo-forms/sample-web-form.html` → **Fill the form on this page** → live
   in-page autofill with the same confidence colours.

> Smoothest fallback path (tiny forms, instant fill): the generated
> `demo-forms/ss4-ein.pdf` → `f1040-individual.pdf`, which share name/address/SSN.
> Other prepared real forms available: `f1041.pdf`, `f56.pdf`, `f4868.pdf`.

## Scope, honestly

Built as a live prototype: the **data vault**, the **semantic fill engine on real IRS
form fields**, the **traffic-light confidence layer**, the **tap-to-understand
explainer**, and the **human approval step**.

Real IRS PDFs carry no readable field labels (`topmostSubform[0].Page1[0].f1_1[0]`), so
`demo-forms/prepare-forms.js` recovers a human caption for each field **by position**
(reading page text with pdf.js and pairing it to each field box) and bakes it into the
field tooltip — the "CommonForms-prepared AcroForm" step, done for real. The engine then
reasons over those captions: it maps Italian labels, `Line 2a`, and "Decedent's TIN"
correctly, and refuses to guess sensitive values. Open-ended **"voice"** answers
(motivation letters, "describe your relationship to the applicant") are the roadmap.
