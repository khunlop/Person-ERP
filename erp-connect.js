/**
 * ═══════════════════════════════════════════════════════════════
 *  คนตัวหอม ERP — Frontend ↔ Google Apps Script Bridge
 *  File : erp-connect.js
 *  ใช้ <script src="erp-connect.js"> ใน index.html
 * ═══════════════════════════════════════════════════════════════
 */

// ─────────────────────────────────────────────────────────────
//  1. CONFIG  ← แก้ GAS_URL หลัง Deploy
// ─────────────────────────────────────────────────────────────

window.ERP = window.ERP || {};

ERP.CONFIG = {
  // ↓↓↓ วาง Web App URL ที่ได้จาก Apps Script Deploy ตรงนี้ ↓↓↓
  GAS_URL      : "https://script.google.com/macros/s/AKfycbwCPppfl-lz0NUmD5CxSNhXR_nLxq0QROE6Ue3bvvnmQwZj2D5oO28LYyLKgul4jFdTAg/exec",
  POLL_INTERVAL: 30_000,   // ms — polling interval สำหรับ realtime data
  TIMEOUT_MS   : 20_000,   // ms — request timeout
  RETRY_TIMES  : 2,         // จำนวน retry เมื่อ request ล้มเหลว
  VERSION      : "2.5",
};

// ─────────────────────────────────────────────────────────────
//  2. SESSION STORE
// ─────────────────────────────────────────────────────────────

ERP.session = {
  _token : sessionStorage.getItem("erp_token") || localStorage.getItem("erp_token"),
  _user  : JSON.parse(sessionStorage.getItem("erp_user") || localStorage.getItem("erp_user") || "null"),

  set(token, user, remember) {
    this._token = token;
    this._user  = user;
    const store = remember ? localStorage : sessionStorage;
    store.setItem("erp_token", token);
    store.setItem("erp_user", JSON.stringify(user));
  },

  clear() {
    this._token = null;
    this._user  = null;
    sessionStorage.removeItem("erp_token");
    sessionStorage.removeItem("erp_user");
    localStorage.removeItem("erp_token");
    localStorage.removeItem("erp_user");
  },

  get token() { return this._token; },
  get user()  { return this._user; },
  get isLoggedIn() { return !!this._token; },
};

// ─────────────────────────────────────────────────────────────
//  3. HTTP CLIENT  (GET / POST + retry + timeout)
// ─────────────────────────────────────────────────────────────

ERP.http = {
  async get(action, params = {}) {
    const url = new URL(ERP.CONFIG.GAS_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("token",  ERP.session.token || "");
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
    return this._fetch(url.toString(), { method: "GET" });
  },

  async post(action, body = {}) {
    return this._fetch(ERP.CONFIG.GAS_URL, {
      method : "POST",
      headers: { "Content-Type": "text/plain" },  // GAS requires text/plain for CORS
      body   : JSON.stringify({ action, token: ERP.session.token, ...body }),
    });
  },

  async _fetch(url, options, attempt = 0) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ERP.CONFIG.TIMEOUT_MS);
    try {
      const res  = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(tid);
      const data = await res.json();
      if (!data.success && data.error) {
        if (data.error.startsWith("UNAUTHORIZED")) {
          ERP.session.clear();
          window.location.reload();
        }
        throw new Error(data.error);
      }
      return data;
    } catch (err) {
      clearTimeout(tid);
      if (err.name === "AbortError") throw new Error("⏱ Request timeout — กรุณาตรวจสอบการเชื่อมต่อ");
      if (attempt < ERP.CONFIG.RETRY_TIMES) {
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        return this._fetch(url, options, attempt + 1);
      }
      throw err;
    }
  },
};

// ─────────────────────────────────────────────────────────────
//  4. API METHODS  (ทุก action ที่ backend รองรับ)
// ─────────────────────────────────────────────────────────────

