import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ORIGIN = "https://top-up-pozn.onrender.com";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
async function vertex(path: string) {
  const key = Deno.env.get("VERTEX_BAZAAR_API_KEY");
  if (!key) throw new Error("Vertex Bazaar API key is not configured");
  const response = await fetch("https://vertexbazaar.com" + path, {
    method: "GET", headers: { "X-Api-Key": key, "Accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error("Vertex Bazaar returned an invalid response"); }
  if (!response.ok) {
    console.error("Vertex Bazaar catalog request failed", response.status);
    return reply({ error: "Vertex Bazaar catalog request failed", upstream_status: response.status }, 502);
  }
  return reply(data);
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return reply({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("origin");
  if (origin && origin !== ORIGIN) return reply({ error: "Origin not allowed" }, 403);
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "categories";
    if (action === "categories") return await vertex("/api/v1/reseller/categories");
    if (action === "products") {
      const group = url.searchParams.get("group") || "top_up";
      if (!["top_up", "digital_gift_card"].includes(group)) return reply({ error: "Invalid product group" }, 400);
      const n = Number(url.searchParams.get("page") || "1");
      const page = Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1;
      return await vertex("/api/v1/reseller/products?group=" + encodeURIComponent(group) + "&page=" + page);
    }
    if (action === "product") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return reply({ error: "Invalid product ID" }, 400);
      return await vertex("/api/v1/reseller/products/" + encodeURIComponent(id));
    }
    return reply({ error: "Unknown action. Use categories, products, or product." }, 400);
  } catch (error) {
    console.error("Vertex catalog proxy error", error);
    return reply({ error: error instanceof Error ? error.message : "Catalog service unavailable" }, 503);
  }
});