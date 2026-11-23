import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (s) => document.querySelector(s);
const page = document.body.dataset.page;
const message = (t, bad = false) => {
  const e = $("#message");
  if (e) { e.textContent = t; e.className = bad ? "message error" : "message success"; }
};
const busy = (form, value, label = "Please wait...") => {
  const button = form?.querySelector('button[type="submit"]');
  if (!button) return;
  if (value) { button.dataset.old = button.textContent; button.textContent = label; }
  else button.textContent = button.dataset.old || button.textContent;
  button.disabled = value;
};
const ready = typeof SUPABASE_URL === "string" && SUPABASE_URL.startsWith("https://") &&
  typeof SUPABASE_ANON_KEY === "string" && SUPABASE_ANON_KEY.length > 20;
const supabase = ready ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

if (!supabase) message("Connection settings are missing. সংযোগের সেটিংস ঠিক নেই।", true);

const friendly = (error) => {
  const text = error?.message || "Please try again. আবার চেষ্টা করো।";
  if (/email.*not enabled|email provider is not enabled/i.test(text))
    return "Email login is not enabled in Supabase. Supabase-এ Email Provider চালু করো।";
  if (/password.*at least|weak password|should be at least/i.test(text))
    return "Password must be at least 6 characters. পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দাও।";
  if (/invalid login credentials/i.test(text))
    return "Wrong email or password. ইমেইল অথবা পাসওয়ার্ড ভুল।";
  if (/user already registered|already been registered/i.test(text))
    return "This email is already registered. এই ইমেইলে আগে অ্যাকাউন্ট তৈরি হয়েছে, Login করো।";
  if (/email not confirmed/i.test(text))
    return "Please confirm your email first. ইমেইলে পাঠানো লিংকে ক্লিক করে নিশ্চিত করো।";
  return text;
};

if (page === "register") {
  const form = $("#register-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    const confirm = $("#confirm-password").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return message("Enter a valid email address. সঠিক ইমেইল ঠিকানা দাও।", true);
    if (password.length < 6)
      return message("Password must be at least 6 characters. পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দাও।", true);
    if (password !== confirm)
      return message("Passwords do not match. দুইটি পাসওয়ার্ড মিলছে না।", true);

    busy(form, true, "Creating account...");
    try {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        message("Account created. Please check your email and click the confirmation link. অ্যাকাউন্ট তৈরি হয়েছে—ইমেইল নিশ্চিত করো।");
        return;
      }
      message("Registration successful! অ্যাকাউন্ট তৈরি হয়েছে।");
      window.location.replace("./dashboard.html");
    } catch (error) { message(friendly(error), true); }
    finally { busy(form, false); }
  });
}

if (page === "login") {
  const form = $("#login-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const email = $("#email").value.trim().toLowerCase();
    const password = $("#password").value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return message("Enter a valid email address. সঠিক ইমেইল ঠিকানা দাও।", true);
    if (!password) return message("Enter your WS TOP UP password. পাসওয়ার্ড দাও।", true);

    busy(form, true, "Logging in...");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      message("Login successful! লগইন সফল হয়েছে।");
      window.location.replace("./dashboard.html");
    } catch (error) { message(friendly(error), true); }
    finally { busy(form, false); }
  });
}

if (page === "dashboard") {
  const load = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) { window.location.replace("./login.html"); return; }
      $("#user-email").textContent = data.user.email || "Email unavailable";
    } catch (error) { message(friendly(error), true); }
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
    } catch (error) { message(friendly(error), true); button.disabled = false; }
  });
  window.addEventListener("beforeunload", () => listener.subscription?.unsubscribe());
}
