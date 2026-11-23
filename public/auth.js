import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const page = document.body.dataset.page;
const message = (text, isError = false) => {
  const el = $("#message");
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "message error" : "message success";
};
const setBusy = (form, busy, label = "অপেক্ষা করো...") => {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
  }
  button.disabled = busy;
};

// India: accepts 10-digit numbers, 0-prefixed numbers, 91-prefixed numbers,
// or an international number already written with +country code.
const normalizePhone = (value) => {
  let raw = String(value || "").trim().replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(raw)) raw = "+91" + raw;
  else if (/^0\d{10}$/.test(raw)) raw = "+91" + raw.slice(1);
  else if (/^91\d{10}$/.test(raw)) raw = "+" + raw;
  else if (/^\d+$/.test(raw)) raw = "+" + raw;
  return /^\+[1-9]\d{7,14}$/.test(raw) ? raw : null;
};

const configReady =
  typeof SUPABASE_URL === "string" &&
  SUPABASE_URL.startsWith("https://") &&
  typeof SUPABASE_ANON_KEY === "string" &&
  SUPABASE_ANON_KEY.length > 20 &&
  !SUPABASE_URL.includes("YOUR_") &&
  !SUPABASE_ANON_KEY.includes("YOUR_");

const supabase = configReady
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

if (!supabase) {
  message("Supabase সংযোগের সেটিংস ঠিক নেই। config.js পরীক্ষা করতে হবে।", true);
}

const friendlyError = (error) => {
  const text = error?.message || "কাজটি সম্পন্ন হয়নি। আবার চেষ্টা করো।";
  if (/invalid login credentials/i.test(text)) return "মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।";
  if (/phone.*not enabled|phone provider is not enabled/i.test(text)) return "Supabase-এ Phone Login চালু করতে হবে।";
  if (/user already registered|already been registered/i.test(text)) return "এই মোবাইল নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট খোলা আছে। লগইন করো।";
  if (/password should be at least/i.test(text)) return "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।";
  if (/sms|otp|token.*send/i.test(text)) return "মোবাইলে OTP পাঠানো যায়নি। Supabase-এর SMS সেটিংস পরীক্ষা করতে হবে।";
  return text;
};

if (page === "register") {
  const form = $("#register-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const phone = normalizePhone($("#phone").value);
    const password = $("#password").value;
    if (!phone) return message("সঠিক মোবাইল নম্বর দাও। ভারতের নম্বর হলে ১০ ডিজিট লিখলেই হবে।", true);
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);

    setBusy(form, true, "অ্যাকাউন্ট তৈরি হচ্ছে...");
    try {
      const { data, error } = await supabase.auth.signUp({ phone, password });
      if (error) throw error;
      if (data.session) {
        window.location.replace("./dashboard.html");
        return;
      }
      message("রেজিস্ট্রেশন অনুরোধ নেওয়া হয়েছে। Supabase-এ Phone Confirmation চালু থাকলে SMS OTP দিয়ে নম্বর যাচাই করতে হবে।");
      form.reset();
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      setBusy(form, false);
    }
  });
}

if (page === "login") {
  const form = $("#login-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const phone = normalizePhone($("#phone").value);
    if (!phone) return message("সঠিক মোবাইল নম্বর দাও। ভারতের নম্বর হলে ১০ ডিজিট লিখলেই হবে।", true);
    setBusy(form, true, "লগইন হচ্ছে...");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        phone,
        password: $("#password").value
      });
      if (error) throw error;
      window.location.replace("./dashboard.html");
    } catch (error) {
      message(friendlyError(error), true);
      setBusy(form, false);
    }
  });
}

if (page === "dashboard") {
  const loadDashboard = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        window.location.replace("./login.html");
        return;
      }
      $("#user-phone").textContent = data.user.phone || "মোবাইল নম্বর পাওয়া যায়নি";
    } catch (error) {
      message(friendlyError(error), true);
    }
  };

  const { data: authListener } = supabase
    ? supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.replace("./login.html");
      })
    : { data: { subscription: null } };

  loadDashboard();

  $("#logout")?.addEventListener("click", async () => {
    if (!supabase) return;
    const button = $("#logout");
    button.disabled = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.replace("./login.html");
    } catch (error) {
      message(friendlyError(error), true);
      button.disabled = false;
    }
  });

  window.addEventListener("beforeunload", () => authListener.subscription?.unsubscribe());
}
