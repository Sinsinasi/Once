// Generates two overlapping, guaranteed-fillable AcroForm PDFs so the Once demo is
// reliable even without real IRS PDFs (many of which are XFA and won't fill).
// The two forms deliberately SHARE fields (name, address, SSN) so the reuse "wow"
// lands: fill form 1, then form 2 fills itself with zero new input.
//
//   node make-demo-forms.js   ->   ss4-ein.pdf  and  f1040-individual.pdf
//
// Uses pdf-lib from ../extension/lib via a tiny import shim.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function buildForm({ title, subtitle, fields, file }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const form = pdf.getForm();

  page.drawText(title, { x: 50, y: 740, size: 18, font: bold });
  page.drawText(subtitle, { x: 50, y: 722, size: 10, font, color: rgb(0.4, 0.4, 0.4) });

  let y = 685;
  for (const f of fields) {
    page.drawText(f.label, { x: 50, y: y + 4, size: 9, font, color: rgb(0.15, 0.15, 0.15) });
    const tf = form.createTextField(f.name);
    tf.setText("");
    tf.addToPage(page, { x: 250, y, width: 300, height: 16, borderWidth: 1, borderColor: rgb(0.7, 0.7, 0.7) });
    y -= 34;
  }

  const bytes = await pdf.save();
  await writeFile(join(__dirname, file), bytes);
  console.log("wrote", file, `(${fields.length} fields)`);
}

// SS-4-style: Application for Employer Identification Number
await buildForm({
  title: "Form SS-4  —  Application for Employer Identification Number",
  subtitle: "Fictional demo form for the Once prototype. Do not file.",
  file: "ss4-ein.pdf",
  fields: [
    { name: "applicant_full_name", label: "1  Legal name of applicant" },
    { name: "trade_name", label: "2  Trade name of business (if different)" },
    { name: "mailing_street", label: "4a  Mailing address (street)" },
    { name: "mailing_city", label: "4b  City" },
    { name: "mailing_state", label: "4b  State" },
    { name: "mailing_zip", label: "4b  ZIP code" },
    { name: "responsible_party_name", label: "7a  Name of responsible party" },
    { name: "responsible_party_ssn", label: "7b  SSN, ITIN, or EIN of responsible party" },
    { name: "entity_type", label: "8a  Type of entity" },
    { name: "reason_applying", label: "10  Reason for applying" },
  ],
});

// 1040-style: U.S. Individual Income Tax Return
await buildForm({
  title: "Form 1040  —  U.S. Individual Income Tax Return",
  subtitle: "Fictional demo form for the Once prototype. Do not file.",
  file: "f1040-individual.pdf",
  fields: [
    { name: "first_name_mi", label: "First name and middle initial" },
    { name: "last_name", label: "Last name" },
    { name: "taxpayer_ssn", label: "Your social security number" },
    { name: "spouse_first_name", label: "Spouse's first name" },
    { name: "spouse_last_name", label: "Spouse's last name" },
    { name: "home_address", label: "Home address (number and street)" },
    { name: "city_town", label: "City, town, or post office" },
    { name: "state_field", label: "State" },
    { name: "zip_field", label: "ZIP code" },
    { name: "filing_status", label: "Filing status (single, married filing jointly, ...)" },
    { name: "occupation", label: "Your occupation" },
    { name: "line_25a", label: "Line 25a  Federal income tax withheld" },
  ],
});

console.log("done.");
