import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = (id) => document.getElementById(id);
const page = document.body.dataset.page;
const message = (text, isError = false) => {
  const el = $("message");
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "message error" : "message success";
};
const setBusy = (form, busy, label = "Please wait…") => {
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
const friendlyError = (error) => {
  const value = error?.message || "Something went wrong. আবার চেষ্টা করো।";
  if (/invalid login credentials/i.test(value)) return "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।";
  if (/email not confirmed/i.test(value)) return "আগে ইমেইলে পাঠানো verification link-এ ক্লিক করো।";
  if (/user already registered|already been registered/i.test(value)) return "এই ইমেইলে আগে থেকেই অ্যাকাউন্ট আছে। Login করো।";
  if (/password.*at least|weak password/i.test(value)) return "পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।";
  if (/redirect.*allow|not allowed/i.test(value)) return "Supabase-এ এই ওয়েবসাইটের Redirect URL যোগ করা হয়নি।";
  return value;
};

if (page === "login") {
  const form = $("login-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    setBusy(form, true, "লগইন হচ্ছে…");
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      window.location.replace("./my-account.html");
    } catch (error) {
      message(friendlyError(error), true);
      setBusy(form, false);
    }
  });
}

if (page === "register") {
  const form = $("register-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = $("name").value.trim();
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    const confirm = $("confirm-password").value;
    if (!name) return message("তোমার পুরো নাম লিখো।", true);
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);
    if (password !== confirm) return message("দুইটি পাসওয়ার্ড মিলছে না।", true);
    setBusy(form, true, "অ্যাকাউন্ট তৈরি হচ্ছে…");
    try {
      const redirectTo = new URL("./my-account.html", window.location.href).href;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: redirectTo
        }
      });
      if (error) throw error;
      if (data.session) {
        window.location.replace("./my-account.html");
        return;
      }
      form.reset();
      message("অ্যাকাউন্ট তৈরি হয়েছে। তোমার ইমেইল খুলে verification link-এ ক্লিক করে অ্যাকাউন্ট চালু করো।");
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      setBusy(form, false);
    }
  });
}

if (page === "reset") {
  const resetForm = $("reset-form");
  const passwordWrap = $("new-password-wrap");
  const showPasswordForm = () => { if (passwordWrap) passwordWrap.hidden = false; };
  if (window.location.hash.includes("type=recovery")) showPasswordForm();

  resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(resetForm, true, "লিংক পাঠানো হচ্ছে…");
    try {
      const email = $("email").value.trim().toLowerCase();
      const redirectTo = new URL("./reset.html", window.location.href).href;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      message("পাসওয়ার্ড রিসেটের লিংক ইমেইলে পাঠানো হয়েছে।");
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      setBusy(resetForm, false);
    }
  });

  const passwordForm = $("new-password-form");
  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = $("new-password").value;
    const confirm = $("confirm-password").value;
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);
    if (password !== confirm) return message("দুইটি পাসওয়ার্ড মিলছে না।", true);
    setBusy(passwordForm, true, "আপডেট হচ্ছে…");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      passwordForm.reset();
      message("নতুন পাসওয়ার্ড সেট হয়েছে। এখন Login করতে পারো।");
    } catch (error) {
      message(friendlyError(error), true);
    } finally {
      setBusy(passwordForm, false);
    }
  });

  supabase.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") showPasswordForm();
  });
}

if (page === "account") {
  const loadAccount = async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      window.location.replace("./login.html");
      return;
    }
    const user = data.user;
    $("user-email").textContent = user.email || "—";
    $("user-name").textContent = user.user_metadata?.display_name || "WS TOP UP Customer";
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.display_name) $("user-name").textContent = profile.display_name;
  };
  loadAccount().catch((error) => message(friendlyError(error), true));
  $("logout")?.addEventListener("click", async () => {
    const button = $("logout");
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
}
