WS TOP UP — PHASE 1 GLOBAL STOREFRONT

Files:
- index.html: global home page, category filters, search, currency preference selector
- product.html: product page, account details, country selection and WhatsApp manual order request
- logo.png: WS TOP UP logo

HOW TO UPDATE THE EXISTING GITHUB WEBSITE
1. Download and extract this ZIP.
2. Open the GitHub repository currently connected to your Render website.
3. Upload index.html, product.html and logo.png to the repository ROOT (same folder).
4. Replace the old files and commit the changes. Render should redeploy if auto-deploy is enabled.
5. Open the live website and test product pages and WhatsApp order requests.

IMPORTANT LIMITATIONS — THIS IS THE FIRST FRONTEND PHASE, NOT THE COMPLETE MARKETPLACE.
- Existing INR package values are DEMO values and must be replaced with your real selling prices before accepting orders.
- BDT prices are deliberately shown as price-on-request; no exchange rate or BDT price has been invented.
- Orders are sent to WhatsApp for manual handling. There is no secure order database, customer login, admin dashboard, payment gateway, wallet, reseller account, or automatic delivery in this static version.
- Do not enter passwords, OTPs, login codes, or payment card details in order forms.

NEXT BACKEND PHASE
A proper global marketplace needs a backend and persistent database for customer accounts, product/price management, admin login, order records and status updates. Payment collection should be connected only after choosing a supported provider and configuring its credentials securely on the server. Do not put secret keys in HTML or GitHub.

Support contacts configured from the current project:
WhatsApp: +91 7814003979
Telegram: @WSTopUpOfficial
