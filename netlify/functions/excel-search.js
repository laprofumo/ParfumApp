// netlify/functions/excel-search.js
import { corsHeaders, getAccessTokenOrThrow, graph } from "./_util.js";

function norm(s) { return String(s || "").toLowerCase(); }

let _cache = {
  ts: 0,
  addr: "",
  values: null
};

export async function handler(event, context) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const q = (event.queryStringParameters?.q || "").trim().toLowerCase();
    if (!q) {
      return {
        statusCode: 200,
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ results: [] })
      };
    }

    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;
    const sheet = "Duftkreationen";

    const MAX_ROWS = Number(process.env.SEARCH_MAX_ROWS || 3000);
    const addr = `A3:O${MAX_ROWS}`;

    const ttlMs = Number(process.env.SEARCH_CACHE_TTL_MS || 15000);
    const now = Date.now();

    let values = null;

    if (_cache.values && _cache.addr === addr && (now - _cache.ts) < ttlMs) {
      values = _cache.values;
    } else {
      const data = await graph(
        access_token,
        `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='${addr}')?$select=values`
      );
      values = data?.values || [];
      _cache = { ts: now, addr, values };
    }

    const results = [];

    for (let i = 0; i < values.length; i++) {
      const row = values[i] || [];
      const rowNum = 3 + i;

      const A = row[0];
      const B = row[1];

      if (!A && !B) continue;

      const C = row[2];
      const E = row[4];
      const H = row[7];
      const K = row[10];

      const hay = norm(A) + " " + norm(B);
      if (hay.includes(q)) {
        results.push({
          row: rowNum,
          "Kundeninfo": A,
          "Name Fragrance": B,
          "Konzentration": C,
          "Duft 1": E,
          "Duft 2": H,
          "Duft 3": K
        });
      }
    }

    results.sort((r1, r2) => norm(r1.Kundeninfo).localeCompare(norm(r2.Kundeninfo)));

    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ results })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}
