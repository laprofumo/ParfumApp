// netlify/functions/shopify-customer-find-or-create.js
// Purpose: Find or create a Shopify customer via the existing Render backend (API-key protected).

import { corsHeaders } from "./_util.js";

export async function handler(event) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { firstName, lastName, email } = JSON.parse(event.body || "{}");

    const normEmail = String(email || "").trim().toLowerCase();
    if (!normEmail) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "email is required" }) };
    }

    const baseUrl = process.env.RENDER_BASE_URL || "https://shopify-middleware-ehze.onrender.com";
    const apiKey = process.env.RENDER_API_KEY;

    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing RENDER_API_KEY" }) };
    }

    // 1) Search
    const query = `email:${normEmail}`;
    const searchRes = await fetch(`${baseUrl}/search-customer?query=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: { "X-API-KEY": apiKey }
    });

    const searchJson = await searchRes.json().catch(() => ({}));
    const customers = Array.isArray(searchJson?.customers) ? searchJson.customers : [];

    if (searchRes.ok && customers.length > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: "existing", customer: customers[0], email: normEmail })
      };
    }

    // 2) Create
    const createRes = await fetch(`${baseUrl}/create-customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email: normEmail
      })
    });

    const createJson = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      return {
        statusCode: createRes.status,
        headers,
        body: JSON.stringify({ error: "Create customer failed", details: createJson })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ status: "created", customer: createJson, email: normEmail })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
}
