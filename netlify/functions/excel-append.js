// netlify/functions/excel-append.js
import { corsHeaders, getAccessTokenOrThrow, graph } from "./_util.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function toNum(v) {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(",", ".").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function splitCustomerInfoToNames(kundeninfo) {
  const s = String(kundeninfo || "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: "", lastName: "" };
  const parts = s.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Converts "DD.MM.YY" or "DD.MM.YYYY" to "YYYY-MM-DD".
// Returns "" if it cannot parse.
function chDateToIso(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";

  // already ISO?
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return "";

  let d = Number(m[1]);
  let mo = Number(m[2]);
  let y = Number(m[3]);

  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return "";
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return "";

  // Interpret 2-digit year as 2000-2099 (good enough for your use-case)
  if (String(m[3]).length === 2) y = 2000 + y;

  const yyyy = String(y).padStart(4, "0");
  const mm = String(mo).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function renderFetch(path, { method = "GET", headers = {}, body } = {}) {
  const baseUrl = process.env.RENDER_BASE_URL;
  const apiKey = process.env.RENDER_API_KEY;

  if (!baseUrl || !apiKey) {
    const e = new Error("Missing Render configuration (RENDER_BASE_URL / RENDER_API_KEY).");
    e.statusCode = 500;
    throw e;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...headers, "X-API-KEY": apiKey },
    body
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      json?.error ||
      json?.message ||
      json?.details?.error ||
      json?.details?.message ||
      `Render error ${res.status}`;
    const e = new Error(msg);
    e.statusCode = res.status;
    e.details = json;
    throw e;
  }
  return json;
}

async function shopifyFindOrCreateCustomer({ kundeninfo, email }) {
  const normalizedEmail = normalizeEmail(email);
  const q = `email:${normalizedEmail}`;

  const search = await renderFetch(`/search-customer?query=${encodeURIComponent(q)}`, { method: "GET" });
  const customers = Array.isArray(search?.customers) ? search.customers : [];

  if (customers.length > 0) {
    return { status: "existing", customer: customers[0] };
  }

  const { firstName, lastName } = splitCustomerInfoToNames(kundeninfo);

  const created = await renderFetch(`/create-customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName, lastName, email: normalizedEmail })
  });

  return { status: "created", customer: created };
}

async function shopifySaveKreationFlatFields({
  customerId,
  nameFragrance,
  konzentration,
  datumKaufCH, // comes as "DD.MM.YY" from Excel rule
  mengeMl,
  duft1Name,
  duft2Name,
  duft3Name,
  duft1Anteil,
  duft2Anteil,
  duft3Anteil
}) {
  const isoDate = chDateToIso(datumKaufCH);
  if (!isoDate) {
    const e = new Error("Value must be in YYYY-MM-DD format.");
    e.statusCode = 422;
    throw e;
  }

  const kreation = {
    name: String(nameFragrance || "").trim(),
    konzentration: String(konzentration || "EDP"),
    datum_erstellung: isoDate, // Shopify wants YYYY-MM-DD
    menge_ml: Number(toNum(mengeMl)),

    duft_1_name: String(duft1Name || "").trim(),
    duft_2_name: String(duft2Name || "").trim(),
    duft_3_name: String(duft3Name || "").trim(),

    duft_1_anteil: Number(toNum(duft1Anteil)),
    duft_2_anteil: Number(toNum(duft2Anteil)),
    duft_3_anteil: Number(toNum(duft3Anteil))
  };

  if (!kreation.name) {
    const e = new Error("Kreation fehlt/ungültig (Name Fragrance fehlt).");
    e.statusCode = 422;
    throw e;
  }
  if (!kreation.menge_ml) {
    const e = new Error("Kreation fehlt/ungültig (Format ml fehlt).");
    e.statusCode = 422;
    throw e;
  }
  if (!kreation.duft_1_name) {
    const e = new Error("Kreation fehlt/ungültig (Duft 1 fehlt).");
    e.statusCode = 422;
    throw e;
  }

  return await renderFetch(`/save-kreation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerId: String(customerId),
      kreation
    })
  });
}

