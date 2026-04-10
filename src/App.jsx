import { useState, useCallback, useRef } from "react";
import * as XLSX from "xlsx";

// ── Constants ────────────────────────────────────────────────────────────────

const DESIRED_FIELDS = [
  { key: "owner_name",       label: "Owner Name" },
  { key: "property_address", label: "Property Address" },
  { key: "city",             label: "City" },
  { key: "zip",              label: "ZIP" },
  { key: "parcel_id",        label: "Parcel ID" },
  { key: "phone",            label: "Phone" },
  { key: "mailing_address",  label: "Mailing Address" },
  { key: "assessed_value",   label: "Assessed Value" },
  { key: "tax_status",       label: "Tax Status" },
  { key: "strategy",         label: "Strategy" },
];

const AUTO_MAP = {
  owner_name:       ["owner", "name", "owner name", "grantor", "taxpayer"],
  property_address: ["property address", "prop addr", "address", "situs"],
  city:             ["city", "municipality", "city name"],
  zip:              ["zip", "zipcode", "zip code", "postal"],
  parcel_id:        ["parcel", "parcel id", "parcel number", "pin", "account"],
  phone:            ["phone", "telephone", "cell", "mobile", "contact phone"],
  mailing_address:  ["mailing", "mailing address", "mail addr", "owner address"],
  assessed_value:   ["assessed", "value", "assessed value", "av", "state equalized"],
  tax_status:       ["status", "tax status", "delinquent", "tax"],
  strategy:         ["strategy", "tier", "recommendation", "type"],
};

const DEFAULT_TEMPLATE = `Hi {owner_name}, my name is William with Canopy Capital Group. I came across your property at {property_address} and wanted to reach out personally. If you've ever considered selling, we buy homes directly — no agents, no fees, no repairs needed. We'd love to make you a fair cash offer on your timeline. Feel free to call or text me back anytime. God bless.`;

