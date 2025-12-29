import { json, corsHeaders, handleOptions, buildAuthUrl } from "./_util.js";

export async function handler(event, context) {
  const resHeaders = corsHeaders();
  if (handleOptions(event, { setHeader:()=>{}, end:()=>{}, statusCode:204 })) {}

  const state = "lp_" + Date.now();
  const url = buildAuthUrl(state);

  return {
    statusCode: 200,
    headers: { ...resHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ authUrl: url })
  };
}