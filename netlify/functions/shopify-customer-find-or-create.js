// netlify/functions/shopify-customer-find-or-create.js
import { corsHeaders } from "./_util.js";

export async function handler(event) {
  const headers = corsHeaders();
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers };

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    const { firstName, lastName, email } = JSON.parse(event.body || "{}");

    if (!email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "email is required" }) };
    }

    const baseUrl = process.env.RENDER_BASE_URL;
    const apiKey = process.env.RENDER_API_KEY;

    if (!baseUrl || !apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing RENDER_BASE_URL or RENDER_API_KEY" }) };
    }

    // 1) Kunde suchen (Shopify search über Render)
    // Render erwartet: /search-customer?query=...
    const q = `email:${String(email).trim().toLowerCase()}`;
    const searchRes = await fetch(`${baseUrl}/search-customer?query=${encodeURIComponent(q)}`, {
      method: "GET",
      headers: {
        "X-API-KEY": apiKey
      }
    });

    const searchJson = await searchRes.json().catch(() => ({}));
    const customers = Array.isArray(searchJson?.customers) ? searchJson.customers : [];

    if (customers.length > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: "existing",
          customer: customers[0]
        })
      };
    }

    // 2) Kunde anlegen (Render: /create-customer)
    const createRes = await fetch(`${baseUrl}/create-customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({
        firstName,
        lastName,
        email: String(email).trim().toLowerCase()
      })
    });

    const createJson = await createRes.json().catch(() => ({}));

    if (!createRes.ok) {
      return {
        statusCode: createRes.status,
        headers,
        body: JSON.stringify({
          error: "Create customer failed",
          details: createJson
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: "created",
        customer: createJson
      })
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
}
