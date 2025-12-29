// netlify/functions/excel-get-row.js
import { corsHeaders, getAccessTokenOrThrow, graph } from "./_util.js";

let _rowCache = new Map(); // row -> { ts, obj }
const _MAX_CACHE = 300;

export async function handler(event, context) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const row = Number(event.queryStringParameters?.row || 0);
    if (!row) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing row" }) };

    const ttlMs = Number(process.env.ROW_CACHE_TTL_MS || 20000);
    const now = Date.now();

    const cached = _rowCache.get(row);
    if (cached && (now - cached.ts) < ttlMs) {
      return {
        statusCode: 200,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(cached.obj)
      };
    }

    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;
    const sheet = "Duftkreationen";

    const addr = `A${row}:O${row}`;
    const data = await graph(
      access_token,
      `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='${addr}')?$select=values`
    );

    const v = data?.values?.[0] || [];

    const obj = {
      row,
      "Kundeninfo": v[0] ?? "",
      "Name Fragrance": v[1] ?? "",
      "Konzentration": v[2] ?? "",
      "%/1": v[3] ?? "",
      "Duft 1": v[4] ?? "",
      "g Duft 1": v[5] ?? "",
      "%/2": v[6] ?? "",
      "Duft 2": v[7] ?? "",
      "g Duft 2": v[8] ?? "",
      "%/3": v[9] ?? "",
      "Duft 3": v[10] ?? "",
      "g Duft 3": v[11] ?? "",
      "Total %": v[12] ?? "",
      "Format ml": v[13] ?? "",
      "Datum Kauf": v[14] ?? ""
    };

    _rowCache.set(row, { ts: now, obj });
    if (_rowCache.size > _MAX_CACHE) {
      const firstKey = _rowCache.keys().next().value;
      _rowCache.delete(firstKey);
    }

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(obj)
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}
