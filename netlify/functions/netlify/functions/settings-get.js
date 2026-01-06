import { json, corsHeaders, handleOptions, getAccessTokenOrThrow, graph, downloadFile } from "./_util.js";

export async function handler(event, context) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;
    const p = encodeURI(process.env.ONEDRIVE_SETTINGS_PATH);
    const r = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${p}:/content`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });
    if (!r.ok) {
      // default
      return { statusCode: 200, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify({
        printer: { ip: "", port: 8008 },
        receipt: { logoBase64:"", headerText:"La Profumoteca GmbH\nSolothurn", qrUrl:"https://laprofumoteca.ch", footerText:"Danke für Ihren Besuch\nIhre Rezeptur ist online nachbestellbar" }
      })};
    }
    const txt = await r.text();
    const obj = JSON.parse(txt);
    // never expose token fields
    if (obj._token) delete obj._token;
    return { statusCode: 200, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify(obj) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}
