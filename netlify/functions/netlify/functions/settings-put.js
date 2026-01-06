import { corsHeaders, getAccessTokenOrThrow, uploadFile } from "./_util.js";

export async function handler(event, context) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: "Method not allowed" };

  try {
    const incoming = JSON.parse(event.body || "{}");

    // sanitize
    const settings = {
      printer: {
        ip: String(incoming?.printer?.ip || "").trim(),
        port: Number(incoming?.printer?.port || 8008)
      },
      receipt: {
        logoBase64: String(incoming?.receipt?.logoBase64 || ""),
        headerText: String(incoming?.receipt?.headerText || ""),
        qrUrl: String(incoming?.receipt?.qrUrl || ""),
        footerText: String(incoming?.receipt?.footerText || "")
      }
    };

    const t = await getAccessTokenOrThrow();
    const access_token = t.access_token;

    const bytes = Buffer.from(JSON.stringify(settings, null, 2), "utf8");
    await uploadFile(access_token, process.env.ONEDRIVE_SETTINGS_PATH, bytes, "application/json");

    return { statusCode: 200, headers: { ...headers, "Content-Type":"application/json" }, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
}