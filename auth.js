import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const $ = (selector) => document.querySelector(selector);
const clientReady =
  SUPABASE_URL.startsWith("https://") &&
  !SUPABASE_URL.includes("YOUR_") &&
  !SUPABASE_ANON_KEY.includes("YOUR_");

const supabase = clientReady ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
const message = (text, isError = false) => {
  const el = $("#message");
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "message error" : "message success";
};

if (!clientReady) {
  message("প্রথমে auth/assets/config.js ফাইলে Supabase URL ও key বসাও।", true);
}

const page = document.body.dataset.page;

if (page === "register") {
  $("#register-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const name = $("#name").value.trim();
    const email = $("#email").value.trim();
    const password = $("#password").value;
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name },
        emailRedirectTo: new URL("./dashboard.html", window.location.href).href
      }
    });
    if (error) return message(error.message, true);
    if (data.session) {
      window.location.href = "./dashboard.html";
    } else {
      message("রেজিস্ট্রেশন হয়েছে। ইমেইলে পাঠানো verification link-এ ক্লিক করে অ্যাকাউন্ট চালু করো।");
    }
  });
}

if (page === "login") {
  $("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#password").value
    });
    if (error) return message(error.message, true);
    window.location.href = "./dashboard.html";
  });
}

if (page === "reset") {
  $("#reset-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const email = $("#email").value.trim();
    const redirectTo = new URL("./reset.html", window.location.href).href;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) return message(error.message, true);
    message("পাসওয়ার্ড রিসেটের নির্দেশনা ইমেইলে পাঠানো হয়েছে।");
  });

  $("#new-password-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) return;
    const password = $("#new-password").value;
    if (password.length < 8) return message("পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।", true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return message(error.message, true);
    message("নতুন পাসওয়ার্ড সেট হয়েছে। এখন Login করতে পারো।");
  });
}

if (page === "dashboard") {
  const { data: { subscription } } = supabase
    ? supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) window.location.href = "./login.html";
      })
    : { data: { subscription: null } };

  const loadDashboard = async () => {
    if (!supabase) return;
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      window.location.href = "./login.html";
      return;
    }
    $("#user-email").textContent = user.email || "";
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, created_at")
      .eq("id", user.id)
      .maybeSingle();
    $("#user-name").textContent = profile?.display_name || "WS TOP UP User";
  };

  loadDashboard();
  $("#logout")?.addEventListener("click", async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) return message(error.message, true);
    window.location.href = "./login.html";
  });
  window.addEventListener("beforeunload", () => subscription?.unsubscribe());
}
