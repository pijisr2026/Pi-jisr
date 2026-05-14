export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    const CONFIG = {
      RATE_LIMIT: 15,
      MAX_BODY_BYTES: 8192,
      PAYMENT_REGEX: /^[a-zA-Z0-9_-]{5,100}$/,
      TXID_REGEX: /^[a-zA-Z0-9]{5,100}$/,
      URL_REGEX: /^https?:\/\/[^\s<>"]{1,200}$/,
      SEC_HEADERS: {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://sdk.minepi.com; connect-src 'self' https://api.minepi.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'self' https://*.minepi.com https://*.pinet.com;"
      }
    };

    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    const err = (msg, status = 400) => json({ error: msg }, status);
    const clean = (val, max = 300) => { if (typeof val !== 'string') return ''; return val.trim().slice(0, max).replace(/[<>'`]/g, ''); };
    const validEmail = (e) => typeof e === 'string' && /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(e);
    const validUrl = (u) => !u || CONFIG.URL_REGEX.test(u);
    const ALLOWED = {
      countries: ['sa','ae','eg','iq','jo','ma','us','cn','uk','other',''], invTypes: ['stocks','partnership','murabaha','mixed',''], sectors: ['tech','food','health','edu','real_estate','agri','any',''], expLevels: ['beginner','intermediate','advanced','expert',''], projCats: ['cafe','tech','retail','service','agri','edu','health','real_estate','industry','other',''], projStages: ['idea','plan','mvp','running','expand',''], fundSrcs: ['mining','purchase','both',''], projTypes: ['stocks','murabaha','partnership','loan',''], teamSizes: ['solo','2-5','6-10','10+',''], expFound: ['beginner','mid','senior',''], langs: ['ar','en','zh','']
    };
    const okVal = (val, list) => list.includes(val);
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    async function rateLimit(path) { if (!env.PI_JISR_KV) return false; const key = 'rl:' + clientIP + ':' + path.replace(/\//g,'_'); const raw = await env.PI_JISR_KV.get(key); const count = raw ? parseInt(raw) : 0; if (count >= CONFIG.RATE_LIMIT) return true; await env.PI_JISR_KV.put(key, String(count + 1), { expirationTtl: 60 }); return false; }
    async function readBodySafe(req) { const cl = req.headers.get('Content-Length'); if (cl && parseInt(cl) > CONFIG.MAX_BODY_BYTES) return null; const buf = await req.arrayBuffer(); if (buf.byteLength > CONFIG.MAX_BODY_BYTES) return null; try { return JSON.parse(new TextDecoder().decode(buf)); } catch { return null; } }

    if (method === "OPTIONS") return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    if (url.pathname === "/validation-key.txt") return new Response("e6316f41587fadeaa7e639588c4866c88ea243819aa3828994ce808b9f38281b1a93e798cb2d261dac09cffcccc0dd5ed262f0791bd6527a1413d280e94138a6", { headers: { "Content-Type": "text/plain" } });

    if (url.pathname === "/api/approve-payment" && method === "POST") {
      if (await rateLimit('/api/approve-payment')) return err("Too many requests", 429);
      try { const body = await readBodySafe(request); if (!body) return err("Invalid or oversized request"); const paymentId = clean(body.paymentId, 100); const username = clean(body.username, 50); const memo = clean(body.memo, 100); const amount = (typeof body.amount === 'number' && body.amount > 0) ? body.amount : null; if (!paymentId) return err("Payment ID required"); if (!CONFIG.PAYMENT_REGEX.test(paymentId)) return err("Invalid payment ID"); const piRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, { method: "POST", headers: { "Authorization": `Key ${env.PI_API_KEY}`, "Content-Type": "application/json" } }); if (!piRes.ok) return err("Payment approval failed", 400); if (env.PI_JISR_KV) await env.PI_JISR_KV.put(`payment:${paymentId}`, JSON.stringify({ paymentId, username, amount, memo, status: "approved", ts: new Date().toISOString() })); return json({ success: true }); } catch { return err("Internal error", 500); }
    }

    if (url.pathname === "/api/complete-payment" && method === "POST") {
      if (await rateLimit('/api/complete-payment')) return err("Too many requests", 429);
      try { const body = await readBodySafe(request); if (!body) return err("Invalid or oversized request"); const paymentId = clean(body.paymentId, 100); const txid = clean(body.txid, 100); if (!paymentId || !txid) return err("paymentId and txid required"); if (!CONFIG.PAYMENT_REGEX.test(paymentId)) return err("Invalid payment ID"); if (!CONFIG.TXID_REGEX.test(txid)) return err("Invalid txid"); const piRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, { method: "POST", headers: { "Authorization": `Key ${env.PI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ txid }) }); if (!piRes.ok) return err("Payment completion failed", 400); if (env.PI_JISR_KV) { const existing = await env.PI_JISR_KV.get(`payment:${paymentId}`); if (existing) { const data = JSON.parse(existing); data.status = "completed"; data.txid = txid; data.completedAt = new Date().toISOString(); await env.PI_JISR_KV.put(`payment:${paymentId}`, JSON.stringify(data)); } } return json({ success: true }); } catch { return err("Internal error", 500); }
    }

    if (url.pathname === "/api/save-project" && method === "POST") {
      if (await rateLimit('/api/save-project')) return err("Too many requests", 429);
      try { const body = await readBodySafe(request); if (!body) return err("Invalid or oversized request"); const username = clean(body.username, 50); const p = body.project; if (!username || !p) return err("Missing data"); const website = clean(p.website, 200); const social = clean(p.social, 200); if (!validUrl(website)) return err("Invalid website URL"); if (!validUrl(social)) return err("Invalid social URL"); const project = { name: clean(p.name, 100), cat: okVal(p.cat, ALLOWED.projCats) ? p.cat : '', stage: okVal(p.stage, ALLOWED.projStages) ? p.stage : '', type: okVal(p.type, ALLOWED.projTypes) ? p.type : '', country: okVal(p.country, ALLOWED.countries) ? p.country : '', teamsize: okVal(p.teamsize, ALLOWED.teamSizes) ? p.teamsize : '', exp: okVal(p.exp, ALLOWED.expFound) ? p.exp : '', desc: clean(p.desc, 1000), team: clean(p.team, 500), pitch: clean(p.pitch, 1000), funding: parseFloat(p.funding) || 0, duration: parseInt(p.duration) || 0, invRoi: parseFloat(p.invRoi) || 0, minInv: parseFloat(p.minInv) || 0, website, social }; if (!project.name || !project.cat || !project.stage || !project.desc || !project.pitch) return err("Missing required fields"); const projectId = 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9); if (env.PI_JISR_KV) { await env.PI_JISR_KV.put(projectId, JSON.stringify({ id: projectId, ...project, username, createdAt: new Date().toISOString(), status: "active" })); const userData = await env.PI_JISR_KV.get(`user:${username}`); let user = userData ? JSON.parse(userData) : { projects: 0, investments: 0 }; user.projects += 1; await env.PI_JISR_KV.put(`user:${username}`, JSON.stringify(user)); } return json({ success: true, projectId }); } catch { return err("Internal error", 500); }
    }

    if (url.pathname === "/api/save-investor" && method === "POST") {
      if (await rateLimit('/api/save-investor')) return err("Too many requests", 429);
      try { let body; try { body = await request.json(); } catch { return err("Invalid request"); } const username = clean(body.username, 50); const iv = body.investor; if (!iv) return err("Missing investor data"); const name = clean(iv.name, 100), piuser = clean(iv.piuser, 50), email = clean(iv.email, 100); const country = iv.country, amount = parseFloat(iv.amount), invType = iv.invType, exp = iv.exp; if (!name || name.length < 2) return err("Name too short"); if (!piuser) return err("Pi username required"); if (!validEmail(email)) return err("Invalid email"); if (!okVal(country, ALLOWED.countries)) return err("Invalid country"); if (isNaN(amount) || amount < 100) return err("Minimum investment is 100 Pi"); if (!okVal(invType, ALLOWED.invTypes)) return err("Invalid investment type"); if (!okVal(exp, ALLOWED.expLevels)) return err("Invalid experience level"); const investor = { name, piuser, email, phone: clean(iv.phone, 20), country, lang: okVal(iv.lang, ALLOWED.langs) ? iv.lang : 'ar', amount, invType, sector: okVal(iv.sector, ALLOWED.sectors) ? iv.sector : '', exp, fundSrc: okVal(iv.fundSrc, ALLOWED.fundSrcs) ? iv.fundSrc : '', notes: clean(iv.notes, 500) }; if (env.PI_JISR_KV) { const investorId = 'investor_' + Date.now(); await env.PI_JISR_KV.put(investorId, JSON.stringify({ id: investorId, ...investor, username, createdAt: new Date().toISOString() })); } return json({ success: true }); } catch { return err("Internal error", 500); }
    }

    if (url.pathname === "/api/get-user" && method === "GET") {
      if (await rateLimit('/api/get-user')) return err("Too many requests", 429);
      try { const username = clean(url.searchParams.get("username") || '', 50); if (!username) return err("Username required"); if (env.PI_JISR_KV) { const userData = await env.PI_JISR_KV.get(`user:${username}`); return json(userData ? JSON.parse(userData) : { projects: 0, investments: 0 }); } return json({ projects: 0, investments: 0 }); } catch { return err("Internal error", 500); }
    }

    const APP_CSS = `:root{--bg:#0a0f1d;--teal:#0fd4c8;--card:#161e31;--text:#e8edf8;--border:rgba(15,212,200,0.2);--input-bg:#0f172a;--error:#ef4444;--success:#22c55e}*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',Tahoma,sans-serif}body{background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}.header{background:#0f172a;padding:15px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)}.page-container{flex:1;overflow-y:auto;padding:15px;padding-bottom:100px}.page{display:none}.page.active{display:block}.card{background:var(--card);padding:18px;border-radius:15px;border:1px solid var(--border);margin-bottom:20px}.section-title{color:var(--teal);font-size:16px;font-weight:bold;margin-bottom:15px;display:flex;align-items:center;gap:8px}.input-row{display:flex;gap:10px;margin-bottom:12px}.input-row div{flex:1}.form-mb{margin-bottom:12px}.section-divider{border-top:1px solid var(--border);margin:20px 0;padding-top:5px}.req{color:var(--error)}label{display:block;margin-bottom:6px;color:#94a3b8;font-size:12px}input,select,textarea{width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:12px;color:white;outline:none;font-size:14px}input:focus,select:focus,textarea:focus{border-color:var(--teal)}select option{background:#1e293b}.btn-action{background:var(--teal);color:#0a0f1d;border:none;padding:15px;border-radius:12px;font-size:16px;font-weight:bold;width:100%;cursor:pointer;transition:0.3s}.btn-action:disabled{opacity:0.3;cursor:not-allowed}.btn-outline{background:transparent;border:2px solid var(--teal);color:var(--teal);padding:13px;border-radius:12px;font-size:15px;font-weight:bold;width:100%;cursor:pointer;transition:0.3s;margin-top:10px}.nav{position:fixed;bottom:0;left:0;right:0;height:75px;background:#0f172a;display:flex;border-top:1px solid var(--border);z-index:1000}.nav-item{flex:1;color:#64748b;background:none;border:none;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:11px;cursor:pointer;transition:0.3s}.nav-item.active{color:var(--teal)}.nav-icon{font-size:20px;margin-bottom:4px}.result-box{margin-top:10px;padding:12px;background:rgba(15,212,200,0.1);border-radius:10px;font-size:14px;color:var(--teal);text-align:center;border:1px dashed var(--teal);display:none}.error-box{margin-top:10px;padding:12px;background:rgba(239,68,68,0.1);border-radius:10px;font-size:14px;color:var(--error);text-align:center;border:1px dashed var(--error);display:none}.success-box{margin-top:10px;padding:12px;background:rgba(34,197,94,0.1);border-radius:10px;font-size:14px;color:var(--success);text-align:center;border:1px dashed var(--success);display:none}.lang-switcher{display:flex;gap:5px}.lang-btn{background:transparent;border:1px solid var(--border);color:#94a3b8;padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;transition:0.3s}.lang-btn.active{border-color:var(--teal);color:var(--teal);background:rgba(15,212,200,0.1)}.terms-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}.terms-box{background:var(--card);border:1px solid var(--border);border-radius:20px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;padding:25px}.terms-title{color:var(--teal);font-size:20px;font-weight:bold;text-align:center;margin-bottom:20px}.terms-content{font-size:13px;line-height:1.8;color:#94a3b8;margin-bottom:20px;max-height:300px;overflow-y:auto;padding:15px;background:rgba(0,0,0,0.2);border-radius:10px}.terms-content h4{color:var(--text);margin:15px 0 8px;font-size:14px}.terms-content p{margin-bottom:10px}.terms-checkbox{display:flex;align-items:center;gap:12px;margin:15px 0;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;cursor:pointer}.terms-checkbox input{width:20px;height:20px;accent-color:var(--teal)}.toast{position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-100px);background:var(--card);border:1px solid var(--border);padding:15px 25px;border-radius:12px;z-index:10001;transition:0.3s;opacity:0;font-size:14px;white-space:nowrap}.toast.show{transform:translateX(-50%) translateY(0);opacity:1}.toast.error{border-color:var(--error);color:var(--error)}.toast.success{border-color:var(--success);color:var(--success)}.toast.info{border-color:var(--teal);color:var(--teal)}.wallet-card{background:linear-gradient(135deg,#0f172a 0%,#161e31 100%);border:1px solid var(--teal);border-radius:16px;padding:20px;margin-bottom:16px;position:relative;overflow:hidden}.wallet-card::before{content:'π';position:absolute;left:-8px;top:-10px;font-size:90px;color:rgba(15,212,200,0.06);font-weight:bold;pointer-events:none}.wallet-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:12px}.wallet-field{flex:1}.wallet-label{font-size:11px;color:#64748b;margin-bottom:4px}.wallet-value{font-size:13px;color:var(--teal);font-weight:bold;word-break:break-all}.badge-verified{display:inline-flex;align-items:center;gap:5px;background:rgba(34,197,94,0.12);border:1px solid var(--success);color:var(--success);padding:4px 12px;border-radius:20px;font-size:11px;font-weight:bold}.badge-pending{display:inline-flex;align-items:center;gap:5px;background:rgba(245,158,11,0.12);border:1px solid #f59e0b;color:#f59e0b;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:bold}.stats-row{display:flex;justify-content:space-around;border-top:1px solid var(--border);padding-top:20px;margin-top:20px}.stat-item{text-align:center}.stat-num{font-size:22px;font-weight:bold;color:var(--teal)}.stat-label{font-size:11px;color:#94a3b8;margin-top:3px}.nav-item[data-locked]{opacity:0.35;cursor:not-allowed}@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}`;

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Jisr Pi</title>
<script src="https://sdk.minepi.com/pi-sdk.js"></script>
<style>${APP_CSS}</style>
</head>
<body>

<div id="terms-modal" class="terms-overlay">
  <div class="terms-box">
    <div class="terms-title" data-i18n="termsTitle">اتفاقية الاستخدام</div>
    <div class="terms-content">
      <h4 data-i18n="termsSection1">1. مقدمة</h4>
      <p data-i18n="termsText1">مرحباً بك في تطبيق جسر Pi. باستخدامك لهذا التطبيق، فإنك توافق على الالتزام بشروط وأحكام الاستخدام التالية.</p>
      <h4 data-i18n="termsSection2">2. شروط الاستخدام</h4>
      <p data-i18n="termsText2">• يجب أن يكون عمرك 18 عاماً على الأقل.<br>• يُحظر استخدام التطبيق لأي أغراض غير قانونية.</p>
      <h4 data-i18n="termsSection3">3. المدفوعات</h4>
      <p data-i18n="termsText3">• جميع المدفوعات تتم عبر شبكة Pi.<br>• الرسوم غير قابلة للاسترداد بعد التأكيد.</p>
      <h4 data-i18n="termsSection4">4. الخصوصية</h4>
      <p data-i18n="termsText4">• نحمي بياناتك ولا نشاركها مع أطراف ثالثة.</p>
      <h4 data-i18n="termsSection5">5. إخلاء المسؤولية</h4>
      <p data-i18n="termsText5">• استشر مستشاراً مالياً قبل أي استثمار.</p>
    </div>
    <label class="terms-checkbox">
      <input type="checkbox" id="terms-agree" onchange="document.getElementById('terms-btn').disabled=!this.checked">
      <span data-i18n="termsAgree">أقر بأنني قرأت ووافقت على جميع الشروط</span>
    </label>
    <button class="btn-action" id="terms-btn" disabled onclick="acceptTerms()" data-i18n="termsAccept">موافقة ومتابعة</button>
  </div>
</div>

<div id="toast" class="toast"></div>

<div class="header">
  <div id="u-tag" style="color:var(--teal); font-size:12px;">...</div>
  <div style="font-weight:bold;">جسر Pi</div>
  <div class="lang-switcher">
    <button class="lang-btn active" onclick="setLang('ar')" data-lang="ar">عربي</button>
    <button class="lang-btn" onclick="setLang('en')" data-lang="en">EN</button>
    <button class="lang-btn" onclick="setLang('zh')" data-lang="zh">中文</button>
  </div>
</div>

<div class="page-container">

  <div id="p-home" class="page active">
    <div class="card" style="text-align:center; padding:30px 15px;">
      <h2 style="color:var(--teal); font-size:24px; margin-bottom:10px;">Jisr Pi</h2>
      <p style="color:#94a3b8;" data-i18n="welcome">مرحباً بك في جسر الاستثمار</p>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px; font-size:16px;" data-i18n="agreementTitle">📄 اتفاقية الاستخدام</h3>
      <p style="font-size:13px; color:#94a3b8; line-height:1.6; margin-bottom:15px;" data-i18n="agreementText">من خلال استخدامك للمنصة، أنت توافق على سياسات الخصوصية وشروط العمل في شبكة Pi.</p>
      <label style="display:flex; align-items:center; gap:12px; cursor:pointer; background:rgba(255,255,255,0.03); padding:10px; border-radius:8px;">
        <input type="checkbox" id="agree-check" style="width:20px; height:20px;" onchange="toggleButtons()">
        <span style="font-size:14px;" data-i18n="agreeCheck">أوافق على الشروط والقوانين</span>
      </label>
    </div>
  </div>

  <div id="p-create" class="page">
    <div class="card" style="border:1px solid var(--teal); background:rgba(15,212,200,0.03);">
      <div class="section-title" data-i18n="calcTitle">📊 حاسبة الاستثمار</div>
      <div class="input-row">
        <div><label data-i18n="targetLabel">هدف التمويل</label><input type="number" id="target" placeholder="500000" oninput="calculate()"></div>
        <div><label data-i18n="typeLabel">نوع المشروع</label>
          <select id="type">
            <option value="stocks" data-i18n="typeStocks">أسهم</option>
            <option value="murabaha" data-i18n="typeMurabaha">مرابحة</option>
            <option value="partnership" data-i18n="typePartnership">شراكة</option>
            <option value="loan" data-i18n="typeLoan">قرض</option>
          </select>
        </div>
      </div>
      <div class="input-row">
        <div><label data-i18n="roiLabel">العائد المتوقع (%)</label><input type="number" id="roi" placeholder="25" oninput="calculate()"></div>
        <div><label data-i18n="yearsLabel">المدة (سنوات)</label><input type="number" id="years" placeholder="3" oninput="calculate()"></div>
      </div>
      <div id="calc-result" class="result-box"></div>
    </div>

    <div class="card">
      <div class="section-title" data-i18n="basicInfo">📝 بيانات المشروع</div>
      <div class="form-mb"><label data-i18n="projectNameLabel">اسم المشروع <span class="req">*</span></label><input type="text" id="project-name" placeholder="Pi Smart Cafe"></div>
      <div class="input-row">
        <div><label data-i18n="categoryLabel">فئة المشروع <span class="req">*</span></label>
          <select id="proj-category"><option value="">--</option><option value="cafe">☕ مطعم/كافيه</option><option value="tech">💻 تقنية</option><option value="retail">🛒 تجزئة</option><option value="service">🔧 خدمات</option><option value="agri">🌾 زراعة</option><option value="edu">📚 تعليم</option><option value="health">🏥 صحة</option><option value="real_estate">🏠 عقارات</option><option value="industry">🏭 صناعة</option><option value="other">🎯 أخرى</option></select>
        </div>
        <div><label data-i18n="stageLabel">مرحلة المشروع <span class="req">*</span></label>
          <select id="proj-stage"><option value="">--</option><option value="idea">💡 فكرة فقط</option><option value="plan">📋 خطة عمل</option><option value="mvp">🔨 نموذج أولي</option><option value="running">⚡ يعمل حالياً</option><option value="expand">📈 توسعة</option></select>
        </div>
      </div>
      <div class="input-row">
        <div><label data-i18n="countryLabel">الدولة <span class="req">*</span></label>
          <select id="proj-country"><option value="">--</option><option value="sa">🇸🇦 السعودية</option><option value="ae">🇦🇪 الإمارات</option><option value="eg">🇪🇬 مصر</option><option value="iq">🇮🇶 العراق</option><option value="jo">🇯🇴 الأردن</option><option value="ma">🇲🇦 المغرب</option><option value="us">🇺🇸 أمريكا</option><option value="cn">🇨🇳 الصين</option><option value="other">🌍 أخرى</option></select>
        </div>
        <div><label data-i18n="teamSizeLabel">حجم الفريق</label>
          <select id="proj-teamsize"><option value="">--</option><option value="solo">👤 فرد واحد</option><option value="2-5">👥 2-5 أشخاص</option><option value="6-10">👥 6-10 أشخاص</option><option value="10+">🏢 أكثر من 10</option></select>
        </div>
      </div>
      <div class="input-row">
        <div><label data-i18n="fundingLabel">التمويل المطلوب (Pi) <span class="req">*</span></label><input type="number" id="proj-funding" placeholder="50000"></div>
        <div><label data-i18n="durationLabel">المدة (شهور)</label><input type="number" id="proj-duration" placeholder="12"></div>
      </div>
      <div class="input-row">
        <div><label data-i18n="invRoiLabel">العائد للمستثمر (%)</label><input type="number" id="proj-inv-roi" placeholder="15"></div>
        <div><label data-i18n="minInvLabel">أدنى استثمار (Pi)</label><input type="number" id="proj-min-inv" placeholder="100"></div>
      </div>
      <div class="form-mb"><label data-i18n="founderExpLabel">خبرة المؤسس</label>
        <select id="proj-exp"><option value="">--</option><option value="beginner">🌱 مبتدئ (1-2 سنة)</option><option value="mid">📊 متوسط (3-5 سنوات)</option><option value="senior">🏆 خبير (5+ سنوات)</option></select>
      </div>
      <div class="form-mb"><label data-i18n="descLabel">وصف المشروع <span class="req">*</span></label><textarea id="proj-desc" rows="3" placeholder="اشرح فكرة مشروعك وما الذي يميزه..."></textarea></div>
      <div class="form-mb"><label data-i18n="teamLabel">أعضاء الفريق</label><textarea id="team-members" rows="2" placeholder="مثال: أحمد - مطور، سارة - تسويق..."></textarea></div>
      <div class="form-mb"><label data-i18n="pitchLabel">العرض للمستثمرين <span class="req">*</span></label><textarea id="pitch" rows="3" placeholder="قدّم مشروعك بشكل مقنع للمستثمرين..."></textarea></div>
      <div class="input-row">
        <div><label data-i18n="websiteLabel">الموقع الإلكتروني</label><input type="url" id="proj-website" placeholder="https://..."></div>
        <div><label data-i18n="socialLabel">التواصل الاجتماعي</label><input type="url" id="proj-social" placeholder="https://..."></div>
      </div>
      <div id="create-error" class="error-box"></div>
      <div id="create-success" class="success-box"></div>
      <button class="btn-action main-btn" style="margin-top:20px;" disabled onclick="publishProject()" data-i18n="publishBtn">نشر المشروع (0.002 Pi)</button>
    </div>
  </div>

  <div id="p-mentors" class="page">
    <div class="card" style="text-align:center;">
      <div style="font-size:40px; margin-bottom:10px;">🎓</div>
      <h3 style="color:var(--teal); font-size:20px;" data-i18n="mentorName">فوزي أحمد منصور</h3>
      <p style="color:#94a3b8; font-size:14px; margin:10px 0;" data-i18n="mentorTitle">مستشار تطوير أعمال وخبير مبيعات</p>
      <div style="text-align:right; font-size:13px; background:rgba(0,0,0,0.2); padding:10px; border-radius:10px; margin-bottom:15px;" data-i18n="mentorServices">• استشارات في هيكلة المشاريع<br>• دراسة جدوى مبدئية<br>• نصائح للتوسع في سوق Pi</div>
      <div id="mentor-error" class="error-box"></div>
      <div id="mentor-success" class="success-box"></div>
      <button class="btn-action main-btn" disabled onclick="bookConsultation()" data-i18n="consultBtn">حجز جلسة استشارية (0.0001 Pi)</button>
    </div>
    <div class="section-divider"></div>
    <div class="card">
      <div class="section-title" style="justify-content:center;" data-i18n="joinTitle">💼 طلب انضمام مستثمر</div>
      <p style="text-align:center; color:#94a3b8; font-size:13px; margin-bottom:16px;" data-i18n="joinSub">أكمل بياناتك وسنتواصل معك خلال 48 ساعة</p>
      <div class="form-mb"><label data-i18n="fullNameLabel">الاسم الكامل <span class="req">*</span></label><input type="text" id="j-name" placeholder="أحمد محمد علي"></div>
      <div class="input-row">
        <div><label>Pi Username <span class="req">*</span></label><input type="text" id="j-piuser" placeholder="@username"></div>
        <div><label data-i18n="phoneLabel">الهاتف</label><input type="tel" id="j-phone" placeholder="+966..."></div>
      </div>
      <div class="form-mb"><label>Email <span class="req">*</span></label><input type="email" id="j-email" placeholder="example@email.com"></div>
      <div class="input-row">
        <div><label data-i18n="countryLabel">الدولة <span class="req">*</span></label>
          <select id="j-country"><option value="">--</option><option value="sa">🇸🇦 السعودية</option><option value="ae">🇦🇪 الإمارات</option><option value="eg">🇪🇬 مصر</option><option value="iq">🇮🇶 العراق</option><option value="jo">🇯🇴 الأردن</option><option value="ma">🇲🇦 المغرب</option><option value="us">🇺🇸 أمريكا</option><option value="cn">🇨🇳 الصين</option><option value="uk">🇬🇧 بريطانيا</option><option value="other">🌍 أخرى</option></select>
        </div>
        <div><label data-i18n="prefLangLabel">اللغة المفضلة</label>
          <select id="j-lang"><option value="ar">🇦🇪 العربية</option><option value="en">🇬🇧 الإنجليزية</option><option value="zh">🇨🇳 الصينية</option></select>
        </div>
      </div>
      <div class="input-row">
        <div><label data-i18n="invAmountLabel">مبلغ الاستثمار (Pi) <span class="req">*</span></label><input type="number" id="j-amount" placeholder="10000" min="100"></div>
        <div><label data-i18n="invTypeLabel">نوع الاستثمار <span class="req">*</span></label>
          <select id="j-inv-type"><option value="">--</option><option value="stocks">📈 أسهم</option><option value="partnership">🤝 شراكة</option><option value="murabaha">💰 مرابحة</option><option value="mixed">🔀 متنوع</option></select>
        </div>
      </div>
      <div class="input-row">
        <div><label data-i18n="sectorLabel">القطاع المفضل</label>
          <select id="j-sector"><option value="">--</option><option value="tech">💻 تقنية</option><option value="food">🍽️ طعام وشراب</option><option value="health">🏥 صحة</option><option value="edu">📚 تعليم</option><option value="real_estate">🏠 عقارات</option><option value="agri">🌾 زراعة</option><option value="any">🌐 أي قطاع</option></select>
        </div>
        <div><label data-i18n="expLabel">مستوى الخبرة <span class="req">*</span></label>
          <select id="j-exp"><option value="">--</option><option value="beginner">🌱 مبتدئ</option><option value="intermediate">📊 متوسط</option><option value="advanced">🏆 متقدم</option><option value="expert">💎 خبير</option></select>
        </div>
      </div>
      <div class="form-mb"><label data-i18n="fundSrcLabel">مصدر التمويل</label>
        <select id="j-fund-src"><option value="">--</option><option value="mining">⛏️ تعدين Pi</option><option value="purchase">💵 شراء Pi</option><option value="both">🔀 كلاهما</option></select>
      </div>
      <div class="form-mb"><label data-i18n="notesLabel">ملاحظات إضافية</label><textarea id="j-notes" rows="2" placeholder="أي معلومات إضافية تريد إضافتها..."></textarea></div>
      <label style="display:flex; align-items:flex-start; gap:10px; margin:14px 0; padding:11px; background:rgba(255,255,255,0.03); border-radius:10px; cursor:pointer;">
        <input type="checkbox" id="j-agree" style="width:18px; height:18px; margin-top:2px; accent-color:var(--teal); flex-shrink:0;">
        <span style="font-size:12px; line-height:1.6;" data-i18n="joinAgreeText">أقر بأنني مستثمر حقيقي وأتحمل المسؤولية الكاملة عن قراراتي الاستثمارية، وأوافق على التواصل من فريق جسر Pi.</span>
      </label>
      <div id="join-error" class="error-box"></div>
      <div id="join-success" class="success-box"></div>
      <button class="btn-outline" onclick="submitJoin()" data-i18n="joinBtn">📤 إرسال طلب الانضمام</button>
    </div>
  </div>

  <div id="p-profile" class="page">
    <div class="card" style="text-align:center; padding:30px 20px;">
      <div style="font-size:60px; margin-bottom:12px;">👤</div>
      <h2 id="u-name" style="margin-bottom:10px;">...</h2>
      <div id="kyc-badge-area"><div style="display:inline-block; background:var(--teal); color:#0a0f1d; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:bold;" data-i18n="verified">حساب موثق</div></div>
      <div class="stats-row">
        <div class="stat-item"><div class="stat-num" id="user-projects">0</div><div class="stat-label" data-i18n="projectsLabel">مشاريع</div></div>
        <div class="stat-item"><div class="stat-num" id="user-investments">0</div><div class="stat-label" data-i18n="investmentsLabel">استثمارات</div></div>
      </div>
    </div>
    <div class="wallet-card">
      <div class="section-title" style="margin-bottom:14px;">🪙 <span data-i18n="walletTitle">محفظة Pi</span></div>
      <div class="wallet-row">
        <div class="wallet-field"><div class="wallet-label" data-i18n="walletUserLabel">اسم المستخدم</div><div class="wallet-value" id="w-username">—</div></div>
        <div class="wallet-field"><div class="wallet-label" data-i18n="walletStatusLabel">حالة التوثيق</div><div id="w-kyc-status" style="margin-top:4px;">—</div></div>
      </div>
      <div><div class="wallet-label" data-i18n="walletUidLabel">معرّف الحساب (UID)</div><div class="wallet-value" id="w-uid" style="font-size:11px; margin-top:4px;">—</div></div>
    </div>
    <div class="card">
      <div class="section-title" data-i18n="paymentHistory">📋 سجل المدفوعات</div>
      <div id="payment-list" style="font-size:13px; color:#94a3b8;"><p data-i18n="noPayments">لا توجد مدفوعات حتى الآن</p></div>
    </div>
  </div>

</div>

<nav class="nav">
  <button type="button" class="nav-item active" onclick="showPage('home',this)"><span class="nav-icon">🏠</span><span data-i18n="navHome">الرئيسية</span></button>
  <button type="button" class="nav-item" data-locked onclick="showPage('create',this)"><span class="nav-icon">➕</span><span data-i18n="navCreate">إنشاء</span></button>
  <button type="button" class="nav-item" data-locked onclick="showPage('mentors',this)"><span class="nav-icon">🎓</span><span data-i18n="navMentors">المرشدون</span></button>
  <button type="button" class="nav-item" data-locked onclick="showPage('profile',this)"><span class="nav-icon">👤</span><span data-i18n="navProfile">الملف</span></button>
</nav>

<script>
const i18n = {
  ar: {
    termsTitle:"اتفاقية الاستخدام", termsSection1:"1. مقدمة", termsText1:"مرحباً بك في تطبيق جسر Pi. باستخدامك لهذا التطبيق، فإنك توافق على الشروط التالية.", termsSection2:"2. شروط الاستخدام", termsText2:"• يجب أن يكون عمرك 18 عاماً على الأقل.<br>• يُحظر استخدام التطبيق لأي أغراض غير قانونية.", termsSection3:"3. المدفوعات", termsText3:"• جميع المدفوعات تتم عبر شبكة Pi.<br>• الرسوم غير قابلة للاسترداد.", termsSection4:"4. الخصوصية", termsText4:"• نحمي بياناتك ولا نشاركها مع أطراف ثالثة.", termsSection5:"5. إخلاء المسؤولية", termsText5:"• استشر مستشاراً مالياً قبل أي استثمار.", termsAgree:"أقر بأنني قرأت ووافقت على جميع الشروط", termsAccept:"موافقة ومتابعة",
    welcome:"مرحباً بك في جسر الاستثمار", agreementTitle:"📄 اتفاقية الاستخدام", agreementText:"من خلال استخدامك للمنصة، أنت توافق على سياسات الخصوصية وشروط العمل في شبكة Pi.", agreeCheck:"أوافق على الشروط والقوانين",
    calcTitle:"📊 حاسبة الاستثمار", targetLabel:"هدف التمويل", typeLabel:"نوع المشروع", typeStocks:"أسهم", typeMurabaha:"مرابحة", typePartnership:"شراكة", typeLoan:"قرض", roiLabel:"العائد المتوقع (%)", yearsLabel:"المدة (سنوات)",
    basicInfo:"📝 بيانات المشروع", projectNameLabel:"اسم المشروع", categoryLabel:"فئة المشروع", stageLabel:"مرحلة المشروع", countryLabel:"الدولة", teamSizeLabel:"حجم الفريق", fundingLabel:"التمويل المطلوب (Pi)", durationLabel:"المدة (شهور)", invRoiLabel:"العائد للمستثمر (%)", minInvLabel:"أدنى استثمار (Pi)", founderExpLabel:"خبرة المؤسس", descLabel:"وصف المشروع", teamLabel:"أعضاء الفريق", pitchLabel:"العرض للمستثمرين", websiteLabel:"الموقع الإلكتروني", socialLabel:"التواصل الاجتماعي", publishBtn:"نشر المشروع (0.002 Pi)",
    mentorName:"فوزي أحمد منصور", mentorTitle:"مستشار تطوير أعمال وخبير مبيعات", mentorServices:"• استشارات في هيكلة المشاريع<br>• دراسة جدوى مبدئية<br>• نصائح للتوسع في سوق Pi", consultBtn:"حجز جلسة استشارية (0.0001 Pi)",
    joinTitle:"💼 طلب انضمام مستثمر", joinSub:"أكمل بياناتك وسنتواصل معك خلال 48 ساعة", fullNameLabel:"الاسم الكامل", phoneLabel:"الهاتف", prefLangLabel:"اللغة المفضلة", invAmountLabel:"مبلغ الاستثمار (Pi)", invTypeLabel:"نوع الاستثمار", sectorLabel:"القطاع المفضل", expLabel:"مستوى الخبرة", fundSrcLabel:"مصدر التمويل", notesLabel:"ملاحظات إضافية", joinAgreeText:"أقر بأنني مستثمر حقيقي وأتحمل المسؤولية الكاملة عن قراراتي الاستثمارية.", joinBtn:"📤 إرسال طلب الانضمام",
    verified:"حساب موثق", projectsLabel:"مشاريع", investmentsLabel:"استثمارات", walletTitle:"محفظة Pi", walletUserLabel:"اسم المستخدم", walletStatusLabel:"حالة التوثيق", walletUidLabel:"معرّف الحساب (UID)", kycVerified:"✅ موثق KYC", kycPending:"⏳ KYC قيد المراجعة", paymentHistory:"📋 سجل المدفوعات", noPayments:"لا توجد مدفوعات حتى الآن",
    navHome:"الرئيسية", navCreate:"إنشاء", navMentors:"المرشدون", navProfile:"الملف", calcProfit:"الأرباح المتوقعة:", calcTotal:"الإجمالي مع رأس المال:", paymentSuccess:"✅ تمت العملية بنجاح!", paymentError:"⚠️ خطأ في الدفع", piBrowserError:"⚠️ يرجى استخدام متصفح Pi", fillFields:"يرجى ملء جميع الحقول المطلوبة", projectPublished:"✅ تم نشر المشروع بنجاح!", consultationBooked:"✅ تم حجز الاستشارة!", joinSent:"✅ تم إرسال طلبك! سنتواصل خلال 48 ساعة", serverError:"⚠️ خطأ في الاتصال بالخادم"
  },
  en: {
    termsTitle:"Terms of Service", termsSection1:"1. Introduction", termsText1:"Welcome to Jisr Pi. By using this app, you agree to the following terms.", termsSection2:"2. Terms of Use", termsText2:"• You must be at least 18 years old.<br>• Illegal use is prohibited.", termsSection3:"3. Payments", termsText3:"• All payments via Pi Network.<br>• Fees are non-refundable.", termsSection4:"4. Privacy", termsText4:"• We protect your data and don't share it.", termsSection5:"5. Disclaimer", termsText5:"• Consult a financial advisor before investing.", termsAgree:"I confirm I have read and agreed to all terms", termsAccept:"Accept & Continue",
    welcome:"Welcome to the first investment bridge", agreementTitle:"📄 Terms of Service", agreementText:"By using the platform, you agree to Pi Network privacy policies and terms.", agreeCheck:"I agree to the terms and conditions",
    calcTitle:"📊 Investment Calculator", targetLabel:"Funding Target", typeLabel:"Project Type", typeStocks:"Stocks", typeMurabaha:"Murabaha", typePartnership:"Partnership", typeLoan:"Loan", roiLabel:"Expected Return (%)", yearsLabel:"Duration (Years)",
    basicInfo:"📝 Project Details", projectNameLabel:"Project Name", categoryLabel:"Category", stageLabel:"Project Stage", countryLabel:"Country", teamSizeLabel:"Team Size", fundingLabel:"Funding Needed (Pi)", durationLabel:"Duration (months)", invRoiLabel:"Investor Return (%)", minInvLabel:"Min Investment (Pi)", founderExpLabel:"Founder Experience", descLabel:"Project Description", teamLabel:"Team Members", pitchLabel:"Pitch to Investors", websiteLabel:"Website", socialLabel:"Social Media", publishBtn:"Publish Project (0.002 Pi)",
    mentorName:"Fawzi Ahmed Mansour", mentorTitle:"Business Development Advisor & Sales Expert", mentorServices:"• Project structuring consultations<br>• Preliminary feasibility study<br>• Tips for Pi market expansion", consultBtn:"Book Consultation (0.0001 Pi)",
    joinTitle:"💼 Investor Join Request", joinSub:"Fill your details, we will contact within 48h", fullNameLabel:"Full Name", phoneLabel:"Phone", prefLangLabel:"Preferred Language", invAmountLabel:"Investment Amount (Pi)", invTypeLabel:"Investment Type", sectorLabel:"Preferred Sector", expLabel:"Experience Level", fundSrcLabel:"Funding Source", notesLabel:"Additional Notes", joinAgreeText:"I confirm I am a real investor and take full responsibility for my investment decisions.", joinBtn:"📤 Submit Join Request",
    verified:"Verified Account", projectsLabel:"Projects", investmentsLabel:"Investments", walletTitle:"Pi Wallet", walletUserLabel:"Username", walletStatusLabel:"Verification Status", walletUidLabel:"Account UID", kycVerified:"✅ KYC Verified", kycPending:"⏳ KYC Pending", paymentHistory:"📋 Payment History", noPayments:"No payments yet",
    navHome:"Home", navCreate:"Create", navMentors:"Mentors", navProfile:"Profile", calcProfit:"Expected Profit:", calcTotal:"Total with Capital:", paymentSuccess:"✅ Transaction completed!", paymentError:"⚠️ Payment error", piBrowserError:"⚠️ Please use Pi Browser", fillFields:"Please fill all required fields", projectPublished:"✅ Project published!", consultationBooked:"✅ Consultation booked!", joinSent:"✅ Request sent! We will contact within 48h", serverError:"⚠️ Server connection error"
  },
  zh: {
    termsTitle:"服务条款", termsSection1:"1. 简介", termsText1:"欢迎使用Jisr Pi。使用本应用即表示您同意以下条款。", termsSection2:"2. 使用条款", termsText2:"• 您必须年满18岁。<br>• 禁止非法使用。", termsSection3:"3. 付款", termsText3:"• 所有付款通过Pi网络。<br>• 费用不予退还。", termsSection4:"4. 隐私", termsText4:"• 我们保护您的数据不与第三方共享。", termsSection5:"5. 免责声明", termsText5:"• 投资前请咨询财务顾问。", termsAgree:"我确认已阅读并同意所有条款", termsAccept:"同意并继续",
    welcome:"欢迎来到第一投资桥梁", agreementTitle:"📄 服务条款", agreementText:"使用平台即表示您同意Pi网络的隐私政策和使用条款。", agreeCheck:"我同意条款和条件",
    calcTitle:"📊 投资计算器", targetLabel:"融资目标", typeLabel:"项目类型", typeStocks:"股票", typeMurabaha:"Murabaha", typePartnership:"合伙", typeLoan:"贷款", roiLabel:"预期回报 (%)", yearsLabel:"期限 (年)",
    basicInfo:"📝 项目详情", projectNameLabel:"项目名称", categoryLabel:"类别", stageLabel:"项目阶段", countryLabel:"国家", teamSizeLabel:"团队规模", fundingLabel:"所需资金 (Pi)", durationLabel:"期限 (月)", invRoiLabel:"投资者回报 (%)", minInvLabel:"最低投资 (Pi)", founderExpLabel:"创始人经验", descLabel:"项目描述", teamLabel:"团队成员", pitchLabel:"向投资者介绍", websiteLabel:"网站", socialLabel:"社交媒体", publishBtn:"发布项目 (0.002 Pi)",
    mentorName:"Fawzi Ahmed Mansour", mentorTitle:"业务发展顾问和销售专家", mentorServices:"• 项目结构咨询<br>• 初步可行性研究<br>• Pi市场扩展建议", consultBtn:"预约咨询 (0.0001 Pi)",
    joinTitle:"💼 投资者加入申请", joinSub:"填写您的信息，我们将在48小时内联系您", fullNameLabel:"全名", phoneLabel:"电话", prefLangLabel:"首选语言", invAmountLabel:"投资金额 (Pi)", invTypeLabel:"投资类型", sectorLabel:"首选行业", expLabel:"经验水平", fundSrcLabel:"资金来源", notesLabel:"补充说明", joinAgreeText:"我确认我是真正的投资者，并对我的投资决定负全部责任。", joinBtn:"📤 提交申请",
    verified:"已验证账户", projectsLabel:"项目", investmentsLabel:"投资", walletTitle:"Pi 钱包", walletUserLabel:"用户名", walletStatusLabel:"验证状态", walletUidLabel:"账户 UID", kycVerified:"✅ KYC 已验证", kycPending:"⏳ KYC 待审核", paymentHistory:"📋 付款记录", noPayments:"暂无付款记录",
    navHome:"首页", navCreate:"创建", navMentors:"导师", navProfile:"个人资料", calcProfit:"预期利润:", calcTotal:"含本金总额:", paymentSuccess:"✅ 交易成功！", paymentError:"⚠️ 付款错误", piBrowserError:"⚠️ 请使用Pi浏览器", fillFields:"请填写所有必填字段", projectPublished:"✅ 项目发布成功！", consultationBooked:"✅ 咨询预约成功！", joinSent:"✅ 已发送！我们将在48小时内联系您", serverError:"⚠️ 服务器连接错误"
  }
};

let currentLang = 'ar', currentUser = null, termsAccepted = false;
const Pi = window.Pi;
function t(key) { return i18n[currentLang][key] || i18n['ar'][key] || key; }
function escHtml(str) { const d = document.createElement('div'); d.appendChild(document.createTextNode(String(str || ''))); return d.innerHTML; }
function setLang(lang) {
  currentLang = lang; document.documentElement.lang = lang; document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
  document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.lang === lang));
  document.querySelectorAll('[data-i18n]').forEach(el => { const key = el.dataset.i18n; if (i18n[lang][key]) el.innerHTML = i18n[lang][key]; });
  calculate();
}
async function init() {
  try {
    await Pi.init({ version: "2.0", sandbox: true });
    const auth = await Pi.authenticate(["username", "payments"], async function(incompletePmt) {
      try { if (incompletePmt && incompletePmt.transaction && incompletePmt.transaction.txid) {
        await fetch('/api/complete-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId: incompletePmt.identifier, txid: incompletePmt.transaction.txid }) });
      }} catch(e) { console.error('incomplete payment error:', e); }
    });
    if (auth && auth.user) {
      currentUser = auth.user; const uname = auth.user.username || '';
      document.getElementById('u-tag').textContent = '@' + uname;
      document.getElementById('u-name').textContent = '@' + uname;
      document.getElementById('w-username').textContent = '@' + uname;
      document.getElementById('w-uid').textContent = auth.user.uid || '—';
      const kycEl = document.getElementById('w-kyc-status');
      const credentials = auth.user.credentials;
      const isVerified = credentials && credentials.scopes && credentials.scopes.includes('payments');
      const badge = document.createElement('span');
      badge.className = isVerified ? 'badge-verified' : 'badge-pending';
      badge.textContent = isVerified ? t('kycVerified') : t('kycPending');
      kycEl.innerHTML = ''; kycEl.appendChild(badge);
      await loadUserData(uname);
    }
  } catch (e) { console.error("Pi init error:", e); showToast(t('piBrowserError'), 'error'); }
  finally { document.getElementById('terms-modal').style.display = termsAccepted ? 'none' : 'flex'; }
}
async function loadUserData(username) {
  try { const res = await fetch('/api/get-user?username=' + encodeURIComponent(username)); const data = await res.json();
    if (data.projects !== undefined) { document.getElementById('user-projects').innerText = data.projects; document.getElementById('user-investments').innerText = data.investments; }
  } catch (e) { console.error("Load user error:", e); }
}
function acceptTerms() {
  termsAccepted = true; document.getElementById('terms-modal').style.display = 'none';
  document.querySelectorAll('.nav-item').forEach(n => n.removeAttribute('data-locked'));
  showToast(t('termsAccept'), 'success');
}
function toggleButtons() { const ok = document.getElementById('agree-check').checked; document.querySelectorAll('.main-btn').forEach(b => b.disabled = !ok); }
function calculate() {
  const target = parseFloat(document.getElementById('target').value), roi = parseFloat(document.getElementById('roi').value), years = parseFloat(document.getElementById('years').value), resBox = document.getElementById('calc-result');
  if (target > 0 && roi > 0 && years > 0) { const profit = (target * (roi/100) * years).toFixed(2); const total = (target + parseFloat(profit)).toFixed(2); resBox.style.display = "block"; resBox.innerHTML = '<b>' + t('calcProfit') + '</b> ' + profit + ' Pi<br><b>' + t('calcTotal') + '</b> ' + total + ' Pi'; }
  else { resBox.style.display = "none"; }
}
function showPage(id, el) {
  if (!termsAccepted && id !== 'home') {
    const modal = document.getElementById('terms-modal'); modal.style.display = 'flex';
    modal.querySelector('.terms-box').style.animation = 'shake 0.4s ease';
    setTimeout(() => { modal.querySelector('.terms-box').style.animation = ''; }, 400);
    showToast(currentLang === 'ar' ? '⚠️ يجب الموافقة على الشروط أولاً' : currentLang === 'en' ? '⚠️ Please accept the terms first' : '⚠️ 请先接受条款', 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('p-' + id).classList.add('active'); el.classList.add('active');
}
function showToast(message, type) { const toast = document.getElementById('toast'); toast.innerText = message; toast.className = 'toast ' + (type || 'info'); setTimeout(() => toast.classList.add('show'), 10); setTimeout(() => toast.classList.remove('show'), 3500); }
function showError(id, msg) { const el = document.getElementById(id); el.innerText = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 5000); }
function showSuccess(id, msg) { const el = document.getElementById(id); el.innerText = msg; el.style.display = 'block'; setTimeout(() => el.style.display = 'none', 5000); }
async function pay(amt, memo, onSuccess) {
  if (!currentUser) { showToast(t('piBrowserError'), 'error'); return; }
  try {
    await Pi.createPayment(
      { amount: amt, memo: memo, metadata: { type: memo, username: currentUser.username } },
      {
        onReadyForServerApproval: async function(paymentId) {
          try { const res = await fetch('/api/approve-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId, username: currentUser.username, amount: amt, memo: memo }) }); const data = await res.json(); if (!data.success) throw new Error(data.error || 'Approval failed'); }
          catch (e) { console.error('Approval error:', e); showToast(t('serverError'), 'error'); }
        },
        onReadyForServerCompletion: async function(paymentId, txid) {
          try { const res = await fetch('/api/complete-payment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId, txid }) }); const data = await res.json(); if (data.success) { showToast(t('paymentSuccess'), 'success'); if (onSuccess) onSuccess(paymentId, txid); await loadUserData(currentUser.username); } }
          catch (e) { console.error('Completion error:', e); }
        },
        onCancel: function() { showToast(t('paymentError') + ' Cancelled', 'error'); },
        onError: function(error) { console.error('Payment error:', error); showToast(t('paymentError'), 'error'); }
      }
    );
  } catch (e) { showToast(t('piBrowserError'), 'error'); }
}
async function publishProject() {
  const name = document.getElementById('project-name').value.trim(), cat = document.getElementById('proj-category').value, stage = document.getElementById('proj-stage').value, desc = document.getElementById('proj-desc').value.trim(), pitch = document.getElementById('pitch').value.trim(), team = document.getElementById('team-members').value.trim();
  if (!name || !cat || !stage || !desc || !pitch) { showError('create-error', t('fillFields')); return; }
  await pay(0.002, 'Listing Fee', async function(paymentId, txid) {
    try { const res = await fetch('/api/save-project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser.username, project: { name, cat, stage, desc, pitch, team, type: document.getElementById('type').value, country: document.getElementById('proj-country').value, teamsize: document.getElementById('proj-teamsize').value, funding: document.getElementById('proj-funding').value, duration: document.getElementById('proj-duration').value, invRoi: document.getElementById('proj-inv-roi').value, minInv: document.getElementById('proj-min-inv').value, exp: document.getElementById('proj-exp').value, website: document.getElementById('proj-website').value, social: document.getElementById('proj-social').value } }) }); const data = await res.json(); if (data.success) { showSuccess('create-success', t('projectPublished')); ['project-name','proj-desc','team-members','pitch','proj-website','proj-social','proj-funding','proj-duration','proj-inv-roi','proj-min-inv'].forEach(id => document.getElementById(id).value = ''); ['proj-category','proj-stage','proj-country','proj-teamsize','proj-exp'].forEach(id => document.getElementById(id).value = ''); } }
    catch (e) { showError('create-error', t('serverError')); }
  });
}
async function bookConsultation() { await pay(0.0001, 'Consultation', function() { showSuccess('mentor-success', t('consultationBooked')); }); }
async function submitJoin() {
  const name = document.getElementById('j-name').value.trim(), piuser = document.getElementById('j-piuser').value.trim(), email = document.getElementById('j-email').value.trim(), country = document.getElementById('j-country').value, amount = parseFloat(document.getElementById('j-amount').value), invType = document.getElementById('j-inv-type').value, exp = document.getElementById('j-exp').value, agree = document.getElementById('j-agree').checked;
  if (!name || name.length < 2) { showError('join-error', '⚠️ ' + t('fillFields')); return; }
  if (!piuser) { showError('join-error', '⚠️ ' + t('fillFields')); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('join-error', '⚠️ البريد الإلكتروني غير صحيح'); return; }
  if (!country) { showError('join-error', '⚠️ ' + t('fillFields')); return; }
  if (isNaN(amount) || amount < 100) { showError('join-error', '⚠️ أدنى مبلغ استثمار هو 100 Pi'); return; }
  if (!invType) { showError('join-error', '⚠️ ' + t('fillFields')); return; }
  if (!exp) { showError('join-error', '⚠️ ' + t('fillFields')); return; }
  if (!agree) { showError('join-error', '⚠️ يجب الموافقة على الإقرار أولاً'); return; }
  try { const res = await fetch('/api/save-investor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: currentUser ? currentUser.username : piuser, investor: { name, piuser, email, phone: document.getElementById('j-phone').value.trim(), country, lang: document.getElementById('j-lang').value, amount, invType, sector: document.getElementById('j-sector').value, exp, fundSrc: document.getElementById('j-fund-src').value, notes: document.getElementById('j-notes').value.trim() } }) }); const data = await res.json(); if (!data.success) { showError('join-error', '⚠️ ' + (data.error || t('serverError'))); return; } }
  catch { showError('join-error', '⚠️ ' + t('serverError')); return; }
  showSuccess('join-success', t('joinSent'));
  ['j-name','j-piuser','j-phone','j-email','j-amount','j-notes'].forEach(id => document.getElementById(id).value = '');
  ['j-country','j-lang','j-inv-type','j-sector','j-exp','j-fund-src'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('j-agree').checked = false;
}
setLang(currentLang);
init();
</script>
</body>
</html>`;

    return new Response(html, {
      headers: {
        ...CONFIG.SEC_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate"
      }
    });
  }
};
