// public/assets/app.js

const api = async (path, opts = {}) => {
  const r = await fetch(path, opts);
  const txt = await r.text();
  let data;
  try {
    data = txt ? JSON.parse(txt) : null;
  } catch {
    data = txt;
  }
  if (!r.ok) {
    const msg = data && data.error ? data.error : `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return data;
};

// ---------- Settings (normalize to flat shape for UI) ----------

function normalizeSettings(s) {
  if (!s) {
    return {
      printerIp: "",
      printerPort: 8008,
      logoBase64: "",
      headerText: "",
      qrUrl: "",
      footerText: ""
    };
  }

  // Already flat
  if (
    typeof s === "object" &&
    ("printerIp" in s || "printerPort" in s || "headerText" in s)
  ) {
    return {
      printerIp: String(s.printerIp || "").trim(),
      printerPort: Number(s.printerPort || 8008),
      logoBase64: String(s.logoBase64 || ""),
      headerText: String(s.headerText || ""),
      qrUrl: String(s.qrUrl || ""),
      footerText: String(s.footerText || "")
    };
  }

  // Nested (expected from OneDrive settings.json via settings-get)
  const printer = s.printer || {};
  const receipt = s.receipt || {};
  return {
    printerIp: String(printer.ip || "").trim(),
    printerPort: Number(printer.port || 8008),
    logoBase64: String(receipt.logoBase64 || ""),
    headerText: String(receipt.headerText || ""),
    qrUrl: String(receipt.qrUrl || ""),
    footerText: String(receipt.footerText || "")
  };
}

export async function getSettings() {
  const s = await api("/.netlify/functions/settings-get");
  return normalizeSettings(s);
}

export async function saveSettings(flat) {
  const payload = {
    printer: {
      ip: String(flat?.printerIp || "").trim(),
      port: Number(flat?.printerPort || 8008)
    },
    receipt: {
      logoBase64: String(flat?.logoBase64 || ""),
      headerText: String(flat?.headerText || ""),
      qrUrl: String(flat?.qrUrl || ""),
      footerText: String(flat?.footerText || "")
    }
  };

  return await api("/.netlify/functions/settings-put", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

// ---------- Auth ----------

export async function authStart() {
  return await api("/.netlify/functions/auth-start");
}

// ---------- Excel API ----------

export async function excelAppend(payload) {
  return await api("/.netlify/functions/excel-append", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
}

export async function excelSearch(q) {
  const u = new URL("/.netlify/functions/excel-search", location.origin);
  u.searchParams.set("q", q);
  return await api(u.toString());
}

export async function excelGetRow(row) {
  const u = new URL("/.netlify/functions/excel-get-row", location.origin);
  u.searchParams.set("row", row);
  return await api(u.toString());
}

export async function excelRefill(row, formatMl, refillDate) {
  return await api("/.netlify/functions/excel-refill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ row, formatMl, refillDate })
  });
}

// ---------- Helpers ----------

export function todayCH() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

export function mlToG(ml) {
  return ml / 1.19;
}

export function parseMlInput(v) {
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n)
    throw new Error("Format muss eine ganze Zahl (ml) sein.");
  return n;
}
