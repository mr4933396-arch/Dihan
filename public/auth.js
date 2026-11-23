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
  if (/invalid login credentials/i.test(text)) return "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।";
  if (/email not confirmed/i.test(text)) return "আগে ইমেইলে পাঠানো verification link দিয়ে অ্যাকাউন্ট চালু করো।";
  if (/user already registered/i.test(text)) return "এই ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট খোলা আছে। Login করো।";
  if (/password should be at least/i.test(text)) return "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।";
  return text;
};

if (page === "register") {
  const form = $("#register-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const name = $("#name").value.trim();
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    if (!name) return message("তোমার নাম লিখো।", true);
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);

    setBusy(form, true, "অ্যাকাউন্ট তৈরি হচ্ছে...");
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: new URL("./dashboard.html", window.location.href).href
        }
      });
      if (error) throw error;
      if (data.session) {
        window.location.replace("./dashboard.html");
        return;
      }
      message("রেজিস্ট্রেশন হয়েছে। ইমেইলে পাঠানো verification link-এ ক্লিক করে অ্যাকাউন্ট চালু করো।");
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
    setBusy(form, true, "লগইন হচ্ছে...");
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: $("#email").value.trim().toLowerCase(),
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

if (page === "reset") {
  const resetForm = $("#reset-form");
  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    setBusy(resetForm, true, "লিংক পাঠানো হচ্ছে...");
    try {
      const email = $("#email").value.trim().toLowerCase();
      const redirectTo = new URL("./reset.html", window.location.href).href;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      message("পাসওয়ার্ড রিসেটের নির্দেশনা ইমেইলে পাঠানো হয়েছে।");
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      setBusy(resetForm, false);
    }
  });

  const passwordForm = $("#new-password-form");
  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const password = $("#new-password").value;
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);
    setBusy(passwordForm, true, "আপডেট হচ্ছে...");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      message("নতুন পাসওয়ার্ড সেট হয়েছে। এখন Login করতে পারো।");
      passwordForm.reset();
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      setBusy(passwordForm, false);
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
      $("#user-email").textContent = data.user.email || "";
      const displayName = data.user.user_metadata?.display_name || "WS TOP UP User";
      $("#user-name").textContent = displayName;
    } catch (error) {
      message(friendlyError(error), true);
    }
  };

  // Redirect only after an actual sign-out event, not during initial session loading.
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
