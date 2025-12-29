import fetch from "node-fetch";
import crypto from "crypto";

const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const AUTH_URL  = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";

function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function json(res, statusCode, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body);
}

export function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  };
}

export function handleOptions(event, res) {
  if (event.httpMethod === "OPTIONS") {
    res.statusCode = 204;
    for (const [k, v] of Object.entries(corsHeaders())) res.setHeader(k, v);
    res.end();
    return true;
  }
  return false;
}

// AES-256-GCM encryption of token payload (refresh_token)
export function encryptToken(plainText) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error("TOKEN_SECRET missing/too short");
  const key = crypto.createHash("sha256").update(secret).digest(); // 32 bytes
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${b64url(iv)}.${b64url(tag)}.${b64url(enc)}`;
}

export function decryptToken(cipherText) {
  const secret = process.env.TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error("TOKEN_SECRET missing/too short");
  const key = crypto.createHash("sha256").update(secret).digest();
  const [ivB, tagB, encB] = cipherText.split(".").map(s => Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/"), "base64"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivB);
  decipher.setAuthTag(tagB);
  const dec = Buffer.concat([decipher.update(encB), decipher.final()]);
  return dec.toString("utf8");
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: process.env.MS_REDIRECT_URI,
    response_mode: "query",
    scope: "offline_access User.Read Files.ReadWrite",
    state
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.MS_REDIRECT_URI,
    scope: "offline_access User.Read Files.ReadWrite"
  });

  const r = await fetch(TOKEN_URL, { method: "POST", body: params });
  const t = await r.json();
  if (!r.ok) throw new Error(`Token exchange failed: ${r.status} ${JSON.stringify(t)}`);
  return t;
}

export async function refreshAccessToken(refresh_token) {
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token,
    scope: "offline_access User.Read Files.ReadWrite"
  });
  const r = await fetch(TOKEN_URL, { method: "POST", body: params });
  const t = await r.json();
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${JSON.stringify(t)}`);
  return t;
}

export async function graph(access_token, path, { method="GET", headers={}, body=null } = {}) {
  const r = await fetch(`${GRAPH}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access_token}`,
      ...headers
    },
    body
  });
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!r.ok) throw new Error(`Graph error ${r.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

// OneDrive: read file content by path
export async function readFile(access_token, drivePath) {
  const p = encodeURI(drivePath);
  return await graph(access_token, `/me/drive/root:/${p}:/content`, { method: "GET" });
}

// OneDrive: download raw bytes (for JSON)
export async function downloadFile(access_token, drivePath) {
  const p = encodeURI(drivePath);
  const r = await fetch(`${GRAPH}/me/drive/root:/${p}:/content`, {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  if (!r.ok) throw new Error(`Download failed ${r.status}`);
  const buf = await r.arrayBuffer();
  return Buffer.from(buf);
}

// OneDrive: upload bytes to file path (create/replace)
export async function uploadFile(access_token, drivePath, bytes, contentType="application/json") {
  const p = encodeURI(drivePath);
  const r = await fetch(`${GRAPH}/me/drive/root:/${p}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": contentType
    },
    body: bytes
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Upload failed ${r.status} ${JSON.stringify(data)}`);
  return data;
}

// Load settings.json which will also store encrypted refresh token.
export async function loadCentralSettings(access_token) {
  const settingsPath = process.env.ONEDRIVE_SETTINGS_PATH;
  try {
    const buf = await downloadFile(access_token, settingsPath);
    const txt = buf.toString("utf8");
    return JSON.parse(txt);
  } catch (e) {
    // Create default settings if missing
    return {
      printer: { ip: "", port: 8008 },
      receipt: {
        logoBase64: "",
        headerText: "La Profumoteca GmbH\nSolothurn",
        qrUrl: "https://laprofumoteca.ch",
        footerText: "Danke für Ihren Besuch\nIhre Rezeptur ist online nachbestellbar"
      },
      _token: { encRefreshToken: "" }
    };
  }
}

export async function saveCentralSettings(access_token, settingsObj) {
  const settingsPath = process.env.ONEDRIVE_SETTINGS_PATH;
  const bytes = Buffer.from(JSON.stringify(settingsObj, null, 2), "utf8");
  return await uploadFile(access_token, settingsPath, bytes, "application/json");
}

// Get access token by decrypting stored refresh token inside settings.json
export async function getAccessTokenOrThrow() {
  // We need *some* access token to read settings.json; on first run user must authorize.
  // So this function reads settings using a "bootstrap" token from env is not available.
  // Instead: we store refresh token in settings.json AFTER first auth. Subsequent calls use it.
  // Implementation: read settings with refresh token not possible. Therefore we keep a copy
  // of encRefreshToken also in Netlify Function persisted cache is not available.
  // Workaround: keep encRefreshToken in settings.json and access settings.json by using
  // the refresh token to fetch a new access token (no need to read settings first).
  // But we must *have* the refresh token at runtime. So we read it from settings.json
  // using a lightweight unauthenticated endpoint? Not possible.
  // => We instead store encrypted refresh token in a Netlify env var after first auth
  // OR store it in a file in the function bundle (not writable).
  // Chosen: store in settings.json *and* echo it back to admin so they set env var once.
  // For "no-login" operation, set ENV `ENC_REFRESH_TOKEN` once.
  const enc = process.env.ENC_REFRESH_TOKEN;
  if (!enc) throw new Error("ENC_REFRESH_TOKEN is missing. Run /auth-start once, then set ENC_REFRESH_TOKEN env var.");
  const refresh_token = decryptToken(enc);
  const t = await refreshAccessToken(refresh_token);
  // If Microsoft rotates refresh token, we can't persist without login; but we can still use new refresh_token in response
  return t;
}
