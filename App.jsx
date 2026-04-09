import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzaTsXjnvL43lVZRXjsMJcoj9sXpDWoxo68rJ0k80bO5FPDKYPODeMsi0Z-wkhvgQlM/exec";

const DESIRED_FIELDS = [
  { key: "owner_name", label: "Owner Name" },
  { key: "property_address", label: "Property Address" },
  { key: "city", label: "City" },
  { key: "zip", label: "ZIP" },
  { key: "parcel_id", label: "Parcel ID" },
  { key: "phone", label: "Phone" },
  { key: "mailing_address", label: "Mailing Address" },
  { key: "assessed_value", label: "Assessed Value" },
  { key: "tax_status", label: "Tax Status" },
  { key: "strategy", label: "Strategy" },
];

const AUTO_MAP = {
  owner_name: ["owner", "name", "owner name", "grantor", "taxpayer"],
  property_address: ["property address", "prop addr", "address", "situs"],
  city: ["city", "municipality", "city name"],
  zip: ["zip", "zipcode", "zip code", "postal"],
  parcel_id: ["parcel", "parcel id", "parcel number", "pin", "account"],
  phone: ["phone", "telephone", "cell", "mobile", "contact phone"],
  mailing_address: ["mailing", "mailing address", "mail addr", "owner address"],
  assessed_value: ["assessed", "value", "assessed value", "av", "state equalized"],
  tax_status: ["status", "tax status", "delinquent", "tax"],
  strategy: ["strategy", "tier", "recommendation", "type"],
};

function guessMapping(headers) {
  const mapping = {};
  DESIRED_FIELDS.forEach(({ key }) => {
    const keywords = AUTO_MAP[key] || [];
    const match = headers.find((h) =>
      keywords.some((k) => h.toLowerCase().includes(k))
    );
    mapping[key] = match || "";
  });
  return mapping;
}

function normalizePhone(val) {
  return String(val ?? "").replace(/\D/g, "");
}

function runDedup(rows, mapping) {
  const phoneCol = mapping["phone"];
  const seen = new Map();
  const unique = [];
  const dupes = [];
  rows.forEach((row, idx) => {
    const raw = phoneCol ? row[phoneCol] : "";
    const phone = normalizePhone(raw);
    if (!phone) { unique.push({ ...row, _rowIndex: idx }); return; }
    if (seen.has(phone)) {
      dupes.push({ ...row, _rowIndex: idx, _dupeOf: seen.get(phone) });
    } else {
      seen.set(phone, idx + 1);
      unique.push({ ...row, _rowIndex: idx });
    }
  });
  return { unique, dupes };
}

function toCSV(rows, mapping) {
  const headers = DESIRED_FIELDS.map((f) => f.label);
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    const vals = DESIRED_FIELDS.map(({ key }) => {
      const col = mapping[key];
      const val = col ? (row[col] ?? "") : "";
      const s = String(val).replace(/"/g, '""');
      return s.includes(",") || s.includes('"') ? `"${s}"` : s;
    });
    lines.push(vals.join(","));
  });
  return lines.join("\n");
}

function buildSheetRows(rows, mapping) {
  return rows.map((row) =>
    DESIRED_FIELDS.map(({ key }) => {
      const col = mapping[key];
      return col ? String(row[col] ?? "") : "";
    })
  );
}

const STAGE_INDEX = { upload: 0, map: 1, preview: 2, export: 3, done: 4 };
const STEP_LABELS = ["Upload", "Map columns", "Preview & dedup", "Export", "Done"];