ERP.api = {

  /* ── Auth ── */
  login    : (u, p, remember) => ERP.http.post("login", { username: u, password: p }).then(r => { ERP.session.set(r.token, r.user, remember); return r; }),
  logout   : ()                => { ERP.session.clear(); window.location.reload(); },
  ping     : ()                => ERP.http.get("ping"),

  /* ── Dashboard ── */
  dashboard: ()  => ERP.http.get("dashboard"),
  kpi      : ()  => ERP.http.get("kpi"),

  /* ── Generic CRUD ── */
  getAll   : (sheet, p)      => ERP.http.get("getAll",  { sheet, ...p }),
  getById  : (sheet, id)     => ERP.http.get("getById", { sheet, id }),
  search   : (sheet, q, f)   => ERP.http.get("search",  { sheet, q, fields: f }),
  insert   : (sheet, data)   => ERP.http.post("insert", { sheet, data }),
  update   : (sheet, id, d)  => ERP.http.post("update", { sheet, id, data: d }),
  delete_  : (sheet, id)     => ERP.http.post("delete", { sheet, id }),
  upsert   : (sheet, data, f)=> ERP.http.post("upsert", { sheet, data, matchField: f }),

  /* ── Materials ── */
  rawMaterials   : (p)            => ERP.http.get("getAll",       { sheet:"RawMaterials", ...p }),
  materialLots   : (sku)          => ERP.http.get("getAll",       { sheet:"MaterialLots", filter:JSON.stringify({sku}) }),
  lowStock       : ()             => ERP.http.get("lowStock"),
  expiringSoon   : (days = 30)    => ERP.http.get("expiringSoon", { days }),
  matHistory     : (sku)          => ERP.http.get("matHistory",   { sku }),
  stockSummary   : ()             => ERP.http.get("stockSummary"),
  adjustStock    : (b)            => ERP.http.post("adjustStock",     b),
  receiveMaterial: (data)         => ERP.http.post("receiveMaterial", { data }),
  addMaterial    : (data)         => ERP.http.post("insert", { sheet:"RawMaterials", data }),
  updateMaterial : (id, data)     => ERP.http.post("update", { sheet:"RawMaterials", id, data }),
  addLot         : (data)         => ERP.http.post("insert", { sheet:"MaterialLots", data }),

  /* ── Equipment ── */
  equipment      : (p)            => ERP.http.get("getAll", { sheet:"Equipment", ...p }),
  addEquipment   : (data)         => ERP.http.post("insert", { sheet:"Equipment", data }),

  /* ── Finished Goods ── */
  finishedGoods  : (p)            => ERP.http.get("getAll", { sheet:"FinishedGoods", ...p }),
  fgReport       : ()             => ERP.http.get("reportFG"),

  /* ── Formulas ── */
  formulas       : (p)            => ERP.http.get("getAll", { sheet:"Formulas", ...p }),
  saveFormula    : (data)         => ERP.http.post("saveFormula", { data }),

  /* ── Manufacturing Orders ── */
  openMOs        : ()             => ERP.http.get("openMOs"),
  moDetail       : (moId)         => ERP.http.get("moDetail",    { moId }),
  createMO       : (data)         => ERP.http.post("createMO",   { data }),
  moveMO         : (moId,s,note)  => ERP.http.post("moveMO",     { moId, newStatus:s, note }),
  approveMO      : (moId,ok,note,sig) => ERP.http.post("approveMO", { moId, approved:ok, note, sig }),

  /* ── Material Withdraw ── */
  withdraws      : (p)            => ERP.http.get("getAll", { sheet:"MaterialWithdraw", ...p }),
  createWithdraw : (data)         => ERP.http.post("createWithdraw",  { data }),
  approveWithdraw: (wdId, ok)     => ERP.http.post("approveWithdraw", { wdId, approved:ok }),

  /* ── Fermentation ── */
  fermentStatus  : ()             => ERP.http.get("fermentStatus"),
  startFerment   : (moId,days,tp) => ERP.http.post("startFerment",{ moId, days, type:tp }),
  doneFerment    : (moId)         => ERP.http.post("doneFerment",  { moId }),

  /* ── Production Log ── */
  prodLog        : (moId)         => ERP.http.get("getAll", { sheet:"ProductionLogs", filter:JSON.stringify({moId}) }),
  saveLog        : (moId, data)   => ERP.http.post("saveLog",       { moId, data }),
  tickChecklist  : (moId,step,ok) => ERP.http.post("tickChecklist", { moId, step, done:ok }),

  /* ── QC ── */
  qcByBatch      : (batch)        => ERP.http.get("qcByBatch", { batch }),
  saveQC         : (data)         => ERP.http.post("saveQC", { data }),

  /* ── Waste ── */
  recordWaste    : (data)         => ERP.http.post("recordWaste",    { data }),
  approveWaste   : (dmId, ok)     => ERP.http.post("approveWaste",   { dmId, approved:ok }),

  /* ── Close Order ── */
  closeOrder     : (moId, data)   => ERP.http.post("closeOrder", { moId, data }),

  /* ── Approvals ── */
  approvals      : (p)            => ERP.http.get("getAll", { sheet:"Approvals", ...p }),
  pendingApprovals: ()            => ERP.http.get("getAll", { sheet:"Approvals", filter:JSON.stringify({status:"waiting"}) }),

  /* ── Reports ── */
  reportProduction : (y, m)       => ERP.http.get("reportProduction", { year:y, month:m }),
  reportMaterial   : (m, y)       => ERP.http.get("reportMaterial",   { month:m, year:y }),
  reportWaste      : (m, y)       => ERP.http.get("reportWaste",      { month:m, year:y }),
  reportCost       : (moId)       => ERP.http.get("reportCost",       { moId }),

  /* ── Documents ── */
  nextDocNo      : (prefix)       => ERP.http.get("nextDocNo", { prefix }),

  /* ── Audit Log ── */
  auditLog       : (p)            => ERP.http.get("auditLog", p),

  /* ── Notifications ── */
  notifications  : (unreadOnly)   => ERP.http.get("notifications", { unreadOnly }),
  markRead       : (notifId)      => ERP.http.post("markRead",    { notifId }),
  markAllRead    : ()             => ERP.http.post("markAllRead", {}),

  /* ── Users ── */
  users          : ()             => ERP.http.get("getAll", { sheet:"Users" }),
  addUser        : (data)         => ERP.http.post("insert", { sheet:"Users", data }),
  updateUser     : (id, data)     => ERP.http.post("update", { sheet:"Users", id, data }),

  /* ── File Upload ── */
  uploadFile(file, folder) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onerror = rej;
      reader.onload  = async e => {
        try {
          const b64 = e.target.result.split(",")[1];
          res(await ERP.http.post("uploadFile", { base64:b64, filename:file.name, folder, mime:file.type }));
        } catch(err) { rej(err); }
      };
      reader.readAsDataURL(file);
    });
  },
};

