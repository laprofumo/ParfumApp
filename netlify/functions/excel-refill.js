import { corsHeaders, getAccessTokenOrThrow, graph } from "./_util.js";

const dateCols = ["T","V","X","Z","AB","AD","AF"];
const fmtCols  = ["U","W","Y","AA","AC","AE","AG"];

export async function handler(event, context) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    const payload = JSON.parse(event.body || "{}");
    const row = Number(payload.row || 0);
    const formatMl = payload.formatMl; // number only
    const refillDate = payload.refillDate; // TT.MM.JJ

    if (!row || !formatMl || !refillDate) return { statusCode: 400, headers, body: JSON.stringify({ error: "row, formatMl, refillDate required" }) };

    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;
    const sheet = "Duftkreationen";

    // read existing refill date columns to find next free slot
    const readAddr = `${dateCols[0]}${row}:${fmtCols[fmtCols.length-1]}${row}`;
    const data = await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='${readAddr}')?$select=values`);
    const v = data?.values?.[0] || [];

    // v includes T..AG; we need to check each date col relative index.
    // We'll simply fetch each date cell to be safe:
    let slot = -1;
    for (let i=0; i<dateCols.length; i++) {
      const cell = await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='${dateCols[i]}${row}')?$select=values`);
      const val = cell?.values?.[0]?.[0];
      if (val === null || val === undefined || String(val).trim() === "") { slot = i; break; }
    }
    if (slot === -1) return { statusCode: 400, headers, body: JSON.stringify({ error: "No free refill slot left (T..AF)" }) };

    // write date and format number
    await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='${dateCols[slot]}${row}:${fmtCols[slot]}${row}')`, {
      method: "PATCH",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify({ values: [[refillDate, formatMl]] })
    });

    return { statusCode: 200, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify({ ok: true, slot: slot+1, dateCol: dateCols[slot], fmtCol: fmtCols[slot] }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}