const STEPS = ["Upload", "Map Fields", "Message", "Review", "Send", "Done"];
const STAGE_INDEX = { upload: 0, map: 1, message: 2, preview: 3, send: 4, done: 5 };

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  const digits = String(val ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

function runDedup(rows, mapping) {
  const phoneCol = mapping["phone"];
  const seen = new Map();
  const unique = [], dupes = [], noPhone = [];
  rows.forEach((row, idx) => {
    const raw = phoneCol ? row[phoneCol] : "";
    const phone = normalizePhone(raw);
    if (!phone) { noPhone.push({ ...row, _rowIndex: idx }); return; }
    if (seen.has(phone)) {
      dupes.push({ ...row, _rowIndex: idx, _phone: phone });
    } else {
      seen.set(phone, idx + 1);
      unique.push({ ...row, _rowIndex: idx, _phone: phone });
    }
  });
  return { unique, dupes, noPhone };
}

function applyTemplate(template, row, mapping) {
  let msg = template;
  DESIRED_FIELDS.forEach(({ key, label }) => {
    const col = mapping[key];
    const val = col ? String(row[col] ?? "").trim() : "";
    msg = msg.replace(new RegExp(`\\{${key}\\}`, "g"), val || `[${label}]`);
  });
  return msg.trim();
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

// ── Design tokens ────────────────────────────────────────────────────────────

const C = {
  g900: "#1a2e1a", g800: "#1f3d1f", g700: "#2a5228",
  g600: "#346332", g500: "#3e7a3b", g200: "#c2d9be",
  g100: "#e0ede0", g50: "#f2f8f2",
  gold: "#c9a84c", gold4: "#d4b568", gold3: "#dfc27e",
  gold1: "#f5edda", gold0: "#faf6ed",
  white: "#ffffff", cream: "#fdfcf8",
  border: "rgba(26,46,26,0.12)", borderS: "rgba(26,46,26,0.22)",
  red50: "#fdf0f0", red200: "#f0b8b8", red700: "#8b2020",
};
const F = { d: "'Playfair Display', Georgia, serif", b: "'DM Sans', system-ui, sans-serif" };

// ── Shared UI components ─────────────────────────────────────────────────────

const LeafIcon = ({ size = 20, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/>
    <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>
  </svg>
);

const CheckIcon = ({ size = 16, color = "#fff" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const UploadIcon = () => (
  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke={C.g700} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const MsgIcon = () => (
  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke={C.g700} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const SpinnerIcon = () => (
  <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
  </svg>
);

function Btn({ children, onClick, variant = "primary", disabled, style = {} }) {
  const base = { fontFamily: F.b, fontSize: 13, fontWeight: 400, padding: "9px 18px", borderRadius: 7, transition: "all 0.15s", display: "inline-flex", alignItems: "center", gap: 6 };
  const variants = {
    primary:   { background: C.g800,  color: "#fff",   border: "none",                fontWeight: 500 },
    secondary: { background: "transparent", color: C.g800, border: `1px solid ${C.borderS}` },
    outline:   { background: "transparent", color: C.g700, border: `1px solid ${C.g500}` },
    gold:      { background: "transparent", color: "#8a6a1a", border: `1px solid ${C.gold3}` },
    danger:    { background: "#8b2020", color: "#fff",   border: "none" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
}

function StatCard({ label, value, accent }) {
  const t = accent === "green" ? { bg: C.g100,  val: C.g700,    border: C.g200  }
          : accent === "gold"  ? { bg: C.gold0, val: "#8a6a1a", border: C.gold3 }
          : accent === "red"   ? { bg: C.red50, val: C.red700,  border: C.red200 }
          : { bg: C.g50, val: C.g800, border: C.border };
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 10, padding: "14px 16px" }}>
      <p style={{ fontSize: 10, color: C.g600, fontWeight: 500, marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: F.b }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 600, fontFamily: F.d, color: t.val, margin: 0 }}>{value}</p>
    </div>
  );
}

function StepTracker({ stage }) {
  const idx = STAGE_INDEX[stage] ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 32 }}>
      {STEPS.map((label, i) => {
        const done = i < idx, active = i === idx;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: i < STEPS.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <div style={{
                width: 26, height: 26, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 500,
                background: done ? C.g600 : active ? C.g800 : C.g100,
                color: done || active ? "#fff" : "#6b9166",
                border: active ? `2px solid ${C.gold}` : "none",
                boxShadow: active ? "0 0 0 3px rgba(201,168,76,0.2)" : "none",
                transition: "all 0.2s",
              }}>
                {done ? <CheckIcon size={12} /> : i + 1}
              </div>
              <span style={{ fontSize: 10, fontFamily: F.b, fontWeight: active ? 500 : 400, color: active ? C.g800 : done ? C.g600 : "#8aaa86", whiteSpace: "nowrap" }}>{label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, marginBottom: 16, marginLeft: 3, marginRight: 3, background: done ? C.g600 : C.g100, transition: "background 0.3s" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [stage, setStage]             = useState("upload");
  const [rawHeaders, setRawHeaders]   = useState([]);
  const [rawRows, setRawRows]         = useState([]);
  const [mapping, setMapping]         = useState({});
  const [fileName, setFileName]       = useState("");
  const [dragging, setDragging]       = useState(false);
  const [fileError, setFileError]     = useState("");
  const [dedupResult, setDedupResult] = useState(null);
  const [showDupes, setShowDupes]     = useState(false);
  const [template, setTemplate]       = useState(DEFAULT_TEMPLATE);
  const [previewContact, setPreviewContact] = useState(null);
  const [sending, setSending]         = useState(false);
  const [sendResult, setSendResult]   = useState(null);
  const [sendError, setSendError]     = useState("");
  const [progress, setProgress]       = useState(0);
  const fileInputRef = useRef();

  const processFile = useCallback((file) => {
    setFileError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!json.length) { setFileError("No data found in file."); return; }
        const headers = Object.keys(json[0]);
        setRawHeaders(headers);
        setRawRows(json);
        setMapping(guessMapping(headers));
        setDedupResult(null);
        setStage("map");
      } catch {
        setFileError("Could not read file. Please upload a valid .xlsx or .csv.");
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

  const goToMessage = () => {
    const result = runDedup(rawRows, mapping);
    setDedupResult(result);
    setPreviewContact(result.unique[0] || null);
    setShowDupes(false);
    setStage("message");
  };

  const goToPreview = () => setStage("preview");

  const downloadCSV = () => {
    const csv = toCSV(dedupResult.unique, mapping);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "canopy_contacts.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const sendCampaign = async () => {
    setSending(true);
    setSendError("");
    setSendResult(null);
    setProgress(0);

    const messages = dedupResult.unique.map((row) => ({
      to:   row._phone,
      body: applyTemplate(template, row, mapping),
    }));

    // Animate progress bar while sending
    const total = messages.length;
    let fakeProgress = 0;
    const ticker = setInterval(() => {
      fakeProgress = Math.min(fakeProgress + Math.random() * 8, 90);
      setProgress(Math.round(fakeProgress));
    }, 300);

    try {
      const res = await fetch("/api/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const json = await res.json();
      clearInterval(ticker);
      setProgress(100);

      if (json.success) {
        setSendResult({ sent: json.sent, failed: json.failed, errors: json.errors || [], total });
        setStage("done");
      } else {
        setSendError(json.error || "Something went wrong. Check your Vercel environment variables.");
      }
    } catch (err) {
      clearInterval(ticker);
      setSendError("Could not reach the server. Make sure the app is deployed to Vercel.");
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    setStage("upload"); setRawHeaders([]); setRawRows([]); setMapping({});
    setFileName(""); setFileError(""); setDedupResult(null); setPreviewContact(null);
    setTemplate(DEFAULT_TEMPLATE); setSendResult(null); setSendError(""); setProgress(0);
    setShowDupes(false);
  };

  const uniqueRows  = dedupResult?.unique  ?? [];
  const dupeRows    = dedupResult?.dupes   ?? [];
  const noPhoneRows = dedupResult?.noPhone ?? [];
  const previewMsg  = previewContact ? applyTemplate(template, previewContact, mapping) : "";

  const mappedCount = DESIRED_FIELDS.filter(({ key }) => mapping[key]).length;

  return (
    <div style={{ minHeight: "100vh", background: C.cream, display: "flex", flexDirection: "column" }}>

      {/* ── Nav ── */}
      <header style={{ background: C.g900, borderBottom: `3px solid ${C.gold}`, padding: "0 40px", height: 62, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LeafIcon size={20} color={C.gold} />
          <span style={{ fontFamily: F.d, fontSize: 19, color: "#fff", fontWeight: 600 }}>Canopy Capital</span>
          <span style={{ color: C.gold4, fontSize: 11, marginLeft: 6, fontWeight: 300, letterSpacing: "0.08em", textTransform: "uppercase" }}>Outreach Tool</span>
        </div>
        {stage !== "upload" && (
          <button onClick={reset} style={{ background: "transparent", border: `1px solid rgba(201,168,76,0.35)`, color: C.gold4, borderRadius: 5, padding: "5px 14px", fontSize: 11, fontFamily: F.b, cursor: "pointer" }}>
            Start over
          </button>
        )}
      </header>

      {/* ── Body ── */}
      <main style={{ flex: 1, padding: "36px 40px 60px", maxWidth: 900, margin: "0 auto", width: "100%" }}>
        <StepTracker stage={stage} />

        {/* ── UPLOAD ── */}
        {stage === "upload" && (
          <div className="fade-up">
            <h1 style={{ fontFamily: F.d, fontSize: 30, fontWeight: 500, color: C.g900, marginBottom: 6 }}>Upload your lead file</h1>
            <p style={{ color: "#5a7a56", fontSize: 14, marginBottom: 28 }}>Drop your Wayne County tax list or lead export — we'll deduplicate it and send your outreach in minutes.</p>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current.click()}
              style={{
                border: `2px dashed ${dragging ? C.g500 : C.g200}`,
                borderRadius: 18, padding: "52px 40px", textAlign: "center", cursor: "pointer",
                background: dragging ? C.g50 : C.white,
                boxShadow: dragging ? `0 0 0 4px rgba(62,122,59,0.08)` : "0 1px 3px rgba(26,46,26,0.06)",
                transition: "all 0.2s", marginBottom: 28,
              }}
            >
              <div style={{ marginBottom: 14 }}><UploadIcon /></div>
              <p style={{ fontFamily: F.d, fontSize: 19, color: C.g800, marginBottom: 6 }}>Drop your file here</p>
              <p style={{ fontSize: 13, color: "#8aaa86", marginBottom: 18 }}>Supports .xlsx, .xls, and .csv</p>
              <div style={{ display: "inline-block", background: C.g800, color: "#fff", borderRadius: 7, padding: "9px 22px", fontSize: 13, fontWeight: 500 }}>Browse files</div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.xls" style={{ display: "none" }} onChange={(e) => e.target.files[0] && processFile(e.target.files[0])} />
            </div>

            {fileError && <div style={{ padding: "11px 14px", background: C.red50, border: `1px solid ${C.red200}`, borderRadius: 8, color: C.red700, fontSize: 13, marginBottom: 20 }}>{fileError}</div>}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              {[
                { num: "01", title: "Upload",         desc: "Drop your lead file." },
                { num: "02", title: "Map & Dedup",    desc: "Clean your list automatically." },
                { num: "03", title: "Craft message",  desc: "Personalize your outreach." },
                { num: "04", title: "Send campaign",  desc: "Fire SMS to every contact." },
              ].map(({ num, title, desc }) => (
                <div key={num} style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 16px", boxShadow: "0 1px 3px rgba(26,46,26,0.04)" }}>
                  <p style={{ fontFamily: F.d, fontSize: 20, color: C.gold, fontWeight: 400, marginBottom: 5 }}>{num}</p>
                  <p style={{ fontWeight: 500, color: C.g800, marginBottom: 3, fontSize: 13 }}>{title}</p>
                  <p style={{ fontSize: 12, color: "#8aaa86", lineHeight: 1.5 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── MAP ── */}
        {stage === "map" && (
          <div className="fade-up">
            <h1 style={{ fontFamily: F.d, fontSize: 28, fontWeight: 500, color: C.g900, marginBottom: 6 }}>Map your columns</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18, padding: "9px 14px", background: C.g50, border: `1px solid ${C.g200}`, borderRadius: 7 }}>
              <CheckIcon size={13} color={C.g600} />
              <span style={{ fontSize: 13, color: C.g700 }}><strong>{fileName}</strong> — {rawRows.length.toLocaleString()} rows, {rawHeaders.length} columns</span>
            </div>
            <p style={{ fontSize: 13, color: "#5a7a56", marginBottom: 20 }}>
              Auto-matched {mappedCount} of {DESIRED_FIELDS.length} fields. <strong>Phone ★</strong> is used for deduplication and SMS delivery.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "11px 24px", marginBottom: 28 }}>
              {DESIRED_FIELDS.map(({ key, label }) => (
                <div key={key}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: C.g700, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {label}{key === "phone" ? " ★" : ""}
                  </label>
                  <select value={mapping[key] || ""} onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value }))} style={{ width: "100%", fontSize: 13 }}>
                    <option value="">— skip this field —</option>
                    {rawHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="secondary" onClick={() => setStage("upload")}>← Back</Btn>
              <Btn onClick={goToMessage} disabled={!mapping.phone}>Deduplicate &amp; craft message →</Btn>
            </div>
            {!mapping.phone && <p style={{ fontSize: 12, color: "#8a6a1a", marginTop: 10 }}>Map the Phone field to continue — it's required for SMS delivery.</p>}
          </div>
        )}

        {/* ── MESSAGE ── */}
        {stage === "message" && (
          <div className="fade-up">
            <h1 style={{ fontFamily: F.d, fontSize: 28, fontWeight: 500, color: C.g900, marginBottom: 6 }}>Craft your message</h1>
            <p style={{ fontSize: 13, color: "#5a7a56", marginBottom: 20 }}>
              Personalize using <code style={{ background: C.g50, padding: "1px 5px", borderRadius: 4, fontSize: 12, color: C.g700 }}>{"{field_name}"}</code> placeholders — they'll be filled in per contact when sent.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
              {/* Template editor */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 500, color: C.g700, display: "block", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Message template</label>
                <textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={10}
                  style={{ width: "100%", fontSize: 13, lineHeight: 1.65, padding: "12px 14px", borderRadius: 8, border: `1px solid ${C.borderS}` }}
                />
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {DESIRED_FIELDS.filter(({ key }) => mapping[key]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setTemplate((t) => t + ` {${key}}`)}
                      style={{ background: C.g50, border: `1px solid ${C.g200}`, color: C.g700, borderRadius: 5, padding: "3px 9px", fontSize: 11, fontFamily: F.b, cursor: "pointer" }}
                    >
                      + {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live preview */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <label style={{ fontSize: 11, fontWeight: 500, color: C.g700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Live preview</label>
                  <select
                    value={previewContact?._rowIndex ?? ""}
                    onChange={(e) => {
                      const row = uniqueRows.find((r) => String(r._rowIndex) === e.target.value);
                      setPreviewContact(row || null);
                    }}
                    style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5 }}
                  >
                    {uniqueRows.slice(0, 20).map((row) => {
                      const name = mapping.owner_name ? row[mapping.owner_name] : `Contact ${row._rowIndex + 1}`;
                      return <option key={row._rowIndex} value={row._rowIndex}>{name}</option>;
                    })}
                  </select>
                </div>
                {/* Phone bubble */}
                <div style={{ background: "#f0f0f0", borderRadius: 12, padding: 16, minHeight: 200 }}>
                  <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                    <div style={{ background: "#346332", color: "#fff", borderRadius: "16px 16px 4px 16px", padding: "10px 14px", maxWidth: "85%", fontSize: 13, lineHeight: 1.55 }}>
                      {previewMsg || <span style={{ opacity: 0.5 }}>Your message will appear here…</span>}
                    </div>
                  </div>
                  <p style={{ textAlign: "center", fontSize: 11, color: "#999", marginTop: 10 }}>
                    {previewMsg.length} characters · approx {Math.ceil(previewMsg.length / 160)} SMS segment{Math.ceil(previewMsg.length / 160) !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Dedup summary */}
                <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div style={{ background: C.g50, border: `1px solid ${C.g200}`, borderRadius: 8, padding: "10px 12px" }}>
                    <p style={{ fontSize: 10, color: C.g600, fontWeight: 500, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Will receive SMS</p>
                    <p style={{ fontSize: 20, fontWeight: 600, fontFamily: F.d, color: C.g700 }}>{uniqueRows.length.toLocaleString()}</p>
                  </div>
                  <div style={{ background: dupeRows.length > 0 ? C.gold0 : C.g50, border: `1px solid ${dupeRows.length > 0 ? C.gold3 : C.g200}`, borderRadius: 8, padding: "10px 12px" }}>
                    <p style={{ fontSize: 10, color: dupeRows.length > 0 ? "#8a6a1a" : C.g600, fontWeight: 500, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Duplicates skipped</p>
                    <p style={{ fontSize: 20, fontWeight: 600, fontFamily: F.d, color: dupeRows.length > 0 ? "#8a6a1a" : C.g700 }}>{dupeRows.length.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="secondary" onClick={() => setStage("map")}>← Back</Btn>
              <Btn onClick={goToPreview} disabled={!template.trim()}>Review &amp; confirm →</Btn>
            </div>
          </div>
        )}

        {/* ── PREVIEW ── */}
        {stage === "preview" && dedupResult && (
          <div className="fade-up">
            <h1 style={{ fontFamily: F.d, fontSize: 28, fontWeight: 500, color: C.g900, marginBottom: 6 }}>Review before sending</h1>
            <p style={{ fontSize: 13, color: "#5a7a56", marginBottom: 20 }}>Double-check everything. This will send real SMS messages.</p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 22 }}>
              <StatCard label="Total rows"        value={rawRows.length.toLocaleString()}    accent="default" />
              <StatCard label="Messages to send"  value={uniqueRows.length.toLocaleString()} accent="green"   />
              <StatCard label="Duplicates skipped" value={dupeRows.length.toLocaleString()}  accent={dupeRows.length > 0 ? "gold" : "default"} />
              <StatCard label="No phone — skipped" value={noPhoneRows.length.toLocaleString()} accent={noPhoneRows.length > 0 ? "gold" : "default"} />
            </div>

            {/* Message preview box */}
            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 20, boxShadow: "0 1px 3px rgba(26,46,26,0.05)" }}>
              <p style={{ fontSize: 11, fontWeight: 500, color: C.g700, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Message template</p>
              <p style={{ fontSize: 13, color: C.g800, lineHeight: 1.65, whiteSpace: "pre-wrap" }}>{template}</p>
            </div>

            {/* Contacts preview */}
            <p style={{ fontSize: 12, color: "#5a7a56", marginBottom: 8 }}>First 5 contacts that will receive a message</p>
            <div style={{ overflowX: "auto", marginBottom: 22, border: `1px solid ${C.border}`, borderRadius: 9, boxShadow: "0 1px 3px rgba(26,46,26,0.04)" }}>
              <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", background: C.white }}>
                <thead>
                  <tr style={{ background: C.g50 }}>
                    {["Owner Name", "Phone", "Property Address", "Strategy", "Preview message"].map((h) => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: `1px solid ${C.g200}`, color: C.g700, fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {uniqueRows.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.g50 }}>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{mapping.owner_name ? row[mapping.owner_name] : "—"}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", color: C.g600, fontWeight: 500 }}>{row._phone}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{mapping.property_address ? row[mapping.property_address] : "—"}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{mapping.strategy ? row[mapping.strategy] : "—"}</td>
                      <td style={{ padding: "8px 12px", borderBottom: `1px solid ${C.border}`, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#5a7a56", fontStyle: "italic" }}>
                        {applyTemplate(template, row, mapping).substring(0, 80)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {dupeRows.length > 0 && (
              <div style={{ marginBottom: 18 }}>
                <Btn variant="gold" onClick={() => setShowDupes((v) => !v)}>
                  {showDupes ? "Hide duplicates" : `Review ${dupeRows.length} skipped duplicate${dupeRows.length !== 1 ? "s" : ""}`}
                </Btn>
                {showDupes && (
                  <div style={{ marginTop: 10, border: `1px solid ${C.gold3}`, borderRadius: 9, overflow: "hidden" }}>
                    <div style={{ background: C.gold0, padding: "8px 14px", borderBottom: `1px solid ${C.gold3}` }}>
                      <p style={{ fontSize: 11, color: "#8a6a1a", margin: 0 }}>These contacts share a phone number with an earlier entry — no SMS will be sent to them.</p>
                    </div>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse", background: C.white }}>
                      <thead>
                        <tr style={{ background: C.gold0 }}>
                          {["Owner Name", "Phone", "Property Address"].map((h) => (
                            <th key={h} style={{ textAlign: "left", padding: "7px 12px", borderBottom: `1px solid ${C.gold3}`, color: "#8a6a1a", fontWeight: 500, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dupeRows.slice(0, 20).map((row, i) => (
                          <tr key={i} style={{ background: i % 2 === 0 ? C.white : C.gold0 }}>
                            <td style={{ padding: "7px 12px", borderBottom: `1px solid rgba(201,168,76,0.15)` }}>{mapping.owner_name ? row[mapping.owner_name] : "—"}</td>
                            <td style={{ padding: "7px 12px", borderBottom: `1px solid rgba(201,168,76,0.15)` }}>{row._phone}</td>
                            <td style={{ padding: "7px 12px", borderBottom: `1px solid rgba(201,168,76,0.15)`, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mapping.property_address ? row[mapping.property_address] : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {dupeRows.length > 20 && <p style={{ fontSize: 11, color: "#8a6a1a", padding: "7px 14px", background: C.gold0 }}>...and {dupeRows.length - 20} more</p>}
                  </div>
                )}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="secondary" onClick={() => setStage("message")}>← Back</Btn>
              <Btn variant="outline" onClick={downloadCSV}>Download CSV</Btn>
              <Btn onClick={() => setStage("send")}>Confirm &amp; send campaign →</Btn>
            </div>
          </div>
        )}

        {/* ── SEND ── */}
        {stage === "send" && (
          <div className="fade-up">
            <h1 style={{ fontFamily: F.d, fontSize: 28, fontWeight: 500, color: C.g900, marginBottom: 6 }}>Send your campaign</h1>
            <p style={{ fontSize: 13, color: "#5a7a56", marginBottom: 28 }}>
              This will send <strong>{uniqueRows.length.toLocaleString()} SMS messages</strong> via Twilio. There's no undo — make sure you're ready.
            </p>

            <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 22px", marginBottom: 24, boxShadow: "0 1px 3px rgba(26,46,26,0.05)" }}>
              <div style={{ display: "flex", gap: 28, marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 11, color: C.g600, fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Recipients</p>
                  <p style={{ fontSize: 22, fontWeight: 600, fontFamily: F.d, color: C.g800 }}>{uniqueRows.length.toLocaleString()}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: C.g600, fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Approx. segments each</p>
                  <p style={{ fontSize: 22, fontWeight: 600, fontFamily: F.d, color: C.g800 }}>{Math.ceil(template.length / 160)}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, color: C.g600, fontWeight: 500, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>Duplicates skipped</p>
                  <p style={{ fontSize: 22, fontWeight: 600, fontFamily: F.d, color: dupeRows.length > 0 ? "#8a6a1a" : C.g800 }}>{dupeRows.length.toLocaleString()}</p>
                </div>
              </div>

              {sending && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: C.g700 }}>Sending messages…</span>
                    <span style={{ fontSize: 12, color: C.g600, fontWeight: 500 }}>{progress}%</span>
                  </div>
                  <div style={{ background: C.g100, borderRadius: 99, height: 8, overflow: "hidden" }}>
                    <div style={{ background: `linear-gradient(90deg, ${C.g600}, ${C.g500})`, height: "100%", width: `${progress}%`, borderRadius: 99, transition: "width 0.3s ease" }} />
                  </div>
                </div>
              )}
            </div>

            {sendError && (
              <div style={{ padding: "12px 14px", background: C.red50, border: `1px solid ${C.red200}`, borderRadius: 8, color: C.red700, fontSize: 13, marginBottom: 18 }}>
                {sendError}
              </div>
            )}

            <div style={{ display: "flex", gap: 10 }}>
              <Btn variant="secondary" onClick={() => setStage("preview")} disabled={sending}>← Back</Btn>
              <button
                onClick={sendCampaign}
                disabled={sending}
                style={{
                  background: sending ? C.g200 : C.g800,
                  color: sending ? C.g600 : "#fff",
                  border: "none", borderRadius: 7, padding: "10px 24px",
                  fontSize: 13, fontFamily: F.b, fontWeight: 500,
                  cursor: sending ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", gap: 8,
                  transition: "all 0.2s", minWidth: 220,
                }}
              >
                {sending ? <><SpinnerIcon /> Sending campaign…</> : `Send ${uniqueRows.length.toLocaleString()} messages now`}
              </button>
            </div>
          </div>
        )}

        {/* ── DONE ── */}
        {stage === "done" && sendResult && (
          <div className="fade-up" style={{ textAlign: "center", padding: "32px 20px" }}>
            <div style={{ width: 68, height: 68, borderRadius: "50%", background: C.g800, border: `3px solid ${C.gold}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
              <CheckIcon size={28} color="#fff" />
            </div>
            <h1 style={{ fontFamily: F.d, fontSize: 30, fontWeight: 500, color: C.g900, marginBottom: 10 }}>Campaign sent</h1>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, maxWidth: 480, margin: "0 auto 28px", textAlign: "left" }}>
              <StatCard label="Messages sent"   value={sendResult.sent.toLocaleString()}   accent="green" />
              <StatCard label="Failed"           value={sendResult.failed.toLocaleString()} accent={sendResult.failed > 0 ? "red" : "default"} />
              <StatCard label="Total attempted"  value={sendResult.total.toLocaleString()}  accent="default" />
            </div>

            {sendResult.failed > 0 && sendResult.errors.length > 0 && (
              <div style={{ background: C.red50, border: `1px solid ${C.red200}`, borderRadius: 9, padding: "12px 16px", maxWidth: 480, margin: "0 auto 20px", textAlign: "left" }}>
                <p style={{ fontSize: 12, color: C.red700, fontWeight: 500, marginBottom: 8 }}>Failed numbers:</p>
                {sendResult.errors.slice(0, 10).map((e, i) => (
                  <p key={i} style={{ fontSize: 12, color: C.red700, marginBottom: 3 }}>{e.to} — {e.error}</p>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 36 }}>
              <Btn variant="outline" onClick={downloadCSV}>Download contact CSV</Btn>
              <Btn onClick={reset}>Start a new campaign</Btn>
            </div>

            <div style={{ padding: "16px 24px", background: C.white, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.gold}`, borderRadius: "0 9px 9px 0", maxWidth: 420, margin: "0 auto", textAlign: "left" }}>
              <p style={{ fontFamily: F.d, fontSize: 14, color: C.g800, lineHeight: 1.65, fontStyle: "italic", margin: 0 }}>
                "Let us not love with words or speech but with actions and in truth."
              </p>
            </div>
          </div>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ background: C.g900, borderTop: `2px solid ${C.gold}`, padding: "12px 40px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <LeafIcon size={13} color={C.gold} />
          <span style={{ fontFamily: F.d, fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Canopy Capital Group</span>
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: "0.04em" }}>Detroit &amp; Wayne County</span>
      </footer>
    </div>
  );
}