function isExcelLockError(e) {
  const msg = String(e?.message || "");
  return (
    msg.includes("EditModeCannotAcquireLock") ||
    msg.includes("accessConflict") ||
    msg.includes("CannotAcquireLock") ||
    msg.includes("409")
  );
}

async function graphWithRetry(access_token, url, options, tries = 4) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await graph(access_token, url, options);
    } catch (e) {
      lastErr = e;
      if (!isExcelLockError(e)) throw e;
      await sleep(800 * (i + 1));
    }
  }
  throw lastErr;
}

export async function handler(event) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    const payload = JSON.parse(event.body || "{}");

    // -------- Shopify zuerst (Kunde + Kreation) --------
    const kundeninfo = payload["Kundeninfo"] ?? "";
    const email = normalizeEmail(payload["Email"] ?? "");
    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email fehlt." }) };
    }

    const customerResult = await shopifyFindOrCreateCustomer({ kundeninfo, email });
    const customer = customerResult.customer;

    const customerId =
      customer?.id ??
      customer?.customer?.id ??
      customer?.customer?.customer?.id ??
      null;

    if (!customerId) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Shopify Kunde-ID nicht gefunden." }) };
    }

    await shopifySaveKreationFlatFields({
      customerId,
      nameFragrance: payload["Name Fragrance"] ?? "",
      konzentration: payload["Konzentration"] ?? "EDP",
      datumKaufCH: payload["Datum Kauf"] ?? "", // DD.MM.YY (Excel rule)
      mengeMl: payload["Format ml"] ?? "",
      duft1Name: payload["Duft 1"] ?? "",
      duft2Name: payload["Duft 2"] ?? "",
      duft3Name: payload["Duft 3"] ?? "",
      duft1Anteil: payload["%/1"] ?? "",
      duft2Anteil: payload["%/2"] ?? "",
      duft3Anteil: payload["%/3"] ?? ""
    });

    // -------- Excel schreiben --------
    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;

    const sheet = "Duftkreationen";

    const used = await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/usedRange(valuesOnly=true)?$select=rowCount`,
      undefined
    );
    const rowCount = used?.rowCount || 2;
    const nextRow = rowCount + 1;

    const A = payload["Kundeninfo"] ?? "";
    const B = payload["Name Fragrance"] ?? "";
    const C = payload["Konzentration"] ?? "EDP";
    const D = payload["%/1"] ?? "";
    const E = payload["Duft 1"] ?? "";
    const G = payload["%/2"] ?? "";
    const H = payload["Duft 2"] ?? "";
    const J = payload["%/3"] ?? "";
    const K = payload["Duft 3"] ?? "";
    const N = payload["Format ml"] ?? "";
    const O = payload["Datum Kauf"] ?? ""; // keep CH format in Excel
    const P = payload["Bemerkungen"] ?? "";
    const AH = email;

    await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='A${nextRow}:E${nextRow}')`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [[A, B, C, D, E]] }) }
    );

    await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='G${nextRow}:H${nextRow}')`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [[G, H]] }) }
    );

    await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='J${nextRow}:K${nextRow}')`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [[J, K]] }) }
    );

    await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='N${nextRow}:P${nextRow}')`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [[N, O, P]] }) }
    );

    await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='AH${nextRow}:AH${nextRow}')`,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: [[AH]] }) }
    );

    const computed = await graphWithRetry(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='F${nextRow}:M${nextRow}')?$select=values`,
      undefined
    );

    const row = (computed?.values && computed.values[0]) ? computed.values[0] : [];
    const result = {
      row: nextRow,
      "g Duft 1": row[0] ?? "",
      "g Duft 2": row[3] ?? "",
      "g Duft 3": row[6] ?? "",
      "Total %": row[7] ?? ""
    };

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        row: nextRow,
        computed: result,
        shopify: {
          customerStatus: customerResult.status,
          customerId: String(customerId)
        }
      })
    };
  } catch (e) {
    if (isExcelLockError(e)) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: "Excel ist gerade geöffnet. Bitte Datei schließen und erneut speichern." })
      };
    }
    return {
      statusCode: e?.statusCode || 500,
      headers,
      body: JSON.stringify({
        error: e?.message || String(e),
        details: e?.details || undefined
      })
    };
  }
}
