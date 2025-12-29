import { exchangeCodeForToken, encryptToken } from "./_util.js";

export async function handler(event, context) {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const error = params.error;

  if (error) {
    return { statusCode: 400, body: `Auth error: ${error} ${params.error_description || ""}` };
  }
  if (!code) {
    return { statusCode: 400, body: "Missing code" };
  }

  try {
    const t = await exchangeCodeForToken(code);
    // Encrypt refresh token and display to admin to set as Netlify env var `ENC_REFRESH_TOKEN`.
    const enc = encryptToken(t.refresh_token);

    const html = `<!doctype html>
<html><body style="font-family:system-ui;max-width:720px;margin:40px auto;">
<h2>Microsoft verbunden ✅</h2>
<p>Bitte setze diese Netlify Environment Variable:</p>
<pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px;">ENC_REFRESH_TOKEN=${enc}</pre>
<p>Danach kannst du die Seite schließen. (Kein weiteres Login nötig.)</p>
</body></html>`;
    return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: html };
  } catch (e) {
    return { statusCode: 500, body: `Callback failed: ${e.message}` };
  }
}