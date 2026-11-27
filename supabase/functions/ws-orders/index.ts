import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://top-up-pozn.onrender.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin"
};

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function dbHeaders(prefer?: string) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
  if (!serviceKey) throw new Error("Database service credentials unavailable");
  const headers: Record<string, string> = {
    "apikey": serviceKey,
    "Content-Type": "application/json"
  };
  if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${serviceKey}`;
  if (prefer) headers.Prefer = prefer;
  return headers;
}

const baseUrl = Deno.env.get("SUPABASE_URL");
if (!baseUrl) throw new Error("Supabase URL unavailable");

const SUPABASE_PUBLIC_KEY = Deno.env.get("SUPABASE_ANON_KEY")
  ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")
  ?? "sb_publishable_PWazO_gIfTzIzgNUnuWiSQ_82Jzp_p-";

function isPublicApiToken(token: string) {
  if (token === SUPABASE_PUBLIC_KEY || token.startsWith("sb_publishable_")) return true;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "anon";
  } catch {
    return false;
  }
}

async function getCustomerUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token || isPublicApiToken(token)) return null;

  const authResponse = await fetch(`${baseUrl}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!authResponse.ok) throw new Error("Customer login session is invalid or expired");
  const user = await authResponse.json().catch(() => null);
  const id = String(user?.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new Error("Customer login session could not be verified");
  return id;
}