// ─────────────────────────────────────────────────────────────
//  5. REAL-TIME POLLING
// ─────────────────────────────────────────────────────────────

ERP.realtime = {
  _timers: {},
  _cbs: {},
  _lastData: {},

  subscribe(event, cb, interval) {
    if (!this._cbs[event]) this._cbs[event] = new Set();
    this._cbs[event].add(cb);
    if (!this._timers[event]) this._startPoll(event, interval);
    return () => { this._cbs[event].delete(cb); if (!this._cbs[event].size) this._stopPoll(event); };
  },

  unsubscribe(event, cb) {
    this._cbs[event]?.delete(cb);
  },

  _startPoll(event, interval) {
    this._poll(event);
    this._timers[event] = setInterval(() => this._poll(event), interval || ERP.CONFIG.POLL_INTERVAL);
  },

  _stopPoll(event) {
    clearInterval(this._timers[event]);
    delete this._timers[event];
  },

  async _poll(event) {
    if (!ERP.session.isLoggedIn) return;
    try {
      let data;
      switch (event) {
        case "notifications": data = await ERP.api.notifications(true);     break;
        case "kpi"          : data = await ERP.api.kpi();                   break;
        case "lowStock"     : data = await ERP.api.lowStock();              break;
        case "ferment"      : data = await ERP.api.fermentStatus();         break;
        case "openMOs"      : data = await ERP.api.openMOs();               break;
        default: return;
      }
      this._lastData[event] = data;
      this._cbs[event]?.forEach(cb => cb(data));
    } catch (e) {
      console.warn(`[realtime:${event}] poll failed:`, e.message);
    }
  },

  getLast(event) { return this._lastData[event]; },
  stopAll() { Object.keys(this._timers).forEach(e => this._stopPoll(e)); },
};

// ─────────────────────────────────────────────────────────────
//  6. TOAST NOTIFICATION UI
// ─────────────────────────────────────────────────────────────

