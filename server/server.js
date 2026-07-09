import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 8787;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Beyond the Form uses an OpenAI-compatible proxy (handbook §5), not api.openai.com.
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://20.223.175.10.nip.io/v1").replace(/\/$/, "");

if (!OPENAI_API_KEY) {
  console.warn("\n[Once] WARNING: OPENAI_API_KEY is not set in server/.env — /api/* calls will fail.\n");
}

// --- Sensitive-field detection (belt-and-braces, enforced server-side) ---------
// Any field whose label matches these is ALWAYS gated to red ("you decide"),
// regardless of how confident the model is. This is the non-negotiable safety rule.
const SENSITIVE_PATTERNS = [
  /\bssn\b/i, /social security/i, /\bein\b/i, /\btin\b/i, /\bitin\b/i,
  /taxpayer id/i, /identification number/i, /\bavs\b/i, /\bahv\b/i,
  /passport/i, /a-?number/i, /alien number/i, /uscis/i,
  /bank|account number|routing|iban|swift|sort code/i,
  /credit card|card number|cvv|cvc/i,
  /signature/i, /perjury/i, /declaration/i,
  /income|salary|wages|adjusted gross|agi\b/i, /amount|\$/,
];

function isSensitive(label = "", context = "") {
  const hay = `${label} ${context}`;
  return SENSITIVE_PATTERNS.some((re) => re.test(hay));
}

// --- Local fallback ------------------------------------------------------------
// If the OpenAI call fails (bad key, no network, slow), we still fill the form with
// a deterministic keyword mapper so the demo never dies in front of the judges.
// It is intentionally simpler than the real engine and always tagged fallback:true.
const CONCEPT_SYNONYMS = {
  // spouse concepts first so "spouse first name" doesn't get grabbed by first_name
  spouse_first_name: [/spouse'?s? first/i, /spouse'?s? given/i],
  spouse_last_name: [/spouse'?s? last/i, /spouse'?s? (family|sur)name/i],
  spouse_name: [/spouse/i, /husband|wife/i, /coniuge/i],
  first_name: [/first name/i, /given name/i, /\bnome\b/i, /vorname/i, /prénom/i],
  last_name: [/last name/i, /family name/i, /surname/i, /cognome/i, /nachname/i, /nom de famille/i],
  full_name: [/full (legal )?name/i, /^name$/i, /name of (applicant|taxpayer|entity)/i, /legal name/i],
  date_of_birth: [/date of birth/i, /\bdob\b/i, /birth ?date/i, /data di nascita/i, /geburtsdatum/i],
  address_line1: [/street/i, /address/i, /mailing address/i, /indirizzo/i, /adresse/i],
  city: [/city/i, /town/i, /città/i, /stadt/i, /ville/i],
  state: [/\bstate\b/i, /province/i, /canton/i],
  postal_code: [/zip/i, /postal/i, /\bplz\b/i, /\bcap\b/i],
  country: [/country/i, /paese/i, /land/i, /pays/i],
  email: [/e-?mail/i],
  phone: [/phone/i, /telephone/i, /tel\b/i, /telefono/i],
  ssn: [/\bssn\b/i, /social security/i, /\btin\b/i, /taxpayer id/i, /identification number/i],
  employer: [/employer/i, /company/i, /business name/i, /datore/i, /arbeitgeber/i],
  occupation: [/occupation/i, /job title/i, /profession/i, /professione/i],
  marital_status: [/marital status/i, /stato civile/i],
  spouse_name: [/spouse/i, /husband|wife/i, /coniuge/i],
};

function localMap(fields, profile = {}) {
  return fields.map((f) => {
    const label = `${f.label || ""} ${f.context || ""}`;
    const sensitive = isSensitive(f.label, f.context);
    let value = "";
    let source = "";
    for (const [key, patterns] of Object.entries(CONCEPT_SYNONYMS)) {
      if (patterns.some((re) => re.test(label))) {
        if (key === "full_name" && (profile.first_name || profile.last_name)) {
          value = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
        } else if (profile[key] != null && profile[key] !== "") {
          value = String(profile[key]);
        }
        if (value) source = "matched from your vault";
        break;
      }
    }
    let confidence = "red";
    if (value && !sensitive) confidence = "green";
    else if (value && sensitive) confidence = "red";
    return { id: String(f.id), value, confidence, source: source || "not in your vault yet", sensitive };
  });
}

