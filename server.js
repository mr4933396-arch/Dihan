require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const path = require("path");

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
  if(!Number.isSafeInteger(amount)||amount<1||amount>10000000) return res.status(400).json({error:"Invalid amount"});
  if(String(b.account_id).length>100 || String(b.package_name).length>100) return res.status(400).json({error:"Input too long"});
  const r=await pool.query(`INSERT INTO orders(product_key,product_name,package_name,amount_paise,account_label,account_id,customer_name,customer_phone)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,order_status,payment_status,created_at`,
    [String(b.product_key).slice(0,50),String(b.product_name).slice(0,120),String(b.package_name).slice(0,100),Math.round(amount*100),String(b.account_label).slice(0,80),String(b.account_id).slice(0,100),String(b.customer_name||"").slice(0,100),String(b.customer_phone||"").slice(0,30)]);
  res.status(201).json(r.rows[0]);
});

app.get("/admin", (req,res)=>res.sendFile(path.join(__dirname,"public","admin.html")));
app.get("/health", (req,res)=>res.json({ok:true}));
init().then(()=>app.listen(PORT,()=>console.log("WS TOP UP server listening on",PORT))).catch(e=>{console.error(e);process.exit(1)});
