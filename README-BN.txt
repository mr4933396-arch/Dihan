WS TOP UP — Login & Registration starter (GitHub Pages + Supabase)

ফাইলগুলো তোমার বর্তমান GitHub repository-তে যোগ করো। পুরোনো index.html মুছবে না।
এই প্যাকেজে auth/login.html, auth/register.html, auth/dashboard.html এবং auth/reset.html আছে।

ধাপ ১ — Supabase
1. https://supabase.com এ project তৈরি করো।
2. Project Settings → API থেকে Project URL এবং publishable/anon key কপি করো।
3. auth/assets/config.js ফাইলে SUPABASE_URL ও SUPABASE_ANON_KEY বসাও।
   এখানে কখনো service_role/secret key বসাবে না।
4. Supabase → SQL Editor-এ supabase-schema.sql ফাইলের SQL চালাও।

ধাপ ২ — Email settings
Supabase → Authentication → URL Configuration:
- Site URL: তোমার GitHub Pages URL (যেমন https://USERNAME.github.io/REPOSITORY/)
- Redirect URLs-এ যোগ করো:
  https://USERNAME.github.io/REPOSITORY/auth/dashboard.html
  https://USERNAME.github.io/REPOSITORY/auth/reset.html

Supabase → Authentication → Providers → Email চালু রাখো।
Email confirmation চালু থাকলে রেজিস্ট্রেশনের পর ইমেইল verify করতে হবে।
Password reset redirect-ও reset.html পেজে যাবে।

ধাপ ৩ — GitHub Pages
1. এই ZIP extract করে ফাইলগুলো তোমার repository-তে upload/commit করো।
2. GitHub repository → Settings → Pages-এ Pages চালু আছে কি না দেখো।
3. তোমার সাইটে এই লিংকগুলো যোগ করো:
   Login: /REPOSITORY/auth/login.html
   Register: /REPOSITORY/auth/register.html
   (নিজের repository name অনুযায়ী path ঠিক করো। Custom domain/root হলে /auth/... ব্যবহার করো।)

ধাপ ৪ — পরীক্ষা
- Register করে email verification সম্পন্ন করো।
- Login করে dashboard দেখো।
- Logout এবং Forgot password পরীক্ষা করো।

নোট
- এটি frontend authentication starter; তোমার আগের ওয়েবসাইটের অর্ডার সিস্টেমে নিজে থেকে যুক্ত হবে না।
- Dashboard-এ profile data দেখায়। Order history যুক্ত করতে হলে orders table এবং নিরাপদ RLS policy দরকার।
- Publishable/anon key browser-এ থাকা স্বাভাবিক, কিন্তু database-এর প্রতিটি private table-এ RLS policy অবশ্যই চালু রাখতে হবে।
- GitHub Pages static hosting; server-side secret বা admin service_role key কখনো browser code-এ রেখো না।
