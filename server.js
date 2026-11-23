require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const path = require("path");
const crypto = require("crypto");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes("render.com") ? { rejectUnauthorized: false } : undefined });
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(session({
  store: new PgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 8*60*60*1000 }
}));
app.use(express.static(path.join(__dirname, "public")));
app.get("/product.html", (req,res) => res.sendFile(path.join(__dirname,"product.html")));

// Serve only top-level image assets used by the storefront. Do not expose repository source files.
app.get(/^\/[A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif)$/i, (req, res, next) => {
  const filename = path.basename(req.path);
  res.sendFile(path.join(__dirname, filename), (error) => {
    if (error && !res.headersSent) next();
  });
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS orders (
    id BIGSERIAL PRIMARY KEY,
    product_key TEXT NOT NULL,
    product_name TEXT NOT NULL,
    package_name TEXT NOT NULL,
    amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
    account_label TEXT NOT NULL,
    account_id TEXT NOT NULL,
    customer_name TEXT DEFAULT '',
    customer_phone TEXT DEFAULT '',
    payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid','refunded')),
    order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending','processing','completed','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_token TEXT");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_unique ON orders(public_token) WHERE public_token IS NOT NULL");
}
function auth(req,res,next){ if(req.session?.admin) return next(); return res.status(401).json({error:"Please login"}); }
const loginLimiter = rateLimit({windowMs:15*60*1000,max:8,standardHeaders:true,legacyHeaders:false});

app.post("/api/admin/login", loginLimiter, async (req,res)=>{
  const {username,password}=req.body||{};
  if(!username || !password || username!==process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH)
    return res.status(401).json({error:"Invalid login"});
  if(!await bcrypt.compare(password,process.env.ADMIN_PASSWORD_HASH))
    return res.status(401).json({error:"Invalid login"});
  req.session.admin=true; res.json({ok:true});
});
app.post("/api/admin/logout", auth, (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me", auth, (req,res)=>res.json({ok:true}));
app.get("/api/admin/orders", auth, async (req,res)=>{
  const {status}=req.query;
  const allowed=["pending","processing","completed","cancelled"];
  const result=status && allowed.includes(status)
    ? await pool.query("SELECT * FROM orders WHERE order_status=$1 ORDER BY created_at DESC LIMIT 500",[status])
    : await pool.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500");
  res.json(result.rows);
});
app.get("/api/admin/stats", auth, async (req,res)=>{
  const r=await pool.query(`SELECT COUNT(*)::int total,
    COUNT(*) FILTER (WHERE order_status='pending')::int pending,
    COUNT(*) FILTER (WHERE order_status='processing')::int processing,
    COUNT(*) FILTER (WHERE order_status='completed')::int completed,
    COALESCE(SUM(amount_paise) FILTER (WHERE payment_status='paid'),0)::bigint paid_paise FROM orders`);
  res.json(r.rows[0]);
});
app.patch("/api/admin/orders/:id", auth, async (req,res)=>{
  const {order_status,payment_status}=req.body||{};
  const statuses=["pending","processing","completed","cancelled"];
  const payments=["unpaid","paid","refunded"];
  if(!statuses.includes(order_status)||!payments.includes(payment_status)) return res.status(400).json({error:"Invalid status"});
  const r=await pool.query("UPDATE orders SET order_status=$1,payment_status=$2,updated_at=NOW() WHERE id=$3 RETURNING *",[order_status,payment_status,req.params.id]);
  if(!r.rowCount) return res.status(404).json({error:"Order not found"});
  res.json(r.rows[0]);
});

// Public order request. This records an UNPAID request only; it does not verify or collect payment.
app.post("/api/orders", rateLimit({windowMs:60*1000,max:10}), async (req,res)=>{
  const b=req.body||{};
  const required=["product_key","product_name","package_name","amount","account_label","account_id"];
  if(required.some(k=>b[k]===undefined || String(b[k]).trim()==="")) return res.status(400).json({error:"Missing order information"});
  const amount=Number(b.amount);
  if(!Number.isFinite(amount)||amount<1||amount>1000000) return res.status(400).json({error:"Invalid amount"});
  if(String(b.account_id).length>100 || String(b.package_name).length>100) return res.status(400).json({error:"Input too long"});
  try {
    const publicToken=crypto.randomBytes(18).toString("hex");
    const r=await pool.query(`INSERT INTO orders(product_key,product_name,package_name,amount_paise,account_label,account_id,customer_name,customer_phone,public_token)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,order_status,payment_status,created_at,public_token`,
      [String(b.product_key).slice(0,50),String(b.product_name).slice(0,120),String(b.package_name).slice(0,100),Math.round(amount*100),String(b.account_label).slice(0,80),String(b.account_id).slice(0,100),String(b.customer_name||"").slice(0,100),String(b.customer_phone||"").slice(0,30),publicToken]);
    return res.status(201).json(r.rows[0]);
  } catch (error) {
    console.error("Public order creation failed:", error);
    return res.status(500).json({error:"Order could not be saved. The server or database needs attention. Please try again later."});
  }
});

// Public status lookup uses an unguessable reference and never exposes account details.
app.get("/api/orders/:token", async (req,res)=>{
  if(!/^[a-f0-9]{36}$/.test(req.params.token)) return res.status(404).json({error:"Order not found"});
  try {
    const r=await pool.query("SELECT id,product_name,package_name,amount_paise,payment_status,order_status,created_at FROM orders WHERE public_token=$1",[req.params.token]);
    if(!r.rowCount) return res.status(404).json({error:"Order not found"});
    return res.json(r.rows[0]);
  } catch (error) {
    console.error("Public order lookup failed:", error);
    return res.status(500).json({error:"Could not load order status right now."});
  }
});

app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/health", (req,res)=>res.json({ok:true}));
app.use("/api", (err, req, res, next) => {
  console.error("API request failed:", err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({error:"The server could not complete this request. Please try again later."});
});
init().then(()=>app.listen(PORT,()=>console.log("WS TOP UP server listening on",PORT))).catch(e=>{console.error("Database initialization failed:",e);process.exit(1)});