export default function App() {
  const [stage, setStage] = useState("upload");
  const [rawHeaders, setRawHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [mapping, setMapping] = useState({});
  const [fileName, setFileName] = useState("");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [dedupResult, setDedupResult] = useState(null);
  const [showDupes, setShowDupes] = useState(false);
  const [pushMode, setPushMode] = useState("append");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [pushError, setPushError] = useState("");
  const fileInputRef = useRef();

  const processFile = useCallback((file) => {
    setError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!json.length) { setError("No data found in file."); return; }
        const headers = Object.keys(json[0]);
        setRawHeaders(headers);
        setRawRows(json);
        setMapping(guessMapping(headers));
        setDedupResult(null);
        setStage("map");
      } catch {
        setError("Could not read file. Please upload a valid .xlsx or .csv.");
      }
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const goToPreview = () => {
    const result = runDedup(rawRows, mapping);
    setDedupResult(result);
    setShowDupes(false);
    setStage("preview");
  };

  const downloadCSV = (rows) => {
    const csv = toCSV(rows, mapping);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "canopy_contacts.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const pushToSheets = async () => {
    setPushing(true);
    setPushError("");
    setPushResult(null);
    try {
      const rows = buildSheetRows(dedupResult.unique, mapping);
      const headers = DESIRED_FIELDS.map((f) => f.label);
      const body = JSON.stringify({ headers, rows, mode: pushMode });
      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body,
        headers: { "Content-Type": "text/plain" },
      });
      const json = await res.json();
      if (json.success) {
        setPushResult(json.added);
        setStage("done");
      } else {
        setPushError("Google Sheets returned an error. Check your Apps Script deployment.");
      }
    } catch {
      setPushError(
        "Could not reach Google Sheets. Make sure your Apps Script is deployed and 'Who has access' is set to Anyone."
      );
    } finally {
      setPushing(false);
    }
  };

  const reset = () => {
    setStage("upload"); setRawHeaders([]); setRawRows([]); setMapping({});
    setFileName(""); setError(""); setDedupResult(null); setPushResult(null); setPushError("");
  };

  const uniqueRows = dedupResult?.unique ?? [];
  const dupeRows = dedupResult?.dupes ?? [];
  const stageIdx = STAGE_INDEX[stage] ?? 0;

  const s = {
    card: { background: "var(--color-background-primary)", borderRadius: "var(--border-radius-lg)", border: "0.5px solid var(--color-border-tertiary)", padding: "1rem 1.25rem" },
    label: { fontSize: 12, color: "var(--color-text-secondary)", display: "block", marginBottom: 3 },
    muted: { fontSize: 13, color: "var(--color-text-secondary)" },
  };

  return (
    <div style={{ fontFamily: "var(--font-sans)", color: "var(--color-text-primary)" }}>
      <h2 className="sr-only">Canopy Capital Contact Upload Tool</h2>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem" }}>
        <div style={{ width: 40, height: 40, borderRadius: "var(--border-radius-md)", background: "var(--color-background-info)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-info)" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <p style={{ margin: 0, fontWeight: 500, fontSize: 16 }}>Canopy Capital — Contact Upload Tool</p>
          <p style={{ margin: 0, ...s.muted }}>Upload, deduplicate by phone, and push Wayne County leads to Google Sheets</p>
        </div>
        {stage !== "upload" && (
          <button onClick={reset} style={{ fontSize: 13 }}>Start over</button>
        )}
      </div>

      {/* Step tracker */}
      <div style={{ display: "flex", gap: 8, marginBottom: "2rem", flexWrap: "wrap" }}>
        {STEP_LABELS.map((label, i) => {
          const active = i === stageIdx;
          const done = i < stageIdx;
          return (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{
                width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 500,
                background: done ? "var(--color-background-success)" : active ? "var(--color-background-info)" : "var(--color-background-secondary)",
                color: done ? "var(--color-text-success)" : active ? "var(--color-text-info)" : "var(--color-text-tertiary)",
                border: `0.5px solid ${done ? "var(--color-border-success)" : active ? "var(--color-border-info)" : "var(--color-border-tertiary)"}`,
              }}>
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 13, fontWeight: active ? 500 : 400, color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>{label}</span>
              {i < STEP_LABELS.length - 1 && <span style={{ color: "var(--color-text-tertiary)", fontSize: 13 }}>›</span>}
            </div>
          );
        })}
      </div>

      {/* ── STAGE: Upload ── */}
      {stage === "upload" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current.click()}
          style={{
            border: `2px dashed ${dragging ? "var(--color-border-info)" : "var(--color-border-secondary)"}`,
            borderRadius: "var(--border-radius-lg)",
            padding: "4rem 2rem",
            textAlign: "center",
            cursor: "pointer",
            background: dragging ? "var(--color-background-info)" : "var(--color-background-secondary)",
            transition: "background 0.15s",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-secondary)" strokeWidth="1.5" style={{ marginBottom: 14 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p style={{ fontWeight: 500, fontSize: 16, marginBottom: 6 }}>Drop your file here, or click to browse</p>
          <p style={{ ...s.muted, margin: 0 }}>.xlsx or .csv — Wayne County tax list, lead export, etc.</p>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.xls" style={{ display: "none" }} onChange={(e) => e.target.files[0] && processFile(e.target.files[0])} />
        </div>
      )}
      {error && <p style={{ color: "var(--color-text-danger)", fontSize: 13, marginTop: 10 }}>{error}</p>}

      {/* ── STAGE: Map ── */}
      {stage === "map" && (
        <div>
          <div style={{ background: "var(--color-background-success)", borderRadius: "var(--border-radius-md)", padding: "10px 14px", marginBottom: "1.25rem", display: "flex", gap: 10, alignItems: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 13 }}>
              <strong>{fileName}</strong> — {rawRows.length.toLocaleString()} rows, {rawHeaders.length} columns detected
            </span>
          </div>
          <p style={{ ...s.muted, marginBottom: "1.25rem" }}>
            Auto-mapped {DESIRED_FIELDS.filter(({ key }) => mapping[key]).length} of {DESIRED_FIELDS.length} fields. Adjust any that look off. The <strong>Phone</strong> field is used for deduplication.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", marginBottom: "1.75rem" }}>
            {DESIRED_FIELDS.map(({ key, label }) => (
              <div key={key}>
                <label style={s.label}>
                  {label}{key === "phone" ? " ★ dedup key" : ""}
                </label>
                <select
                  value={mapping[key] || ""}
                  onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))}
                  style={{ width: "100%" }}
                >
                  <option value="">— skip —</option>
                  {rawHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button onClick={goToPreview} style={{ fontSize: 14 }}>Run deduplication & preview ›</button>
        </div>
      )}

      {/* ── STAGE: Preview ── */}
      {stage === "preview" && dedupResult && (
        <div>
          {/* Stat cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: "1.5rem" }}>
            {[
              { label: "Total rows uploaded", val: rawRows.length.toLocaleString(), bg: "var(--color-background-secondary)", color: "var(--color-text-primary)" },
              { label: "Unique contacts", val: uniqueRows.length.toLocaleString(), bg: "var(--color-background-success)", color: "var(--color-text-success)" },
              { label: "Duplicates removed", val: dupeRows.length.toLocaleString(), bg: dupeRows.length > 0 ? "var(--color-background-warning)" : "var(--color-background-secondary)", color: dupeRows.length > 0 ? "var(--color-text-warning)" : "var(--color-text-secondary)" },
            ].map(({ label, val, bg, color }) => (
              <div key={label} style={{ background: bg, borderRadius: "var(--border-radius-md)", padding: "14px 16px" }}>
                <p style={{ ...s.muted, marginBottom: 6, fontSize: 12 }}>{label}</p>
                <p style={{ margin: 0, fontSize: 24, fontWeight: 500, color }}>{val}</p>
              </div>
            ))}
          </div>

          {/* Dupes review */}
          {dupeRows.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <button onClick={() => setShowDupes((v) => !v)} style={{ fontSize: 13 }}>
                {showDupes ? "Hide duplicates" : `Review ${dupeRows.length} duplicate${dupeRows.length !== 1 ? "s" : ""}`}
              </button>
              {showDupes && (
                <div style={{ marginTop: 10, border: "0.5px solid var(--color-border-warning)", borderRadius: "var(--border-radius-md)", padding: "12px 14px" }}>
                  <p style={{ fontSize: 12, color: "var(--color-text-warning)", marginBottom: 10 }}>
                    These rows were removed — their phone number matched an earlier entry and will not be pushed to Sheets.
                  </p>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Owner Name", "Phone", "Property Address"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", color: "var(--color-text-secondary)", fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dupeRows.slice(0, 25).map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--color-background-secondary)" }}>
                            <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mapping.owner_name ? row[mapping.owner_name] : "—"}</td>
                            <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap" }}>{mapping.phone ? row[mapping.phone] : "—"}</td>
                            <td style={{ padding: "6px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mapping.property_address ? row[mapping.property_address] : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {dupeRows.length > 25 && <p style={{ ...s.muted, marginTop: 8, fontSize: 12 }}>...and {dupeRows.length - 25} more not shown</p>}
                </div>
              )}
            </div>
          )}

          {/* Contact preview table */}
          <p style={{ ...s.muted, marginBottom: 8 }}>Showing first 5 of {uniqueRows.length.toLocaleString()} unique contacts</p>
          <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  {DESIRED_FIELDS.filter(({ key }) => mapping[key]).map(({ key, label }) => (
                    <th key={key} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "0.5px solid var(--color-border-secondary)", color: "var(--color-text-secondary)", fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {uniqueRows.slice(0, 5).map((row, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "transparent" : "var(--color-background-secondary)" }}>
                    {DESIRED_FIELDS.filter(({ key }) => mapping[key]).map(({ key }) => (
                      <td key={key} style={{ padding: "8px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>
                        {row[mapping[key]] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setStage("map")} style={{ fontSize: 13 }}>← Back</button>
            <button onClick={() => downloadCSV(uniqueRows)} style={{ fontSize: 13 }}>Download CSV</button>
            <button
              onClick={() => setStage("export")}
              style={{ fontSize: 13, fontWeight: 500, background: "var(--color-background-info)", color: "var(--color-text-info)", borderColor: "var(--color-border-info)" }}
            >
              Push to Google Sheets ›
            </button>
          </div>
        </div>
      )}

      {/* ── STAGE: Export ── */}
      {stage === "export" && dedupResult && (
        <div>
          <p style={{ fontSize: 14, marginBottom: "1.25rem" }}>
            Ready to push <strong>{uniqueRows.length.toLocaleString()} unique contacts</strong> to your Contacts sheet.
            {dupeRows.length > 0 && <span style={{ color: "var(--color-text-warning)" }}> ({dupeRows.length} duplicates excluded.)</span>}
          </p>

          <p style={{ ...s.muted, marginBottom: 10 }}>How should this upload work?</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: "1.75rem" }}>
            {[
              { val: "append", title: "Append new rows", desc: "Add contacts below any existing data in the sheet" },
              { val: "overwrite", title: "Overwrite sheet", desc: "Clear all existing rows, then write fresh data" },
            ].map(({ val, title, desc }) => (
              <div
                key={val}
                onClick={() => setPushMode(val)}
                style={{
                  border: pushMode === val ? "2px solid var(--color-border-info)" : "0.5px solid var(--color-border-tertiary)",
                  borderRadius: "var(--border-radius-lg)",
                  padding: "16px 18px",
                  cursor: "pointer",
                  background: pushMode === val ? "var(--color-background-info)" : "var(--color-background-primary)",
                  transition: "background 0.12s",
                }}
              >
                <p style={{ margin: "0 0 5px", fontWeight: 500, fontSize: 14, color: pushMode === val ? "var(--color-text-info)" : "var(--color-text-primary)" }}>{title}</p>
                <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>{desc}</p>
              </div>
            ))}
          </div>

          {pushError && (
            <div style={{ background: "var(--color-background-danger)", border: "0.5px solid var(--color-border-danger)", borderRadius: "var(--border-radius-md)", padding: "12px 14px", marginBottom: "1rem" }}>
              <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-danger)" }}>{pushError}</p>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setStage("preview")} style={{ fontSize: 13 }}>← Back</button>
            <button
              onClick={pushToSheets}
              disabled={pushing}
              style={{
                fontSize: 13, fontWeight: 500,
                background: pushing ? "var(--color-background-secondary)" : "var(--color-background-success)",
                color: pushing ? "var(--color-text-secondary)" : "var(--color-text-success)",
                borderColor: pushing ? "var(--color-border-tertiary)" : "var(--color-border-success)",
                cursor: pushing ? "not-allowed" : "pointer",
              }}
            >
              {pushing ? "Pushing to Sheets..." : `Confirm — push ${uniqueRows.length.toLocaleString()} contacts`}
            </button>
          </div>
        </div>
      )}

      {/* ── STAGE: Done ── */}
      {stage === "done" && (
        <div style={{ textAlign: "center", padding: "4rem 1rem" }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--color-background-success)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 1rem" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-success)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <p style={{ fontWeight: 500, fontSize: 18, marginBottom: 8 }}>Contacts pushed successfully</p>
          <p style={{ ...s.muted, marginBottom: 6 }}>
            {(pushResult ?? uniqueRows.length).toLocaleString()} rows added to your Contacts sheet
          </p>
          {dupeRows.length > 0 && (
            <p style={{ fontSize: 13, color: "var(--color-text-warning)", marginBottom: "1.75rem" }}>
              {dupeRows.length} duplicate{dupeRows.length !== 1 ? "s" : ""} removed before upload
            </p>
          )}
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: "1.5rem" }}>
            <button onClick={() => downloadCSV(uniqueRows)} style={{ fontSize: 13 }}>Also download CSV</button>
            <button onClick={reset} style={{ fontSize: 13 }}>Upload another file</button>
          </div>
        </div>
      )}
    </div>
  );
}
