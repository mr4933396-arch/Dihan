import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const origin = "https://top-up-pozn.onrender.com";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-ws-admin-code",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
};
function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (req.headers.get("origin") !== origin) return reply({ error: "Origin not allowed" }, 403);
  try {
    const base = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
      ?? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
    if (!base || !serviceKey) throw new Error("Admin data source unavailable");
    const dbHeaders: Record<string, string> = { apikey: serviceKey };
    if (!serviceKey.startsWith("sb_secret_")) dbHeaders.Authorization = `Bearer ${serviceKey}`;

    const supplied = req.headers.get("x-ws-admin-code") || "";
    if (supplied.length < 32 || supplied.length > 128) return reply({ error: "অ্যাক্সেস কোড সঠিক নয়।" }, 401);
    const configRes = await fetch(`${base}/rest/v1/admin_access_config?select=code_hash&id=eq.1&limit=1`, {
      headers: dbHeaders, signal: AbortSignal.timeout(10000),
    });
    if (!configRes.ok) throw new Error("Admin access configuration unavailable");
    const configs = await configRes.json();
    if (!Array.isArray(configs) || !configs[0]?.code_hash || !safeEqual(await sha256(supplied), String(configs[0].code_hash))) {
      return reply({ error: "অ্যাক্সেস কোড সঠিক নয়।" }, 401);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      const orderId = Number(body?.order_id);
      const action = String(body?.action || "");
      const note = String(body?.note || "").trim().slice(0, 240);
      if (!Number.isSafeInteger(orderId) || orderId < 1 || !["approve", "reject", "complete"].includes(action)) {
        return reply({ error: "Invalid review request." }, 400);
      }
      const isComplete = action === "complete";
      const patch: Record<string, unknown> = isComplete
        ? { order_status: "completed", manual_payment_note: note || "Diamonds delivered manually by admin." }
        : action === "approve"
          ? { payment_status: "paid", payment_verified_at: new Date().toISOString(), order_status: "processing", manual_payment_reviewed_at: new Date().toISOString(), manual_payment_note: note || "Payment manually verified by admin." }
          : { payment_status: "rejected", order_status: "cancelled", manual_payment_reviewed_at: new Date().toISOString(), manual_payment_note: note || "Payment rejected by admin." };
      const reviewFilter = isComplete ? "payment_status=eq.paid&order_status=eq.processing" : "payment_status=eq.unpaid";
      const updateRes = await fetch(`${base}/rest/v1/orders?id=eq.${orderId}&${reviewFilter}&manual_payment_method=in.(bkash,usdt_tron)&select=id,payment_status,order_status,manual_payment_reviewed_at`, {
        method: "PATCH",
        headers: { ...dbHeaders, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(patch),
        signal: AbortSignal.timeout(15000),
      });
      const updated = await updateRes.json().catch(() => null);
      if (!updateRes.ok) throw new Error("Could not update manual payment review");
      if (!Array.isArray(updated) || !updated[0]) return reply({ error: "This order was already reviewed or is not a bKash manual order." }, 409);
      return reply({ success: true, order: updated[0] });
    }

    const url = new URL(req.url);
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const ordersRes = await fetch(
      `${base}/rest/v1/orders?select=id,product_name,package_name,amount_paise,account_label,account_id,country,payment_status,order_status,created_at,payment_gateway,manual_payment_method,manual_sender_number,manual_transaction_id,manual_payment_amount,manual_payment_submitted_at,manual_payment_reviewed_at,manual_payment_note&order=created_at.desc&limit=${limit}`,
      { headers: dbHeaders, signal: AbortSignal.timeout(15000) },
    );
    if (!ordersRes.ok) throw new Error("Could not load order records");
    const rows = await ordersRes.json();
    const orders = rows.map((row: any) => {
      const rawAccount = String(row.account_id || "");
      const countryMatch = rawAccount.match(/(?:^|\s*\|\s*)Country:\s*([^|]+)/i);
      const country = String(row.country || countryMatch?.[1] || "—").trim();
      const accountId = rawAccount.replace(/\s*\|\s*Country:\s*[^|]+/i, "").trim();
      return {
        id: row.id, product_name: row.product_name, package_name: row.package_name,
        amount_paise: row.amount_paise, account_label: row.account_label,
        account_id: accountId, country, payment_status: row.payment_status,
        order_status: row.order_status, created_at: row.created_at,
        payment_gateway: row.payment_gateway, manual_payment_method: row.manual_payment_method,
        manual_sender_number: row.manual_sender_number, manual_transaction_id: row.manual_transaction_id,
        manual_payment_amount: row.manual_payment_amount, manual_payment_submitted_at: row.manual_payment_submitted_at,
        manual_payment_reviewed_at: row.manual_payment_reviewed_at, manual_payment_note: row.manual_payment_note,
      };
    });
    return reply({ orders, count: orders.length, limit, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Private admin order list failed", error);
    return reply({ error: "অর্ডারের তথ্য এখন লোড হচ্ছে না। পরে আবার চেষ্টা করুন।" }, 503);
  }
});