ERP.toast = {
  _container: null,

  _init() {
    if (this._container) return;
    this._container = document.createElement("div");
    Object.assign(this._container.style, {
      position:"fixed", bottom:"20px", right:"20px", zIndex:"99999",
      display:"flex", flexDirection:"column", gap:"8px", pointerEvents:"none",
    });
    document.body.appendChild(this._container);
  },

  show(msg, type = "info", duration = 4000) {
    this._init();
    const colors = { success:"#16a34a", danger:"#dc2626", warning:"#d97706", info:"#1558c0" };
    const icons  = { success:"✅", danger:"❌", warning:"⚠️", info:"ℹ️" };

    const el = document.createElement("div");
    el.innerHTML = `<span>${icons[type] || "ℹ️"}</span><span style="flex:1">${msg}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:inherit;font-size:16px;opacity:.7;padding:0 0 0 8px">×</button>`;
    Object.assign(el.style, {
      display:"flex", alignItems:"center", gap:"8px",
      background: colors[type] || "#1558c0", color:"#fff",
      padding:"10px 14px", borderRadius:"8px",
      fontFamily:"IBM Plex Sans Thai,sans-serif", fontSize:"13px",
      boxShadow:"0 4px 12px rgba(0,0,0,.2)", pointerEvents:"all",
      animation:"slideInRight .25s ease", maxWidth:"360px",
      transition:"opacity .3s, transform .3s",
    });

    if (!document.querySelector("#_erp_toast_style")) {
      const s = document.createElement("style");
      s.id = "_erp_toast_style";
      s.textContent = `@keyframes slideInRight{from{opacity:0;transform:translateX(40px)}to{opacity:1;transform:translateX(0)}}`;
      document.head.appendChild(s);
    }

    this._container.appendChild(el);
    if (duration > 0) setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateX(30px)"; setTimeout(() => el.remove(), 300); }, duration);
    return el;
  },

  success: (m, d) => ERP.toast.show(m, "success", d),
  danger : (m, d) => ERP.toast.show(m, "danger",  d),
  warning: (m, d) => ERP.toast.show(m, "warning", d),
  info   : (m, d) => ERP.toast.show(m, "info",    d),
};

// ─────────────────────────────────────────────────────────────
//  7. LOADING OVERLAY
// ─────────────────────────────────────────────────────────────

ERP.loading = {
  _el: null,
  _count: 0,

  show(msg) {
    this._count++;
    if (!this._el) {
      this._el = document.createElement("div");
      Object.assign(this._el.style, {
        position:"fixed", inset:"0", background:"rgba(15,23,42,.35)",
        display:"flex", alignItems:"center", justifyContent:"center",
        zIndex:"99998", backdropFilter:"blur(2px)",
      });
      this._el.innerHTML = `
        <div style="background:#fff;border-radius:12px;padding:20px 28px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 32px rgba(0,0,0,.15);font-family:IBM Plex Sans Thai,sans-serif">
          <div style="width:22px;height:22px;border:3px solid #e2e8f0;border-top-color:#1558c0;border-radius:50%;animation:spin .7s linear infinite"></div>
          <span id="_erp_loading_msg" style="font-size:13px;color:#334155">${msg || "กำลังโหลด..."}</span>
        </div>`;
      const s = document.createElement("style");
      s.textContent = "@keyframes spin{to{transform:rotate(360deg)}}";
      this._el.appendChild(s);
      document.body.appendChild(this._el);
    } else {
      const m = document.getElementById("_erp_loading_msg");
      if (m && msg) m.textContent = msg;
    }
  },

  hide() {
    this._count = Math.max(0, this._count - 1);
    if (this._count === 0 && this._el) { this._el.remove(); this._el = null; }
  },
};

// ─────────────────────────────────────────────────────────────
//  8. ASYNC WRAPPER — auto loading + toast errors
// ─────────────────────────────────────────────────────────────