async function callOpenAI(messages, { json = true } = {}) {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      messages,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// --- 1) Intake: freeform story -> structured vault -----------------------------
app.post("/api/intake", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "Missing 'text'." });

    const content = await callOpenAI([
      {
        role: "system",
        content:
          "You extract a structured personal profile ('vault') from what a person tells you in plain language. " +
          "Return ONLY a JSON object with flat, human-readable keys (e.g. first_name, last_name, date_of_birth, " +
          "address_line1, city, state, postal_code, country, email, phone, ssn, marital_status, spouse_name, " +
          "occupation, employer). Only include a key if the person actually stated or clearly implied it. " +
          "Never invent facts. Dates as YYYY-MM-DD when possible. Wrap everything under a top-level key 'profile'.",
      },
      { role: "user", content: text },
    ]);

    const parsed = JSON.parse(content);
    res.json({ profile: parsed.profile ?? parsed });
  } catch (err) {
    console.error("[intake]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 2) Map: reason vault onto form fields (the semantic engine) ----------------
app.post("/api/map", async (req, res) => {
  try {
    const { fields, profile } = req.body || {};
    if (!Array.isArray(fields)) return res.status(400).json({ error: "Missing 'fields' array." });

    let content;
    try {
      content = await callOpenAI([
      {
        role: "system",
        content:
          "You are Once, an engine that fills forms by UNDERSTANDING, not string-matching. " +
          "You receive a user's personal vault (facts they told you) and a list of form fields, each with an id, " +
          "a label (possibly legal jargon, a line number, or a non-English label) and optional context. " +
          "For EACH field, decide the correct value from the vault by reasoning about what the field is really asking. " +
          "Recognise that e.g. 'Contribuente, cognome', 'Last name', 'Family name', 'Decedent's surname' can all map to the same fact. " +
          "Return ONLY JSON: {\"results\":[{\"id\":string,\"value\":string,\"confidence\":\"green\"|\"amber\"|\"red\",\"source\":string,\"sensitive\":boolean}]}. " +
          "confidence meaning: green = the vault directly and unambiguously contains this fact; " +
          "amber = you inferred or reformatted it and the user should glance at it; " +
          "red = you are guessing, the vault lacks it, or it is sensitive/high-consequence. " +
          "If the vault has no value for a field, return value:\"\" and confidence:\"red\". " +
          "'source' is a short human phrase like 'you told me this' or 'inferred from your address'. " +
          "NEVER invent facts the user did not provide.",
      },
        {
          role: "user",
          content: JSON.stringify({ profile: profile || {}, fields }),
        },
      ]);
    } catch (aiErr) {
      console.warn("[map] OpenAI failed, using local fallback:", aiErr.message);
      return res.json({ results: localMap(fields, profile || {}), fallback: true });
    }

    const parsed = JSON.parse(content);
    let results = Array.isArray(parsed.results) ? parsed.results : [];

    // Enforce the hard rule server-side: sensitive fields are always red.
    const byId = new Map(results.map((r) => [String(r.id), r]));
    results = fields.map((f) => {
      const r = byId.get(String(f.id)) || { id: f.id, value: "", confidence: "red", source: "not in your vault yet" };
      const sensitive = isSensitive(f.label, f.context) || r.sensitive === true;
      return {
        id: String(f.id),
        value: r.value ?? "",
        confidence: sensitive ? "red" : (r.confidence || "amber"),
        source: r.source || "",
        sensitive,
      };
    });

    res.json({ results });
  } catch (err) {
    console.error("[map]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 3) Explain: plain-language explainer for a scary field ---------------------
app.post("/api/explain", async (req, res) => {
  try {
    const { fieldLabel, context } = req.body || {};
    if (!fieldLabel) return res.status(400).json({ error: "Missing 'fieldLabel'." });

    let content;
    try {
      content = await callOpenAI([
        {
          role: "system",
          content:
            "A person is filling an official form and does not understand a field. In 2-3 short plain sentences, " +
            "explain: what it means, why the form asks for it, and what's at stake if they get it wrong. " +
            "No jargon, warm and calm. Return JSON: {\"explanation\": string}.",
        },
        { role: "user", content: `Field: "${fieldLabel}". Context: ${context || "none"}` },
      ]);
    } catch (aiErr) {
      console.warn("[explain] OpenAI failed, using local fallback:", aiErr.message);
      return res.json({
        explanation: `"${fieldLabel}" is a field on this form. Once couldn't reach the explainer service right now, so check the form's official instructions for exactly what it wants and why.`,
        fallback: true,
      });
    }
    const parsed = JSON.parse(content);
    res.json({ explanation: parsed.explanation || "" });
  } catch (err) {
    console.error("[explain]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true, model: MODEL, baseUrl: OPENAI_BASE_URL, keyConfigured: !!OPENAI_API_KEY }));

app.listen(PORT, () => {
  console.log(`\n[Once] backend on http://localhost:${PORT}  (model: ${MODEL}, key: ${OPENAI_API_KEY ? "set" : "MISSING"})\n`);
});
