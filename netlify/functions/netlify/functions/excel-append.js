import { corsHeaders, getAccessTokenOrThrow, graph } from "./_util.js";

function colLetterToIndex(letter) {
  // A=1
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export async function handler(event, context) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    const payload = JSON.parse(event.body || "{}");

    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;

    // 1) find next row using usedRange
    const sheet = "Duftkreationen";
    const used = await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/usedRange(valuesOnly=true)?$select=rowCount`);
    const rowCount = used?.rowCount || 2; // at least header rows
    const nextRow = rowCount + 1;

    // 2) build row values A..P but only fill the agreed columns. Leave others as-is.
    // Store only numbers (no units). Date is TT.MM.JJ string in O.
    // Incoming keys are field names from excel row 2.
    const A = payload["Kundeninfo"] ?? "";
    const B = payload["Name Fragrance"] ?? "";
    const C = payload["Konzentration"] ?? "EDP";
    const D = payload["%/1"] ?? "";
    const E = payload["Duft 1"] ?? "";
    const G = payload["%/2"] ?? "";
    const H = payload["Duft 2"] ?? "";
    const J = payload["%/3"] ?? "";
    const K = payload["Duft 3"] ?? "";
    const N = payload["Format ml"] ?? ""; // number
    const O = payload["Datum Kauf"] ?? ""; // TT.MM.JJ
    const P = payload["Bemerkungen"] ?? "";
    // New: store customer email in column AH (Excel header in row 2 must exist)
    const AH = payload["Email"] ?? "";

    // We write in segments to avoid overwriting formula columns F/I/L/M.
    // Segment 1: A:E
    await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='A${nextRow}:E${nextRow}')`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[A, B, C, D, E]] })
    });

    // Segment 2: G:H
    await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='G${nextRow}:H${nextRow}')`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[G, H]] })
    });

    // Segment 3: J:K
    await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='J${nextRow}:K${nextRow}')`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[J, K]] })
    });

    // Segment 4: N:P
    await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='N${nextRow}:P${nextRow}')`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[N, O, P]] })
    });

    // Segment 5: AH (Email)
    await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='AH${nextRow}:AH${nextRow}')`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[AH]] })
    });

    // 3) read computed cells F/I/L/M
    const computed = await graph(access_token, `/me/drive/root:/${encodeURI(process.env.ONEDRIVE_EXCEL_PATH)}:/workbook/worksheets('${sheet}')/range(address='F${nextRow}:M${nextRow}')?$select=values`);
    const row = (computed?.values && computed.values[0]) ? computed.values[0] : [];
    // F..M
    const result = {
      row: nextRow,
      "g Duft 1": row[0] ?? "",
      // G col is index 1 etc, but we only return needed:
      "g Duft 2": row[3] ?? "", // I is 4th in F..M
      "g Duft 3": row[6] ?? "", // L is 7th
      "Total %": row[7] ?? ""   // M is 8th
    };

    return { statusCode: 200, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify({ ok: true, row: nextRow, computed: result }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}