ERP.run = async function(fn, opts = {}) {
  const { loading = true, loadingMsg, successMsg, errorMsg, silent = false } = opts;
  if (loading) ERP.loading.show(loadingMsg);
  try {
    const result = await fn();
    if (loading) ERP.loading.hide();
    if (successMsg) ERP.toast.success(successMsg);
    return result;
  } catch (err) {
    if (loading) ERP.loading.hide();
    const msg = errorMsg || err.message || "เกิดข้อผิดพลาด";
    if (!silent) ERP.toast.danger(msg);
    console.error("[ERP.run]", err);
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────
//  9. OFFLINE QUEUE — บันทึก action ขณะออฟไลน์ แล้ว sync ทีหลัง
// ─────────────────────────────────────────────────────────────

ERP.offlineQueue = {
  _key: "erp_offline_queue",

  enqueue(action, body) {
    const q = this._load();
    q.push({ action, body, ts: Date.now() });
    localStorage.setItem(this._key, JSON.stringify(q));
    ERP.toast.warning(`ออฟไลน์ — บันทึก "${action}" ไว้ชั่วคราว`);
  },

  async flush() {
    const q = this._load();
    if (!q.length) return;
    ERP.toast.info(`กำลัง sync ${q.length} รายการ...`);
    const errors = [];
    for (const item of q) {
      try {
        await ERP.http.post(item.action, item.body);
      } catch (e) { errors.push(item); }
    }
    localStorage.setItem(this._key, JSON.stringify(errors));
    const ok = q.length - errors.length;
    if (ok) ERP.toast.success(`Sync สำเร็จ ${ok} รายการ`);
    if (errors.length) ERP.toast.danger(`Sync ล้มเหลว ${errors.length} รายการ`);
  },

  _load() {
    try { return JSON.parse(localStorage.getItem(this._key) || "[]"); } catch { return []; }
  },

  count() { return this._load().length; },
};

// ─────────────────────────────────────────────────────────────
//  10. UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────

ERP.utils = {

  // Export to CSV (UTF-8 BOM for Thai Excel)
  exportCSV(data, filename = "export") {
    if (!data?.length) return ERP.toast.warning("ไม่มีข้อมูลสำหรับ Export");
    const headers = Object.keys(data[0]).filter(k => !k.startsWith("_"));
    const rows = data.map(r => headers.map(h => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
    const csv = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    this._download(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename + ".csv");
  },

  // Export JSON
  exportJSON(data, filename = "export") {
    this._download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), filename + ".json");
  },

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // Print A4 element
  printA4(elementId, title = "") {
    const el = document.getElementById(elementId);
    if (!el) return;
    const w = window.open("", "_blank", "width=900,height=700");
    w.document.write(`<!DOCTYPE html><html lang="th"><head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
      <style>
        @page { size: A4; margin: 15mm; }
        * { box-sizing: border-box; }
        body { font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 11pt; color: #000; }
        .no-print { display: none !important; }
        table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
        th, td { border: 1px solid #999; padding: 5px 8px; font-size: 10pt; }
        th { background: #f0f4ff; font-weight: 700; text-align: left; }
        .doc-header { text-align: center; border-bottom: 2px solid #1558c0; padding-bottom: 8pt; margin-bottom: 12pt; }
        .doc-title  { font-size: 16pt; font-weight: 700; color: #1558c0; }
        .doc-meta   { font-size: 9pt; color: #666; margin-top: 4pt; }
        .sig-row    { display: flex; justify-content: space-around; margin-top: 40pt; }
        .sig-box    { text-align: center; width: 120pt; border-top: 1px solid #000; padding-top: 4pt; font-size: 9pt; }
        .qrcode     { width: 60pt; height: 60pt; }
        @media screen { body { padding: 20px; } }
      </style>
    </head><body>${el.outerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 600);
  },

  // QR Code URL (Google Charts)
  qrUrl(data, size = 150) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png`;
  },

  // Barcode URL (barcode.wiki)
  barcodeUrl(data) {
    return `https://barcodeapi.org/api/code128/${encodeURIComponent(data)}`;
  },

  // Format Thai date
  thDate(d) {
    if (!d) return "";
    const dt = typeof d === "string" ? new Date(d) : d;
    if (isNaN(dt)) return String(d);
    return dt.toLocaleDateString("th-TH", { year:"numeric", month:"short", day:"numeric" });
  },

  // Number with comma
  num(n, dec = 0) {
    return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  },

  // Relative time
  relTime(ts) {
    const diff = Date.now() - new Date(ts).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return "เมื่อกี้";
    if (m < 60) return `${m} นาทีที่แล้ว`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ชม. ที่แล้ว`;
    return `${Math.floor(h / 24)} วันที่แล้ว`;
  },

  // Status badge config
  statusBadge(status) {
    const cfg = {
      draft           : { label:"Draft",          cls:"badge-gray"   },
      waiting_approval: { label:"รออนุมัติ",       cls:"badge-amber"  },
      approved        : { label:"อนุมัติแล้ว",     cls:"badge-green"  },
      production      : { label:"กำลังผลิต",       cls:"badge-blue"   },
      qc              : { label:"QC",              cls:"badge-teal"   },
      completed       : { label:"เสร็จสิ้น",       cls:"badge-green"  },
      closed          : { label:"ปิดงาน",          cls:"badge-gray"   },
      rejected        : { label:"ปฏิเสธ",          cls:"badge-red"    },
      danger          : { label:"วิกฤต",           cls:"badge-red"    },
      warning         : { label:"ต่ำ",             cls:"badge-amber"  },
      ok              : { label:"ปกติ",            cls:"badge-green"  },
      pass            : { label:"PASS",            cls:"badge-green"  },
      fail            : { label:"FAIL",            cls:"badge-red"    },
      available       : { label:"พร้อมจำหน่าย",    cls:"badge-green"  },
      active          : { label:"Active",          cls:"badge-green"  },
      inactive        : { label:"Inactive",        cls:"badge-gray"   },
      fermenting      : { label:"กำลังหมัก",       cls:"badge-blue"   },
    };
    return cfg[status] || { label: status, cls: "badge-gray" };
  },
};

// ─────────────────────────────────────────────────────────────
//  11. CONNECTIVITY MONITOR
// ─────────────────────────────────────────────────────────────

ERP.connectivity = {
  _online : navigator.onLine,
  _cbs    : [],
  _pingTimer: null,

  init() {
    window.addEventListener("online",  () => this._setOnline(true));
    window.addEventListener("offline", () => this._setOnline(false));
    // Verify GAS connectivity every 60s
    this._pingTimer = setInterval(() => this._pingGAS(), 60_000);
    this._pingGAS();
  },

  async _pingGAS() {
    try {
      const r = await ERP.http.get("ping");
      if (!this._online) this._setOnline(true);
      this._updateIndicator(true, r.ts);
    } catch {
      this._updateIndicator(false);
    }
  },

  _setOnline(v) {
    const changed = v !== this._online;
    this._online = v;
    if (changed) {
      if (v) { ERP.toast.success("เชื่อมต่อแล้ว"); ERP.offlineQueue.flush(); }
      else    { ERP.toast.danger("ออฟไลน์ — ข้อมูลบางส่วนอาจไม่อัปเดต", 0); }
      this._cbs.forEach(cb => cb(v));
    }
    this._updateIndicator(v);
  },

  _updateIndicator(online, ts) {
    const dot = document.getElementById("connDot");
    const lbl = document.getElementById("connLabel");
    if (dot) dot.style.background = online ? "#16a34a" : "#dc2626";
    if (lbl) lbl.textContent = online ? "Google Sheets" : "ออฟไลน์";
  },

  onStatusChange(cb) { this._cbs.push(cb); },
  isOnline() { return this._online; },
};

// ─────────────────────────────────────────────────────────────
//  12. PAGE DATA LOADER — ใช้ใน nav() ของ index.html
// ─────────────────────────────────────────────────────────────

/**
 * ตัวอย่างการใช้งานใน page_dashboard:
 *
 *   ERP.run(async () => {
 *     const { data } = await ERP.api.dashboard();
 *     renderKPI(data.kpi);
 *     renderLowStock(data.lowStock);
 *     renderFerment(data.ferment);
 *   }, { loadingMsg: "โหลด Dashboard..." });
 *
 * ตัวอย่าง Login:
 *
 *   document.getElementById('loginBtn').onclick = async () => {
 *     await ERP.run(
 *       () => ERP.api.login(username, password, remember),
 *       { loadingMsg:"กำลังเข้าสู่ระบบ...", successMsg:"เข้าสู่ระบบสำเร็จ" }
 *     );
 *     nav('dashboard');
 *   };
 *
 * ตัวอย่าง Real-time:
 *
 *   ERP.realtime.subscribe("notifications", ({ data, unread }) => {
 *     document.getElementById("notifBadge").textContent = unread;
 *   });
 *
 *   ERP.realtime.subscribe("kpi", ({ data }) => {
 *     document.getElementById("kpi_mo_today").textContent = data.moToday;
 *   });
 */

// ─────────────────────────────────────────────────────────────
//  13. AUTO-INIT
// ─────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  ERP.connectivity.init();

  // Sync offline queue เมื่อกลับมา online
  window.addEventListener("online", () => ERP.offlineQueue.flush());

  // Expose to global for debugging
  window.ERP = ERP;

  console.log(`[ERP Connect v${ERP.CONFIG.VERSION}] Ready — GAS: ${ERP.CONFIG.GAS_URL}`);
  console.log("[ERP Connect] Session:", ERP.session.isLoggedIn ? `Logged in as ${ERP.session.user?.nameTH}` : "Not logged in");
});
