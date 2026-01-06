// netlify/functions/excel-append.js
import { corsHeaders, getAccessTokenOrThrow, graph } from "./_util.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function round1(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10) / 10;
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
  datumErstellung,
  mengeMl,
  duft1Name,
  duft2Name,
  duft3Name,
  duft1Anteil,
  duft2Anteil,
  duft3Anteil
}) {
  // Eure Metaobject-Felder existieren (siehe Screenshots):
  // - name
  // - konzentration
  // - datum_erstellung
  // - menge_ml
  // - duft_1_name, duft_1_anteil, duft_1_gramm, duft_1_ml
  // - duft_2_name, ...
  // - duft_3_name, ...
  //
  // Wichtig: Hier senden wir nur die Felder, die DEFINITIV existieren.
  // Gramm/ml pro Duft sind optional; wenn euer Backend sie nutzt, kann es sie selbst berechnen.
  const payload = {
    customerId: String(customerId),
    kreation: {
      name: String(nameFragrance || "").trim(),
      konzentration: String(konzentration || "EDP"),
      datum_erstellung: String(datumErstellung || ""),
      menge_ml: Number(toNum(mengeMl)),

      duft_1_name: String(duft1Name || "").trim(),
      duft_2_name: String(duft2Name || "").trim(),
      duft_3_name: String(duft3Name || "").trim(),

      duft_1_anteil: Number(toNum(duft1Anteil)),
      duft_2_anteil: Number(toNum(duft2Anteil)),
      duft_3_anteil: Number(toNum(duft3Anteil))
    }
  };

  // Minimal-Validierung (damit Render nicht 422 wirft)
  if (!payload.kreation.name) {
    const e = new Error("Kreation fehlt/ungültig (Name Fragrance fehlt).");
    e.statusCode = 422;
    throw e;
  }
  if (!payload.kreation.menge_ml) {
    const e = new Error("Kreation fehlt/ungültig (Format ml fehlt).");
    e.statusCode = 422;
    throw e;
  }
  if (!payload.kreation.duft_1_name) {
    const e = new Error("Kreation fehlt/ungültig (Duft 1 fehlt).");
    e.statusCode = 422;
    throw e;
  }

  return await renderFetch(`/save-kreation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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

    // Save kreation in Shopify using existing metaobject field handles
    await shopifySaveKreationFlatFields({
      customerId,
      nameFragrance: payload["Name Fragrance"] ?? "",
      konzentration: payload["Konzentration"] ?? "EDP",
      datumErstellung: payload["Datum Kauf"] ?? "",
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
    const O = payload["Datum Kauf"] ?? "";
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