async function famGatewayRequest(path: string, init: RequestInit = {}) {
  const apiKey = Deno.env.get("FAMGATEWAY_API_KEY");
  if (!apiKey) throw new Error("FamGateway API key is not configured in Supabase Edge Function secrets");
  const headers = new Headers(init.headers || {});
  headers.set("X-Api-Key", apiKey);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`https://famgateway.in${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const raw = await res.text();
  let data: any = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("FamGateway returned an invalid response"); }
  if (!res.ok) {
    console.error("FamGateway request failed", res.status, data?.status || "unknown");
    throw new Error("FamGateway could not process the payment request (HTTP " + res.status + ")");
  }
  return data;
}

function jubalyHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function jubalyQuery(params: URLSearchParams) {
  return [...params.entries()].sort(([a,av],[b,bv]) => a === b ? av.localeCompare(bv) : a.localeCompare(b))
    .map(([k,v]) => encodeURIComponent(k).replace(/[!'()*]/g,c => "%" + c.charCodeAt(0).toString(16).toUpperCase()) + "=" +
      encodeURIComponent(v).replace(/[!'()*]/g,c => "%" + c.charCodeAt(0).toString(16).toUpperCase())).join("&");
}
async function jubalyRequest(method: string, route: string, params = new URLSearchParams(), body: any = null) {
  const apiKey = Deno.env.get("JUBALY_API_KEY")?.trim();
  const secret = Deno.env.get("JUBALY_API_SECRET")?.trim();
  if (!apiKey || !secret) throw new Error("Jubaly API credentials are not configured");
  const verb = method.toUpperCase();
  const timestamp = String(Math.floor(Date.now()/1000));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = [...nonceBytes].map(b=>b.toString(16).padStart(2,"0")).join("");
  const query = jubalyQuery(params);
  const rawBody = body === null ? "" : JSON.stringify(body);
  const message = [timestamp,verb,route,query,nonce,rawBody].join("\n");
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature = jubalyHex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));
  const url = "https://jubaly.com/wp-json" + route + (query ? "?" + query : "");
  const res = await fetch(url,{method:verb,headers:{
    "X-JBL-Key":apiKey,"X-JBL-Timestamp":timestamp,"X-JBL-Nonce":nonce,"X-JBL-Signature":signature,
    "Accept":"application/json","Content-Type":"application/json"
  },body:rawBody || undefined,signal:AbortSignal.timeout(20000)});
  const raw = await res.text(); let data:any={};
  try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Jubaly returned invalid JSON (HTTP "+res.status+")"); }
  if (!res.ok || data?.success === false) {
    const code = String(data?.error?.code || data?.code || "unknown");
    console.error("Jubaly request failed",verb,route,res.status,code);
    const e:any = new Error(String(data?.error?.message || data?.message || "Jubaly request failed"));
    e.status=res.status; e.code=code; e.details=data?.error?.details || null; throw e;
  }
  return data?.data ?? data;
}

async function getUsdReferenceRates() {
  const res = await fetch("https://api.frankfurter.dev/v2/rates?base=USD&quotes=INR,BDT", {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
    cache: "no-store"
  });
  if (!res.ok) throw new Error("Live reference exchange rates are unavailable");
  const rows = await res.json();
  const list = Array.isArray(rows) ? rows : [rows];
  const rates: Record<string, number> = {};
  let rateDate = "";
  for (const row of list) {
    const quote = String(row?.quote || "").toUpperCase();
    const rate = Number(row?.rate);
    if ((quote === "INR" || quote === "BDT") && Number.isFinite(rate) && rate > 0) {
      rates[quote] = rate;
      if (String(row?.date || "") > rateDate) rateDate = String(row.date);
    }
  }
  if (!rates.INR || !rates.BDT) throw new Error("Required INR/BDT reference exchange rates are missing");
  return { usd_to_inr: rates.INR, usd_to_bdt: rates.BDT, date: rateDate, source: "Frankfurter reference rates" };
}
function supplierCostInr(cost: number, accountCurrency: string, jubalyUsdRate: unknown, fx: {usd_to_inr:number}) {
  const currency = String(accountCurrency || "").toUpperCase();
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(fx.usd_to_inr) || fx.usd_to_inr <= 0) return null;
  if (currency === "USD") return cost * fx.usd_to_inr;
  if (currency === "BDT") {
    const bdtPerUsd = Number(jubalyUsdRate);
    if (!Number.isFinite(bdtPerUsd) || bdtPerUsd <= 0) return null;
    return (cost / bdtPerUsd) * fx.usd_to_inr;
  }
  return null;
}

function isUnavailableJubalyVariation(variation: any) {
  const status = String(variation?.stock_status || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const rawStock = variation?.stock_quantity ?? variation?.stock;
  const numericStock = rawStock === null || rawStock === undefined || rawStock === "" ? null : Number(rawStock);
  const hasNumericStock = numericStock !== null && Number.isFinite(numericStock);
  return variation?.enabled === false || variation?.purchasable === false || variation?.in_stock === false ||
    ["outofstock", "out_of_stock", "sold_out", "unavailable", "not_available", "disabled", "inactive"].includes(status) ||
    (hasNumericStock && numericStock <= 0 && variation?.in_stock !== true);
}
function findJubalyVariation(variations: any[], identifier: unknown) {
  const wanted = String(identifier ?? "").trim();
  if (!wanted) return null;
  return (Array.isArray(variations) ? variations : []).find((variation: any) =>
    [variation?.sku, variation?.variation_id, variation?.id]
      .some((value: any) => value !== undefined && value !== null && String(value).trim() === wanted)
  ) ?? null;
}

function validateJubalyMetadata(product: any, metadata: any): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "Invalid customer details";
  }
  const fields = Array.isArray(product?.required_fields) ? product.required_fields : [];
  for (const field of fields) {
    const key = String(field?.key || "");
    const value = metadata[key];
    const present = value !== undefined && value !== null && String(value).trim() !== "";
    if (field?.required !== false && !present) return "Missing required Jubaly field: " + key;
    if (present && String(field?.type || "").toLowerCase() === "select" && Array.isArray(field.options)) {
      const allowed = field.options.some((option: any) => {
        if (option && typeof option === "object") {
          return [option.value, option.id, option.name, option.label]
            .filter((v: any) => v !== undefined && v !== null)
            .some((v: any) => String(v) === String(value));
        }
        return String(option) === String(value);
      });
      if (!allowed) return "Invalid Jubaly option for field: " + key;
    }
  }
  return null;
}

async function submitJubalyOrder(order: any) {
  if (!order.jubaly_product_id || !order.jubaly_variation_id || order.payment_status !== "paid" || order.jubaly_order_id) return order;
  const clientNo = String(order.jubaly_client_order_no || ("ws-topup-" + order.id));
  if (!order.jubaly_client_order_no) order = await updateOrder(order.id,{jubaly_client_order_no:clientNo,jubaly_order_status:"submitting"});
  try {
    const params = new URLSearchParams();
    const detail = await jubalyRequest("GET","/jubaly/v1/products/"+encodeURIComponent(String(order.jubaly_product_id)));
    const product = detail?.product || detail;
    if (product.api_orderable === false) throw new Error("This Jubaly product is not API-orderable");
    if (product.purchasable === false) throw new Error("This Jubaly product is not purchasable");
    const variations = Array.isArray(product.variations) ? product.variations : [];
    const variation = findJubalyVariation(variations, order.jubaly_variation_id);
    if (!variation) throw new Error("Jubaly package variation no longer exists");
    if (isUnavailableJubalyVariation(variation))
      throw new Error("Selected Jubaly package is unavailable");
    const me = await jubalyRequest("GET","/jubaly/v1/me");
    const currency = String(me.account_currency || me.currency || "").toUpperCase();
    const supplierCost = Number(variation.reseller_price);
    const referenceFx = await getUsdReferenceRates();
    const supplierInr = supplierCostInr(supplierCost, currency, me.usd_rate, referenceFx);
    if (supplierInr === null)
      throw new Error("Jubaly reseller price or wallet currency is unavailable");
    const minRetailInr = Math.ceil(supplierInr * 1.15);
    const paidInr = Number(order.amount_paise)/100;
    if (!Number.isFinite(paidInr) || paidInr < minRetailInr)
      throw new Error("Paid amount is below the current Jubaly cost plus safety margin; supplier order paused");
    const metadata = order.jubaly_checkout_fields && typeof order.jubaly_checkout_fields === "object" ? order.jubaly_checkout_fields : {};
    const metadataError = validateJubalyMetadata(product, metadata);
    if (metadataError) throw new Error(metadataError);
    const payload:any = {client_order_no:clientNo,product_id:Number(order.jubaly_product_id),variation_id:String(variation.variation_id ?? variation.id ?? order.jubaly_variation_id),quantity:1,type:"topup",metadata};
    if (variation.sku) { delete payload.product_id; delete payload.variation_id; payload.sku=String(variation.sku); }
    let result:any;
    try {
      result = await jubalyRequest("POST","/jubaly/v1/orders",new URLSearchParams(),payload);
    } catch (postError:any) {
      // A timeout or lost response must not cause a duplicate debit: look up the stable client reference first.
      const found = await jubalyRequest("GET","/jubaly/v1/orders",new URLSearchParams({client_order_no:clientNo}));
      const list = Array.isArray(found.orders) ? found.orders : [];
      if (!list.length) throw postError;
      result = list[0];
    }
    const supplierId = String(result.jbl_order_id ?? result.id ?? "");
    if (!supplierId) throw new Error("Jubaly did not return a confirmed order ID");
    return await updateOrder(order.id,{
      jubaly_order_id:supplierId,
      jubaly_order_status:String(result.status || "processing").slice(0,50),
      jubaly_submitted_at:new Date().toISOString(),
      jubaly_error:null,
      order_status:"processing"
    });
  } catch(error) {
    const message = error instanceof Error ? error.message : "Jubaly order failed";
    console.error("Jubaly supplier order failed for local order",order.id,message);
    return await updateOrder(order.id,{jubaly_order_status:"submission_failed",jubaly_error:message.slice(0,240)});
  }
}

async function updateOrder(id: number, patch: Record<string, unknown>) {
  const r = await fetch(`${baseUrl}/rest/v1/orders?id=eq.${id}`, {
    method: "PATCH",
    headers: dbHeaders("return=representation"),
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() })
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(data) || !data[0]) {
    console.error("Order update failed", r.status);
    throw new Error("Could not update the order record");
  }
  return data[0];
}

async function refreshJubalyOrder(order: any) {
  if (!order.jubaly_order_id) return await submitJubalyOrder(order);
  try {
    const latest = await jubalyRequest("GET","/jubaly/v1/orders/"+encodeURIComponent(String(order.jubaly_order_id)));
    const status = String(latest.status || order.jubaly_order_status || "processing").slice(0,50);
    const normalizedStatus = status.toLowerCase().trim();
    const localStatus = ["completed", "complete", "success"].includes(normalizedStatus) ? "completed" :
      ["cancelled","canceled","refunded","failed","error"].includes(normalizedStatus) ? "cancelled" : "processing";
    return await updateOrder(order.id,{jubaly_order_status:status,order_status:localStatus,jubaly_error:latest.failure?.message || null});
  } catch(error) {
    console.error("Jubaly status refresh failed for local order",order.id,error instanceof Error?error.message:"unknown");
    return order;
  }
}
async function verifyFamGatewayOrder(order: any) {
  if (order.payment_status === "paid") {
    if (order.jubaly_product_id) return order.jubaly_order_id ? await refreshJubalyOrder(order) : await submitJubalyOrder(order);
    // Legacy Vertex orders stay visible in history but are no longer sent to a supplier.
    return order;
  }
  if (!order.famgateway_order_id) return order;
  const query = "?order_id=" + encodeURIComponent(order.famgateway_order_id);
  const result = await famGatewayRequest("/api/verify-order.php" + query);
  const details = result?.data || {};
  const gatewayStatus = String(details.status || result.status || "pending").toLowerCase();
  const isPaid = gatewayStatus === "success" || details.is_paid === true;
  if (!isPaid) {
    if (gatewayStatus === "expired" && order.famgateway_status !== "expired") {
      return await updateOrder(order.id, { famgateway_status: "expired" });
    }
    if (gatewayStatus === "pending" && order.famgateway_status !== "pending") {
      return await updateOrder(order.id, { famgateway_status: "pending" });
    }
    return order;
  }

  const paidAmount = Number(details.amount ?? result.amount);
  const expectedAmount = Number(order.amount_paise) / 100;
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - expectedAmount) > 0.009) {
    console.error("FamGateway amount mismatch for local order", order.id);
    return await updateOrder(order.id, { famgateway_status: "amount_mismatch" });
  }

  const paidOrder = await updateOrder(order.id, {
    payment_status: "paid",
    payment_gateway: "famgateway",
    payment_verified_at: new Date().toISOString(),
    famgateway_status: "success",
    famgateway_utr: String(details.utr || "").slice(0, 80) || null,
    famgateway_transaction_id: String(details.transaction_id || "").slice(0, 100) || null
  });
  return paidOrder.jubaly_product_id ? await submitJubalyOrder(paidOrder) : paidOrder;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.headers.get("origin") !== "https://top-up-pozn.onrender.com") {
    return response({ error: "Origin not allowed" }, 403);
  }

  try {
    const url = new URL(req.url);

    if (req.method === "POST") {
      const b = await req.json();
      const required = ["product_key", "product_name", "package_name", "amount", "account_label", "account_id"];
      if (required.some((k) => b[k] === undefined || String(b[k]).trim() === "")) {
        return response({ error: "Missing order information" }, 400);
      }
      let amount = Number(b.amount);
      const isJubaly = String(b.product_key).startsWith("jubaly:");
      if (!isJubaly) {
        return response({ error: "This product is not connected to a verified live supplier listing." }, 409);
      }
      let jubalyProduct:any = null;
      let jubalyVariation:any = null;
      if (isJubaly) {
        if (!/^\d+$/.test(String(b.jubaly_product_id || "")) || !/^[A-Za-z0-9_.:-]{1,120}$/.test(String(b.jubaly_variation_id || "")) || String(b.product_key) !== "jubaly:" + String(b.jubaly_product_id))
          return response({ error: "Invalid Jubaly product or package" }, 400);
        const detail = await jubalyRequest("GET","/jubaly/v1/products/"+encodeURIComponent(String(b.jubaly_product_id)));
        jubalyProduct = detail?.product || detail;
        if (jubalyProduct.api_orderable === false || jubalyProduct.purchasable !== true)
          return response({ error: "This Jubaly product is not available for API ordering." }, 409);
        const variations = Array.isArray(jubalyProduct.variations) ? jubalyProduct.variations : [];
        jubalyVariation = findJubalyVariation(variations, b.jubaly_variation_id);
        if (!jubalyVariation || isUnavailableJubalyVariation(jubalyVariation))
          return response({ error: "Selected Jubaly package is unavailable." }, 409);
        const metadataError = validateJubalyMetadata(jubalyProduct, b.jubaly_checkout_fields ?? {});
        if (metadataError) return response({ error: metadataError }, 400);
        const me = await jubalyRequest("GET","/jubaly/v1/me");
        const accountCurrency = String(me.account_currency || me.currency || "").toUpperCase();
        const supplierCost = Number(jubalyVariation.reseller_price);
        const referenceFx = await getUsdReferenceRates();
        const supplierInr = supplierCostInr(supplierCost, accountCurrency, me.usd_rate, referenceFx);
        if (supplierInr === null)
          return response({ error: "Jubaly price or wallet currency could not be verified." }, 502);
        const serverPrice = Math.ceil(supplierInr * 1.15);
        if (!Number.isFinite(amount) || Math.abs(amount-serverPrice)>1)
          return response({ error: "Jubaly package price changed. Refresh and try again." }, 409);
        amount = serverPrice;
      }
      if (!Number.isFinite(amount) || amount < 1 || amount > 1000000) {
        return response({ error: "Invalid INR amount" }, 400);
      }
      if (String(b.account_id).length > 100 || String(b.package_name).length > 100) {
        return response({ error: "Input too long" }, 400);
      }

      const paymentMethod = String(b.payment_method || "").trim().toLowerCase();
      const isWalletPayment = paymentMethod === "wallet";
      const isUsdtTron = !isWalletPayment && paymentMethod === "usdt_tron";
      const isBangladeshBkash = !isWalletPayment && !isUsdtTron && String(b.country || "").trim().toLowerCase() === "bangladesh";
      let manualBdtAmount: number | null = null;
      let manualUsdAmount: number | null = null;
      let manualSender: string | null = null;
      let manualTransaction: string | null = null;
      if (isUsdtTron) {
        manualSender = String(b.manual_sender_number || "").trim();
        manualTransaction = String(b.manual_transaction_id || "").trim();
        if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(manualSender)) return response({ error: "Enter a valid TRON sender wallet address." }, 400);
        if (!/^[a-fA-F0-9]{64}$/.test(manualTransaction)) return response({ error: "Enter a valid 64-character TRON transaction hash." }, 400);
        const fx = await getUsdReferenceRates();
        manualUsdAmount = Math.round((amount / fx.usd_to_inr) * 100) / 100;
        if (!(manualUsdAmount > 0)) return response({ error: "USDT amount could not be calculated." }, 502);
      }
      if (isBangladeshBkash) {
        let sender = String(b.manual_sender_number || "").trim().replace(/[\s().-]/g, "");
        if (sender.startsWith("+880")) sender = "0" + sender.slice(4);
        else if (sender.startsWith("880")) sender = "0" + sender.slice(3);
        const transactionId = String(b.manual_transaction_id || "").trim();
        if (!/^01[3-9]\d{8}$/.test(sender)) return response({ error: "Enter a valid Bangladesh sender mobile number (01XXXXXXXXX or +8801XXXXXXXXX)." }, 400);
        if (!/^[A-Za-z0-9-]{4,40}$/.test(transactionId)) return response({ error: "Enter a valid bKash Transaction ID." }, 400);
        const fx = await getUsdReferenceRates();
        manualBdtAmount = Math.round((amount * fx.usd_to_bdt / fx.usd_to_inr) * 100) / 100;
      }

      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      const publicToken = Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
      let customerId: string | null = null;
      try {
        customerId = await getCustomerUserId(req);
      } catch {
        return response({ error: "Your login session expired. Please log in again and submit the order." }, 401);
      }
      const insert = {
        wallet_request_id: isWalletPayment ? String(b.wallet_request_id || "").slice(0, 80) : null,
        user_id: customerId,
        product_key: String(b.product_key).slice(0, 50),
        product_name: String(b.product_name).slice(0, 120),
        package_name: String(b.package_name).slice(0, 100),
        amount_paise: Math.round(amount * 100),
        account_label: String(b.account_label).slice(0, 80),
        account_id: String(b.account_id).slice(0, 100),
        country: String(b.country || "").slice(0, 80) || null,
        customer_name: String(b.customer_name || "").slice(0, 100),
        customer_phone: String(b.customer_phone || "").slice(0, 30),
        payment_status: "unpaid",
        order_status: "pending",
        public_token: publicToken,
        payment_gateway: isUsdtTron ? "usdt_tron_manual" : isBangladeshBkash ? "bkash_manual" : "famgateway",
        famgateway_status: (isBangladeshBkash || isUsdtTron) ? null : "pending",
        manual_payment_method: isUsdtTron ? "usdt_tron" : isBangladeshBkash ? "bkash" : null,
        manual_sender_number: isUsdtTron ? manualSender : isBangladeshBkash ? (() => { let n=String(b.manual_sender_number||"").trim().replace(/[\s().-]/g,""); return n.startsWith("+880") ? "0"+n.slice(4) : n.startsWith("880") ? "0"+n.slice(3) : n; })() : null,
        manual_transaction_id: (isBangladeshBkash || isUsdtTron) ? String(b.manual_transaction_id).trim() : null,
        manual_payment_amount: isUsdtTron ? manualUsdAmount : isBangladeshBkash ? manualBdtAmount : null,
        manual_payment_submitted_at: (isBangladeshBkash || isUsdtTron) ? new Date().toISOString() : null,
        jubaly_product_id: isJubaly ? String(b.jubaly_product_id) : null,
        jubaly_variation_id: isJubaly ? String(b.jubaly_variation_id) : null,
        jubaly_checkout_fields: isJubaly && b.jubaly_checkout_fields && typeof b.jubaly_checkout_fields === "object" ? b.jubaly_checkout_fields : null
      };
      if (isWalletPayment) {
        if (!customerId) return response({ error: "Wallet দিয়ে অর্ডার করতে Login করতে হবে।" }, 401);
        if (!/^[0-9a-f-]{36}$/i.test(String(b.wallet_request_id || ""))) return response({ error: "Wallet checkout request is invalid. আবার চেষ্টা করো।" }, 400);
        const walletResponse = await fetch(`${baseUrl}/rest/v1/rpc/spend_wallet_for_order`, {
          method: "POST",
          headers: dbHeaders(),
          body: JSON.stringify({ p_user_id: customerId, p_order: insert }),
          signal: AbortSignal.timeout(15000)
        });
        const walletResult = await walletResponse.json().catch(() => null);
        if (!walletResponse.ok || !walletResult?.id) {
          const rawMessage = String(walletResult?.message || walletResult?.details || "");
          const insufficient = rawMessage.toLowerCase().includes("insufficient wallet balance");
          return response({ error: insufficient ? "Wallet-এ পর্যাপ্ত ব্যালেন্স নেই। আগে Add Money করো।" : "Wallet payment সম্পন্ন হয়নি। টাকা কাটা হয়নি; আবার চেষ্টা করো।" }, insufficient ? 402 : 500);
        }
        const orderFetch = await fetch(`${baseUrl}/rest/v1/orders?select=*&id=eq.${walletResult.id}&limit=1`, { headers: dbHeaders(), signal: AbortSignal.timeout(10000) });
        const orderRows = await orderFetch.json().catch(() => null);
        if (!orderFetch.ok || !Array.isArray(orderRows) || !orderRows[0]) {
          console.error("Wallet order saved but details could not be reloaded", walletResult.id);
          return response({ id: walletResult.id, public_token: walletResult.public_token, payment_status: "paid", order_status: "processing", wallet_balance_paise: walletResult.balance_paise, message: "Wallet payment received. Order is being checked." }, 201);
        }
        const fulfilled = await submitJubalyOrder(orderRows[0]);
        return response({
          id: fulfilled.id,
          public_token: fulfilled.public_token,
          amount_paise: fulfilled.amount_paise,
          payment_status: fulfilled.payment_status,
          order_status: fulfilled.order_status,
          jubaly_order_status: fulfilled.jubaly_order_status,
          wallet_balance_paise: walletResult.balance_paise,
          message: "Wallet payment received. Supplier order status is being updated."
        }, 201);
      }
      const r = await fetch(`${baseUrl}/rest/v1/orders?select=id,order_status,payment_status,created_at,public_token,amount_paise`, {
        method: "POST", headers: dbHeaders("return=representation"), body: JSON.stringify(insert)
      });
      const rows = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(rows) || !rows[0]) {
        const duplicateTransaction = r.status === 409 || String(rows?.code || "") === "23505";
        console.error("Order insert failed", r.status, duplicateTransaction ? "duplicate transaction" : "database error");
        return response({ error: duplicateTransaction ? "This bKash Transaction ID has already been submitted." : "Order could not be saved. Please try again later." }, duplicateTransaction ? 409 : 500);
      }

      const order = rows[0];
      if (isBangladeshBkash) {
        return response({
          id: order.id,
          public_token: order.public_token,
          amount_paise: order.amount_paise,
          manual_payment_method: "bkash",
          manual_payment_amount: manualBdtAmount,
          payment_status: "unpaid",
          order_status: "pending",
          message: "Order submitted. Please wait for manual payment verification."
        }, 201);
      }
      if (isUsdtTron) {
        return response({
          id: order.id,
          public_token: order.public_token,
          amount_paise: order.amount_paise,
          manual_payment_method: "usdt_tron",
          manual_payment_amount: manualUsdAmount,
          payment_currency: "USDT",
          network: "TRON",
          payment_status: "unpaid",
          order_status: "pending",
          message: "Order submitted. Please wait for manual USDT payment verification."
        }, 201);
      }
      try {
        const created = await famGatewayRequest("/api/create-order", {
          method: "POST",
          body: JSON.stringify({
            amount: Number(order.amount_paise) / 100,
            redirect_url: "https://top-up-pozn.onrender.com/order.html?ref=" + publicToken
          })
        });
        const gatewayOrder = created?.data || {};
        const gatewayId = String(gatewayOrder.order_id || "");
        const checkoutUrl = String(gatewayOrder.checkout_url || "");
        const payableAmount = Number(gatewayOrder.payable_amount ?? gatewayOrder.amount);
        if (created.status !== "success" || !gatewayId || !checkoutUrl.startsWith("https://famgateway.in/") || !Number.isFinite(payableAmount) || payableAmount < 1) {
          console.error("FamGateway create-order response incomplete");
          return response({ error: "FamGateway did not return a valid checkout link. Please contact support; do not pay manually." }, 502);
        }
        const saved = await updateOrder(order.id, {
          famgateway_order_id: gatewayId,
          famgateway_checkout_url: checkoutUrl,
          famgateway_status: "pending",
          amount_paise: Math.round(payableAmount * 100),
          payment_gateway: "famgateway"
        });
        return response({
          ...saved,
          checkout_url: checkoutUrl,
          famgateway_order_id: gatewayId
        }, 201);
      } catch (error) {
        console.error("FamGateway order creation failed", error);
        const message = error instanceof Error ? error.message : "Payment gateway unavailable";
        return response({ error: message + ". Your order was not paid; please try again later." }, 502);
      }
    }

    if (req.method === "GET") {
      if (url.searchParams.get("action") === "manual-settings") {
        // Public merchant receiving number; keep this read independent of database latency.
        const bkashNumber = "01618896284";
        const fx = await getUsdReferenceRates();
        return response({ bkash_number: bkashNumber, payment_method: "bkash", currency: "BDT", inr_to_bdt: fx.usd_to_bdt / fx.usd_to_inr, rate_date: fx.date });
      }
      if (url.searchParams.get("action") === "usdt-settings") {
        const fx = await getUsdReferenceRates();
        return response({ usdt_address: "TUiVtSyyeSwYTcUDmwD4NuCb9JEo2NhiZX", payment_method: "usdt_tron", currency: "USDT", network: "TRON", usd_to_inr: fx.usd_to_inr, rate_date: fx.date });
      }
      const token = url.searchParams.get("ref") || url.pathname.split("/").filter(Boolean).pop();
      if (!token || !/^[a-f0-9]{36}$/.test(token)) return response({ error: "Order not found" }, 404);
      const r = await fetch(`${baseUrl}/rest/v1/orders?select=id,product_name,package_name,amount_paise,payment_status,order_status,created_at,famgateway_order_id,famgateway_status,vertex_order_status,vertex_order_id,vertex_error,vertex_product_id,vertex_variation_id,vertex_client_ref,vertex_checkout_fields,jubaly_product_id,jubaly_variation_id,jubaly_client_order_no,jubaly_order_id,jubaly_order_status,jubaly_error,jubaly_checkout_fields&public_token=eq.${token}&limit=1`, {
        headers: dbHeaders()
      });
      const rows = await r.json().catch(() => null);
      if (!r.ok) {
        console.error("Order lookup failed", r.status);
        return response({ error: "Could not load order status right now." }, 500);
      }
      if (!Array.isArray(rows) || !rows[0]) return response({ error: "Order not found" }, 404);
      let order = rows[0];
      if (order.famgateway_order_id && (order.payment_status !== "paid" || order.vertex_product_id || order.jubaly_product_id)) {
        try {
          order = await verifyFamGatewayOrder(order);
        } catch (error) {
          console.error("FamGateway verification temporarily failed", error);
        }
      }
      return response({
        id: order.id,
        product_name: order.product_name,
        package_name: order.package_name,
        amount_paise: order.amount_paise,
        payment_status: order.payment_status,
        order_status: order.order_status,
        created_at: order.created_at,
        famgateway_status: order.famgateway_status,
        vertex_order_status: order.vertex_order_status,
        vertex_order_id: order.vertex_order_id,
        vertex_error: order.vertex_error,
        jubaly_order_status: order.jubaly_order_status,
        jubaly_order_id: order.jubaly_order_id,
        jubaly_error: order.jubaly_error
      });
    }

    return response({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("Order function failed", error);
    return response({ error: "The order service is temporarily unavailable." }, 500);
  }
});