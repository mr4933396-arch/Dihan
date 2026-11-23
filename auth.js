import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (s) => document.querySelector(s);
const page = document.body.dataset.page;
const message = (t, bad = false) => {
  const e = $("#message");
  if (e) {
    e.textContent = t;
    e.className = bad ? "message error" : "message success";
  }
};
const busy = (form, value, label = "Please wait...") => {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (value) {
    button.dataset.old = button.textContent;
    button.textContent = label;
  } else {
    button.textContent = button.dataset.old || button.textContent;
  }
  button.disabled = value;
};
const normalizePhone = (value) => {
  let number = String(value || "").trim().replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(number)) number = "+91" + number;
  else if (/^0\d{10}$/.test(number)) number = "+91" + number.slice(1);
  else if (/^91\d{10}$/.test(number)) number = "+" + number;
  else if (/^\d+$/.test(number)) number = "+" + number;
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : null;
};
const ready =
  typeof SUPABASE_URL === "string" &&
  SUPABASE_URL.startsWith("https://") &&
  typeof SUPABASE_ANON_KEY === "string" &&
  SUPABASE_ANON_KEY.length > 20;
const supabase = ready
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

if (!supabase) message("Connection settings are missing. সংযোগের সেটিংস ঠিক নেই।", true);

const friendly = (error) => {
  const text = error?.message || "Please try again. আবার চেষ্টা করো।";
  if (/phone.*not enabled|phone provider is not enabled/i.test(text))
    return "Phone login is not enabled in Supabase. Supabase-এ Phone Provider চালু করো।";
  if (/password.*at least|weak password|should be at least/i.test(text))
    return "Password must be at least 6 characters. পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দাও।";
  if (/invalid login credentials/i.test(text))
    return "Wrong mobile number or password. মোবাইল নম্বর অথবা পাসওয়ার্ড ভুল।";
  if (/user already registered|already been registered/i.test(text))
    return "This number is already registered. এই নম্বরে আগে অ্যাকাউন্ট তৈরি হয়েছে, Login করো।";
  if (/phone.*confirm|confirmation/i.test(text))
    return "Phone confirmation is still enabled. Supabase-এ Phone confirmations বন্ধ করো।";
  return text;
};

if (page === "register") {
  const form = $("#register-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const phone = normalizePhone($("#phone").value);
    const password = $("#password").value;
    const confirm = $("#confirm-password").value;
    if (!phone) return message("Enter a valid mobile number. সঠিক মোবাইল নম্বর দাও।", true);
    if (password.length < 6)
      return message("Password must be at least 6 characters. পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দাও।", true);
    if (password !== confirm)
      return message("Passwords do not match. দুইটি পাসওয়ার্ড মিলছে না।", true);

    busy(form, true, "Creating account...");
    try {
      const { data, error } = await supabase.auth.signUp({ phone, password });
      if (error) throw error;
      if (!data.session) {
        message("Account created, but phone confirmation is ON. Supabase-এ Phone confirmations OFF করতে হবে; SMS লাগবে না।", true);
        return;
      }
      message("Registration successful! অ্যাকাউন্ট তৈরি হয়েছে।");
      window.location.replace("./dashboard.html");
    } catch (error) {
      message(friendly(error), true);
    } finally {
      busy(form, false);
    }
  });
}

if (page === "login") {
  const form = $("#login-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const phone = normalizePhone($("#phone").value);
    const password = $("#password").value;
    if (!phone) return message("Enter a valid mobile number. সঠিক মোবাইল নম্বর দাও।", true);
    if (!password) return message("Enter your password. পাসওয়ার্ড দাও।", true);

    busy(form, true, "Logging in...");
    try {
      const { error } = await supabase.auth.signInWithPassword({ phone, password });
      if (error) throw error;
      message("Login successful! লগইন সফল হয়েছে।");
      window.location.replace("./dashboard.html");
    } catch (error) {
      message(friendly(error), true);
    } finally {
      busy(form, false);
    }
  });
}

if (page === "dashboard") {
  const load = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        window.location.replace("./login.html");
        return;
      }
      $("#user-phone").textContent = data.user.phone || "Mobile number unavailable";
    } catch (error) {
      message(friendly(error), true);
    }
  };
  const { data: listener } = supabase
    ? supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") window.location.replace("./login.html");
      })
    : { data: { subscription: null } };

  load();
  $("#logout")?.addEventListener("click", async () => {
    if (!supabase) return;
    const button = $("#logout");
    button.disabled = true;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      window.location.replace("./login.html");
    } catch (error) {
      message(friendly(error), true);
      button.disabled = false;
    }
  });
  window.addEventListener("beforeunload", () => listener.subscription?.unsubscribe());
}
