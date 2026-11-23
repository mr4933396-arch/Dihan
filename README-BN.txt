WS TOP UP — Customer Login & Registration

এই branch-এ কাস্টমারদের জন্য Login, Registration, Email Verification, Password Reset এবং Customer Dashboard-এর ফাইল আছে। Admin Dashboard এই কাজের অংশ নয় এবং সেটি পরিবর্তন করা হয়নি।

## ১) Supabase Database প্রস্তুত করো
1. https://supabase.com/dashboard খুলে WS TOP UP-এর project নির্বাচন করো।
2. বাম পাশের SQL Editor খুলে New query চাপো।
3. GitHub-এর এই branch-এর `supabase-schema.sql` ফাইলের সম্পূর্ণ SQL কপি করে SQL Editor-এ পেস্ট করো।
4. Run চাপো। সফল হলে `public.profiles` table এবং signup trigger তৈরি হবে।

## ২) Email Login চালু রাখো
1. Supabase → Authentication → Providers → Email খুলে Email provider Enabled আছে কি না দেখো।
2. Email confirmation চালু রাখলে নতুন গ্রাহককে ইমেইলের verification link চাপতে হবে।
3. Authentication → URL Configuration-এ Site URL হিসেবে তোমার আসল live website URL দাও।
4. Redirect URLs-এ live website-এর নিচের দুইটি পূর্ণ URL যোগ করো:
   - `https://তোমার-ওয়েবসাইট/login.html`
   - `https://তোমার-ওয়েবসাইট/dashboard.html`
   - `https://তোমার-ওয়েবসাইট/reset.html`
   (উপরের নমুনায় তোমার ওয়েবসাইটের আসল domain বসাবে।)

## ৩) Website ফাইল
সব authentication ফাইল repository root-এ:
- `login.html`
- `register.html`
- `dashboard.html`
- `reset.html`
- `auth.js`
- `style.css`
- `config.js`

Store-এর navigation-এ Login / Register লিংক আছে।

## ৪) পরীক্ষা
1. Store থেকে Login / Register খুলে নতুন ইমেইল দিয়ে account তৈরি করো।
2. Supabase Email confirmation চালু থাকলে inbox-এ আসা verification link চাপো।
3. Login করে Customer Dashboard খুলছে কি না দেখো।
4. Logout এবং Forgot Password পরীক্ষা করো।

নিরাপত্তা:
- `config.js`-এ শুধু Supabase Project URL ও publishable/anon public key থাকবে।
- কখনো service_role বা secret key browser-এর ফাইলে বসাবে না।
- profiles table-এ Row Level Security চালু; গ্রাহক কেবল নিজের profile দেখতে/আপডেট করতে পারবে।
- Admin Dashboard, existing product catalogue, product images, package options ও prices এই কাজের আওতার বাইরে।
- এটি Customer Authentication; order history/payment system এখনো এতে যুক্ত হয়নি।
