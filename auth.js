import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
const $ = (s) => document.querySelector(s);
const page = document.body.dataset.page;
const message = (t, bad=false) => { const e=$("#message"); if(e){e.textContent=t;e.className=bad?"message error":"message success";} };
const busy = (f,v,label="অপেক্ষা করো...") => { const b=f?.querySelector('button[type="submit"]'); if(!b)return; if(v){b.dataset.old=b.textContent;b.textContent=label;}else b.textContent=b.dataset.old||b.textContent; b.disabled=v; };
const normalizePhone = (v) => { let n=String(v||"").trim().replace(/[\s().-]/g,""); if(/^\d{10}$/.test(n))n="+91"+n; else if(/^0\d{10}$/.test(n))n="+91"+n.slice(1); else if(/^91\d{10}$/.test(n))n="+"+n; else if(/^\d+$/.test(n))n="+"+n; return /^\+[1-9]\d{7,14}$/.test(n)?n:null; };
const ready=typeof SUPABASE_URL==="string"&&SUPABASE_URL.startsWith("https://")&&typeof SUPABASE_ANON_KEY==="string"&&SUPABASE_ANON_KEY.length>20;
const supabase=ready?createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
if(!supabase)message("Supabase সংযোগের সেটিংস ঠিক নেই।",true);
const friendly=(e)=>{const t=e?.message||"আবার চেষ্টা করো।";if(/phone.*not enabled|phone provider is not enabled/i.test(t))return "Supabase-এ Phone Provider চালু করতে হবে।";if(/sms|otp|token.*send|phone.*rate limit/i.test(t))return "SMS OTP পাঠানো যায়নি। Supabase-এর SMS Provider সেটিংস পরীক্ষা করতে হবে।";if(/token.*expired|invalid.*token|otp.*invalid/i.test(t))return "OTP ভুল বা মেয়াদ শেষ। নতুন OTP নিয়ে আবার দাও।";if(/user.*not found|no user/i.test(t))return "এই নম্বরের অ্যাকাউন্ট নেই। আগে OTP দিয়ে অ্যাকাউন্ট তৈরি করো।";return t;};
if(page==="register"||page==="login"){
 const f=$("#phone-form"), o=$("#otp-form"); let phonePending="";
 f?.addEventListener("submit",async ev=>{ev.preventDefault();if(!supabase)return;const phone=normalizePhone($("#phone").value);if(!phone)return message("সঠিক মোবাইল নম্বর দাও। ভারতের নম্বর হলে ১০ ডিজিট লিখলেই হবে।",true);busy(f,true,"OTP পাঠানো হচ্ছে...");try{const {error}=await supabase.auth.signInWithOtp({phone,options:{shouldCreateUser:true}});if(error)throw error;phonePending=phone;$("#otp-phone").textContent=phone;f.hidden=true;o.hidden=false;message("তোমার মোবাইলে SMS OTP পাঠানো হয়েছে। OTP লিখে Verify করো।");}catch(e){message(friendly(e),true);}finally{busy(f,false);}});
 o?.addEventListener("submit",async ev=>{ev.preventDefault();if(!supabase||!phonePending)return;const token=$("#otp").value.trim();if(!/^\d{6}$/.test(token))return message("৬ সংখ্যার OTP লিখো।",true);busy(o,true,"যাচাই হচ্ছে...");try{const {error}=await supabase.auth.verifyOtp({phone:phonePending,token,type:"sms"});if(error)throw error;message("OTP সঠিক! লগইন সফল হয়েছে।");window.location.replace("./dashboard.html");}catch(e){message(friendly(e),true);}finally{busy(o,false);}});
 $("#change-phone")?.addEventListener("click",()=>{o.hidden=true;f.hidden=false;phonePending="";$("#otp").value="";message("");});
}
if(page==="dashboard"){
 const load=async()=>{if(!supabase)return;try{const {data,error}=await supabase.auth.getUser();if(error||!data.user){window.location.replace("./login.html");return;}$("#user-phone").textContent=data.user.phone||"মোবাইল নম্বর পাওয়া যায়নি";}catch(e){message(friendly(e),true);}};
 const {data:listener}=supabase?supabase.auth.onAuthStateChange(ev=>{if(ev==="SIGNED_OUT")window.location.replace("./login.html");}):{data:{subscription:null}};
 load();$("#logout")?.addEventListener("click",async()=>{if(!supabase)return;const b=$("#logout");b.disabled=true;try{const {error}=await supabase.auth.signOut();if(error)throw error;window.location.replace("./login.html");}catch(e){message(friendly(e),true);b.disabled=false;}});
 window.addEventListener("beforeunload",()=>listener.subscription?.unsubscribe());
}