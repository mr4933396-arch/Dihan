WS TOP UP — INTEGRATED WEBSITE + ADMIN ORDER PANEL

PROJECT CONTENTS
- public/index.html: WS TOP UP homepage
- public/product.html: product/package page; PLACE ORDER now submits an order to the backend
- public/admin.html: admin login and order dashboard
- server.js: Express backend and PostgreSQL order API
- package.json: Node dependencies

RUN ON RENDER
1. Extract this ZIP and upload the contents to a GitHub repository (keep server.js and package.json at repository root).
2. Create a Render PostgreSQL database.
3. Create a Render Web Service connected to that GitHub repository (NOT a Static Site).
4. Build Command: npm install
5. Start Command: npm start
6. Add these Environment Variables in Render:
   DATABASE_URL = Render PostgreSQL Internal Database URL
   NODE_ENV = production
   SESSION_SECRET = a long random secret (32+ characters)
   ADMIN_USERNAME = your chosen admin username
   ADMIN_PASSWORD_HASH = bcrypt hash of your admin password
7. Generate a bcrypt hash locally after installing Node.js and running:
   node -e "require('bcryptjs').hash('YOUR_STRONG_PASSWORD',12).then(console.log)"
   Put the printed hash in ADMIN_PASSWORD_HASH. Never put the plain password in GitHub.
8. Deploy. Open:
   Homepage: https://YOUR-SERVICE.onrender.com/
   Product page: https://YOUR-SERVICE.onrender.com/product.html?item=freefire
   Admin: https://YOUR-SERVICE.onrender.com/admin

ORDER FLOW
- Customer selects a package, enters their account ID, and submits.
- The order is stored in PostgreSQL with payment_status=unpaid and order_status=pending.
- Admin signs in at /admin and reviews/updates order status.
- This does NOT collect or verify payment and does NOT deliver top-ups automatically. Verify payment separately before marking an order paid.

IMPORTANT LIMITATIONS OF THIS VERSION
- The supplied admin backend currently provides admin login, dashboard statistics, order list/filtering, and order/payment status updates.
- It does NOT yet provide product/package/price editing or a separate customer-management module.
- Prices in product.html are sample/demo prices. Replace them with your real prices before launch.
- Do not request customer passwords or OTPs.
- Keep DATABASE_URL, SESSION_SECRET, and ADMIN_PASSWORD_HASH private; do not commit secrets to GitHub.
