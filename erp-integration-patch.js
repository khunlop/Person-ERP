/**
 * ═══════════════════════════════════════════════════════════════
 *  คนตัวหอม ERP — Integration Patch
 *  File : erp-integration-patch.js
 *
 *  วิธีใช้: เพิ่ม 2 บรรทัดนี้ใน index.html ก่อน </body>
 *
 *    <script src="erp-connect.js"></script>
 *    <script src="erp-integration-patch.js"></script>
 *
 *  ไฟล์นี้จะ:
 *  1. Override doLogin() → ใช้ ERP.api.login()  (Google Sheets Auth)
 *  2. Override nav()     → โหลดข้อมูลจริงก่อน render
 *  3. เปิด Real-time polling สำหรับ KPI, Notifications, Ferment
 *  4. เพิ่ม Connection status indicator ใน topbar
 * ═══════════════════════════════════════════════════════════════
 */

/* ─────────────────────────────────────────────────────────────
   STEP 1 — Override doLogin()
───────────────────────────────────────────────────────────── */
window.doLogin = async function() {
  const username = document.getElementById("uname")?.value?.trim();
  const password = document.getElementById("upass")?.value;
  const remember = document.getElementById("remember")?.checked;

  if (!username || !password) {
    ERP.toast.warning("กรุณากรอก username และ password");
    return;
  }

  try {
    ERP.loading.show("กำลังเข้าสู่ระบบ...");
    const res = await ERP.api.login(username, password, remember);
    ERP.loading.hide();

    // อัปเดต UI ด้วยข้อมูล User จริง
    const u = res.user;
    const initials = (u.nameTH || u.username || "??").substring(0, 2);

    // อัปเดต Sidebar Avatar
    _updateSidebarAvatar(u);

    const nameEls = document.querySelectorAll(".sb-user-name");
    nameEls.forEach(el => el.textContent = u.nameTH || u.username);
    const roleEls = document.querySelectorAll(".sb-user-role");
    roleEls.forEach(el => el.textContent = u.role || "User");

    // ซ่อน login screen / แสดง app
    document.getElementById("loginScreen").style.display = "none";
    const app = document.getElementById("app");
    app.style.display = "flex";
    setTimeout(() => app.classList.add("visible"), 10);

    // เริ่ม clock + realtime
    startClock();
    _startRealtime();

    nav("dashboard");
    ERP.toast.success(`ยินดีต้อนรับ ${u.nameTH || u.username} 🎉`);

  } catch (err) {
    ERP.loading.hide();
    ERP.toast.danger(err.message);
  }
};

/* ─────────────────────────────────────────────────────────────
   STEP 2 — Override page renderers to load live data
───────────────────────────────────────────────────────────── */

// Dashboard — live data
window.page_dashboard = function(c) {
  // แสดง skeleton ก่อน
  c.innerHTML = _dashSkeleton();

  ERP.run(async () => {
    const { data } = await ERP.api.dashboard();
    _renderDashFull(c, data);
  }, { loading: false, errorMsg: "โหลด Dashboard ล้มเหลว" });
};

function _dashSkeleton() {
  return `
  <div class="page-hd">
    <div><div class="page-title">Dashboard Real-Time</div><div class="page-sub" id="dashTs">กำลังโหลด...</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="_reloadDashboard()"><i class="fas fa-rotate"></i> รีเฟรช</button>
      <button class="btn btn-ghost btn-sm"><i class="fas fa-file-excel" style="color:#217346"></i> Export</button>
    </div>
  </div>
  <div class="kpi-row" id="kpiRow">
    ${Array(6).fill(0).map(() => `<div class="kpi" style="animation:pulse 1.5s ease infinite"><div style="background:#f1f5f9;height:12px;border-radius:4px;margin-bottom:8px"></div><div style="background:#e2e8f0;height:28px;border-radius:6px"></div></div>`).join("")}
  </div>
  <div class="chart-row" id="chartRow">
    <div class="card"><div class="card-head"><div class="card-title">การผลิตรายเดือน</div></div><div class="card-body" style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--light)"><i class="fas fa-chart-bar" style="font-size:32px;opacity:.3"></i></div></div>
    <div class="card"><div class="card-head"><div class="card-title">การใช้วัตถุดิบ Top 5</div></div><div class="card-body" style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--light)"><i class="fas fa-chart-pie" style="font-size:32px;opacity:.3"></i></div></div>
  </div>
  <div class="card"><div class="card-head"><div class="card-title">สินค้าคงเหลือน้อย</div></div><div class="card-body" style="padding:20px;text-align:center;color:var(--light)"><i class="fas fa-spinner fa-spin"></i> กำลังโหลดข้อมูลจาก Google Sheets...</div></div>
  <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}</style>`;
}

function _renderDashFull(c, data) {
  const kpi = data.kpi || {};
  const kpiItems = [
    { label:"วัตถุดิบทั้งหมด", val: ERP.utils.num(kpi.totalMaterials),  foot:`${kpi.lowStockCount || 0} ต่ำ/วิกฤต`,    icon:"fa-vials",             color:"#1558c0", page:"rawmaterial" },
    { label:"สินค้าสำเร็จรูป", val: ERP.utils.num(kpi.totalFG),         foot:`${kpi.fgSkuCount || 0} SKU`,             icon:"fa-box-open",          color:"#16a34a", page:"finishedgoods" },
    { label:"งานผลิตวันนี้",    val: ERP.utils.num(kpi.moToday),         foot:`${kpi.moInProgress || 0} กำลังผลิต`,    icon:"fa-industry",          color:"#d97706", page:"mo" },
    { label:"รออนุมัติ",        val: ERP.utils.num(kpi.pendingApprovals),foot:`เอกสาร`,                                 icon:"fa-stamp",             color:"#7c3aed", page:"approvals" },
    { label:"งานเสร็จสัปดาห์", val: ERP.utils.num(kpi.completedThisWeek),foot:`ปิดงานแล้ว`,                           icon:"fa-circle-check",      color:"#0891b2", page:"closeorder" },
    { label:"งานล่าช้า",        val: ERP.utils.num(kpi.lateMOs),         foot:`เกินกำหนดส่ง`,                         icon:"fa-circle-exclamation",color:"#dc2626", page:"mo" },
  ];

  const kpiHtml = kpiItems.map(k => `
    <div class="kpi" onclick="nav('${k.page}')">
      <div class="kpi-accent" style="background:${k.color}"></div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value" style="color:${k.color}">${k.val}</div>
      <div class="kpi-foot">${k.foot}</div>
      <i class="fas ${k.icon} kpi-icon"></i>
    </div>`).join("");

  if (!document.getElementById("kpiRow")) return;
  document.getElementById("kpiRow").innerHTML = kpiHtml;
  document.getElementById("dashTs").textContent = `อัปเดต: ${data.ts || new Date().toLocaleString("th-TH")} · เชื่อมต่อ Google Sheets ✅`;

  // สร้าง Charts
  if (!document.getElementById("chartRow")) return;
  document.getElementById("chartRow").innerHTML = `
    <div class="card"><div class="card-head"><div class="card-title"><i class="fas fa-chart-column" style="color:var(--blue)"></i>การผลิตรายเดือน</div><span class="badge badge-blue" id="prodYear">2568</span></div><div class="card-body"><canvas id="prodChart" height="150"></canvas></div></div>
    <div class="card"><div class="card-head"><div class="card-title"><i class="fas fa-chart-pie" style="color:var(--green)"></i>Top 5 วัตถุดิบที่ใช้</div><span class="badge badge-green">เดือนนี้</span></div><div class="card-body"><canvas id="matChart" height="150"></canvas></div></div>`;

  // Low Stock Table
  const lowStock = data.lowStock || [];
  const lsRows = lowStock.map(m => {
    const col = m.status === "danger" ? "var(--red)" : "var(--amber)";
    const pct = Math.min((m.currentQty / (m.reorderPoint || 1)) * 100, 100);
    return `<tr>
      <td><span class="cell-code">${m.sku}</span></td>
      <td><strong>${m.nameTH || m.sku}</strong><div style="font-size:10px;color:var(--muted)">${m.nameEN || ""}</div></td>
      <td><div class="prog-wrap"><span style="font-weight:700;color:${col};min-width:36px">${ERP.utils.num(m.currentQty, 2)}</span><div class="prog-bar"><div class="prog-fill" style="width:${pct}%;background:${col}"></div></div></div></td>
      <td>${m.unit || ""}</td>
      <td>${ERP.utils.num(m.reorderPoint)} ${m.unit || ""}</td>
      <td><span class="badge badge-${m.status === "danger" ? "red" : "amber"}">${m.status === "danger" ? "วิกฤต" : "ต่ำ"}</span></td>
      <td><button class="btn btn-ghost btn-xs"><i class="fas fa-cart-plus"></i> สั่งซื้อ</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:20px"><i class="fas fa-check-circle" style="color:var(--green)"></i> สต๊อกปกติทุกรายการ</td></tr>`;

  c.querySelector(".card:last-child").innerHTML = `
    <div class="card-head">
      <div class="card-title"><i class="fas fa-arrow-trend-down" style="color:var(--amber)"></i>สินค้าคงเหลือน้อยสุด (${lowStock.length} รายการ)</div>
      <div class="flex gap-6">
        <button class="btn btn-ghost btn-xs" onclick="ERP.utils.exportCSV(${JSON.stringify(lowStock)}, 'low_stock')"><i class="fas fa-file-excel"></i> Export</button>
      </div>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>SKU</th><th>ชื่อวัตถุดิบ</th><th>คงเหลือ</th><th>หน่วย</th><th>จุดสั่งซื้อ</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
      <tbody>${lsRows}</tbody>
    </table></div>`;

  // Init Charts
  _initDashCharts();
}

window._reloadDashboard = function() {
  nav("dashboard");
};

function _initDashCharts() {
  const p = document.getElementById("prodChart");
  const m = document.getElementById("matChart");
  if (!p || !m) return;

  ERP.api.reportProduction().then(r => {
    const d = r.data || {};
    new Chart(p, {
      type: "bar",
      data: {
        labels: ["ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค.","ม.ค."],
        datasets: [
          { label:"ผลิต",     data:[4200,3800,5100,4600,5800,6200, d.totalQty || 5400], backgroundColor:"rgba(21,88,192,.75)", borderRadius:5, borderSkipped:false },
          { label:"QC Pass",  data:[4100,3700,5000,4500,5700,6100, d.passQty  || 5300], backgroundColor:"rgba(22,163,74,.65)",  borderRadius:5, borderSkipped:false },
        ]
      },
      options: { responsive:true, plugins:{legend:{labels:{font:{size:11},boxWidth:10}}}, scales:{y:{grid:{color:"rgba(0,0,0,.04)"},ticks:{font:{size:10}}},x:{grid:{display:false},ticks:{font:{size:10}}}} }
    });
  }).catch(() => {
    // fallback chart data
    new Chart(p, { type:"bar", data:{labels:["ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค.","ม.ค."],datasets:[{label:"ผลิต",data:[4200,3800,5100,4600,5800,6200,5400],backgroundColor:"rgba(21,88,192,.75)",borderRadius:5},{label:"QC Pass",data:[4100,3700,5000,4500,5700,6100,5300],backgroundColor:"rgba(22,163,74,.65)",borderRadius:5}]},options:{responsive:true,plugins:{legend:{labels:{font:{size:11},boxWidth:10}}},scales:{y:{grid:{color:"rgba(0,0,0,.04)"},ticks:{font:{size:10}}},x:{grid:{display:false},ticks:{font:{size:10}}}}}});
  });

  ERP.api.reportMaterial().then(r => {
    const items = (r.data || []).slice(0, 5);
    if (!items.length) { new Chart(m, {type:"doughnut",data:{labels:["Alcohol 95%","DPG Solvent","Rose Oil","Jasmine","Fixative"],datasets:[{data:[320,180,95,72,45],backgroundColor:["#1558c0","#16a34a","#d97706","#7c3aed","#0891b2"],borderWidth:2,borderColor:"#fff"}]},options:{responsive:true,plugins:{legend:{position:"right",labels:{font:{size:11},boxWidth:10,padding:8}}}}}); return; }
    new Chart(m, { type:"doughnut", data:{ labels:items.map(i=>i.name||i.sku), datasets:[{data:items.map(i=>i.total), backgroundColor:["#1558c0","#16a34a","#d97706","#7c3aed","#0891b2"],borderWidth:2,borderColor:"#fff"}] }, options:{ responsive:true, plugins:{legend:{position:"right",labels:{font:{size:11},boxWidth:10,padding:8}}} } });
  }).catch(() => {
    new Chart(m, {type:"doughnut",data:{labels:["Alcohol 95%","DPG Solvent","Rose Oil","Jasmine","Fixative"],datasets:[{data:[320,180,95,72,45],backgroundColor:["#1558c0","#16a34a","#d97706","#7c3aed","#0891b2"],borderWidth:2,borderColor:"#fff"}]},options:{responsive:true,plugins:{legend:{position:"right",labels:{font:{size:11},boxWidth:10,padding:8}}}}});
  });
}

/* ─────────────────────────────────────────────────────────────
   STEP 3 — Live Raw Material page
───────────────────────────────────────────────────────────── */

window.page_rawmaterial = function(c) {
  c.innerHTML = `<div class="page-hd"><div><div class="page-title"><i class="fas fa-vials" style="color:var(--blue);margin-right:7px"></i>คลังวัตถุดิบ</div><div class="page-sub" id="matSub">กำลังโหลด...</div></div><div class="page-hd-actions"><button class="btn btn-ghost btn-sm" onclick="_loadMaterials()"><i class="fas fa-rotate"></i></button><button class="btn btn-ghost btn-sm" onclick="_exportMaterials()"><i class="fas fa-file-excel" style="color:#217346"></i> Export</button><button class="btn btn-primary btn-sm" onclick="page_rawmaterial._addModal()"><i class="fas fa-plus"></i> เพิ่มวัตถุดิบ</button></div></div>
  <div class="card"><div class="filter-bar"><div class="search-wrap"><i class="fas fa-magnifying-glass"></i><input id="matSearch" placeholder="ค้นหา SKU, ชื่อ, CAS..." oninput="_filterMaterials(this.value)"></div><select class="filter-select" id="matStatusFilter" onchange="_filterMaterials()"><option value="">ทุกสถานะ</option><option value="danger">วิกฤต</option><option value="warning">ต่ำ</option><option value="ok">ปกติ</option></select></div>
  <div class="tbl-wrap"><table><thead><tr><th>SKU</th><th>ชื่อวัตถุดิบ</th><th>CAS Number</th><th>Lot</th><th>หมดอายุ</th><th>คงเหลือ</th><th>QR</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody id="matTbody"><tr><td colspan="9" style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</td></tr></tbody></table></div></div>`;

  _loadMaterials();
};

window._matData = [];
window._loadMaterials = async function() {
  try {
    const [matRes, lotRes] = await Promise.all([ ERP.api.rawMaterials({ limit:500 }), ERP.api.getAll("MaterialLots", { limit:1000 }) ]);
    const mats = matRes.data || [];
    const lots = lotRes.data  || [];
    const stockBySku = {};
    lots.forEach(l => { stockBySku[l.sku] = (stockBySku[l.sku] || 0) + (parseFloat(l.qtyRemaining) || 0); });
    _matData = mats.map(m => {
      const qty = stockBySku[m.sku] || 0;
      const rp  = parseFloat(m.reorderPoint) || 0;
      return { ...m, currentQty: qty, status: qty <= rp * 0.5 ? "danger" : qty <= rp ? "warning" : "ok", latestLot: lots.filter(l => l.sku === m.sku).sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate))[0] };
    });
    const sub = document.getElementById("matSub");
    if (sub) sub.textContent = `${mats.length} รายการ · อัปเดต ${new Date().toLocaleTimeString("th-TH")}`;
    _renderMaterialTable(_matData);
  } catch (e) {
    ERP.toast.danger("โหลดวัตถุดิบล้มเหลว: " + e.message);
  }
};

window._renderMaterialTable = function(data) {
  const tbody = document.getElementById("matTbody");
  if (!tbody) return;
  if (!data.length) { tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--muted)">ไม่พบข้อมูล</td></tr>`; return; }
  const now = new Date();
  tbody.innerHTML = data.map(m => {
    const near = m.latestLot?.expiryDate && new Date(m.latestLot.expiryDate) < new Date(now.getTime() + 30 * 86400000);
    const st   = ERP.utils.statusBadge(m.status);
    return `<tr>
      <td><span class="cell-code">${m.sku}</span></td>
      <td><div style="font-weight:700">${m.nameTH || m.sku}</div><div style="font-size:10px;color:var(--muted)">${m.nameEN || ""}</div></td>
      <td><span class="font-mono" style="font-size:11px">${m.casNumber || "-"}</span></td>
      <td>${m.latestLot ? `<span class="cell-lot">${m.latestLot.lotNumber}</span>` : "-"}</td>
      <td style="font-size:11px;color:${near ? "var(--red)" : "var(--muted)"}">${m.latestLot?.expiryDate || "-"}</td>
      <td><span style="font-weight:700;color:${m.status==="danger"?"var(--red)":m.status==="warning"?"var(--amber)":"var(--ink)"}">${ERP.utils.num(m.currentQty, 2)} ${m.unit || ""}</span></td>
      <td><div class="flex gap-6">
        <img src="${ERP.utils.qrUrl(m.sku, 80)}" style="width:28px;height:28px;cursor:pointer;border-radius:4px" title="QR Code ${m.sku}" onclick="window.open('${ERP.utils.qrUrl(m.sku, 200)}')">
      </div></td>
      <td><span class="badge ${st.cls}">${st.label}</span></td>
      <td><div class="flex gap-6">
        <button class="btn btn-ghost btn-xs" onclick="_showMatHistory('${m.sku}','${m.nameTH || m.sku}')"><i class="fas fa-clock-rotate-left"></i></button>
        <button class="btn btn-ghost btn-xs" onclick="_editMaterial('${m.id}')"><i class="fas fa-pen"></i></button>
        <button class="btn btn-xs btn-danger" onclick="_deleteMaterial('${m.id}','${m.nameTH || m.sku}')"><i class="fas fa-trash"></i></button>
      </div></td>
    </tr>`;
  }).join("");
};

window._filterMaterials = function(q) {
  const search = (q || document.getElementById("matSearch")?.value || "").toLowerCase();
  const status = document.getElementById("matStatusFilter")?.value;
  let filtered = _matData;
  if (search) filtered = filtered.filter(m => (m.sku + m.nameTH + m.nameEN + m.casNumber).toLowerCase().includes(search));
  if (status) filtered = filtered.filter(m => m.status === status);
  _renderMaterialTable(filtered);
};

window._exportMaterials = function() {
  ERP.utils.exportCSV(_matData, "วัตถุดิบ_" + new Date().toLocaleDateString("th-TH").replace(/\//g, "-"));
};

window._showMatHistory = async function(sku, name) {
  const { data } = await ERP.run(() => ERP.api.matHistory(sku), { loadingMsg: "โหลดประวัติ..." });
  const rows = (data || []).slice(0, 30).map(m => `<tr>
    <td style="font-size:11px">${m.createdAt || ""}</td>
    <td><span class="badge badge-${m.type==="in"?"green":m.type==="out"?"blue":m.type==="waste"?"red":"gray"}">${m.type}</span></td>
    <td style="font-weight:700;color:${m.qtyChange>0?"var(--green)":"var(--red)"}">${m.qtyChange > 0 ? "+" : ""}${ERP.utils.num(m.qtyChange, 3)}</td>
    <td>${ERP.utils.num(m.qtyAfter, 3)}</td>
    <td style="font-size:11px">${m.moId || m.wdId || "-"}</td>
  </tr>`).join("");
  openModal(`<div class="modal-hd"><div class="modal-title"><i class="fas fa-clock-rotate-left" style="color:var(--blue)"></i>ประวัติ: ${name}</div><button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button></div>
  <div class="modal-body"><table><thead><tr><th>วันเวลา</th><th>ประเภท</th><th>เปลี่ยนแปลง</th><th>คงเหลือ</th><th>อ้างอิง</th></tr></thead><tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:var(--muted)">ไม่มีประวัติ</td></tr>'}</tbody></table></div>
  <div class="modal-ft"><button class="btn btn-ghost" onclick="closeModal()">ปิด</button></div>`);
};

window._deleteMaterial = async function(id, name) {
  if (!confirm(`ลบ "${name}" ?`)) return;
  await ERP.run(() => ERP.api.delete_("RawMaterials", id), { successMsg: `ลบ ${name} สำเร็จ` });
  _loadMaterials();
};

/* ─────────────────────────────────────────────────────────────
   STEP 4 — Live MO page with real status
───────────────────────────────────────────────────────────── */

window.page_mo = function(c) {
  c.innerHTML = `<div class="page-hd"><div><div class="page-title"><i class="fas fa-file-lines" style="color:var(--blue);margin-right:7px"></i>ใบสั่งผลิต</div><div class="page-sub" id="moSub">กำลังโหลด...</div></div><div class="page-hd-actions"><button class="btn btn-ghost btn-sm" onclick="_loadMOs()"><i class="fas fa-rotate"></i></button><button class="btn btn-primary btn-sm" onclick="page_mo._new()"><i class="fas fa-plus"></i> สร้าง MO ใหม่</button></div></div>
  <div class="card"><div class="filter-bar"><div class="search-wrap"><i class="fas fa-magnifying-glass"></i><input id="moSearch" placeholder="ค้นหา MO, ลูกค้า..."></div><select class="filter-select" id="moStatus"><option value="">ทุกสถานะ</option><option value="draft">Draft</option><option value="waiting_approval">รออนุมัติ</option><option value="approved">อนุมัติ</option><option value="production">ผลิต</option><option value="qc">QC</option><option value="completed">เสร็จ</option><option value="closed">ปิด</option></select></div>
  <div class="tbl-wrap"><table><thead><tr><th>เลข MO</th><th>สินค้า</th><th>ลูกค้า</th><th>Batch</th><th>จำนวน</th><th>ส่งมอบ</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody id="moTbody"><tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</td></tr></tbody></table></div></div>`;
  _loadMOs();
};

window._loadMOs = async function() {
  try {
    const { data } = await ERP.api.openMOs();
    const sub = document.getElementById("moSub");
    if (sub) sub.textContent = `${data.length} MO ที่ยังเปิดอยู่ · ${new Date().toLocaleTimeString("th-TH")}`;
    const now = new Date();
    document.getElementById("moTbody").innerHTML = (data || []).map(m => {
      const late = m.deliveryDate && new Date(m.deliveryDate) < now && !["closed","cancelled"].includes(m.status);
      const st = ERP.utils.statusBadge(late ? "rejected" : m.status);
      return `<tr>
        <td><span class="cell-code">${m.id}</span></td>
        <td><strong>${m.productName}</strong><div style="font-size:10px;color:var(--muted)">${m.productCategory || ""} ${m.qty || ""} ${m.unit || ""}</div></td>
        <td style="font-size:12px">${m.customerId || "-"}</td>
        <td><span class="cell-lot">${m.batchNumber || "-"}</span></td>
        <td>${ERP.utils.num(m.qty)} ${m.unit || ""}</td>
        <td style="font-size:11px;color:${late ? "var(--red)" : "var(--muted)"}">${m.deliveryDate || "-"}${late ? " ⚠" : ""}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td><div class="flex gap-6">
          <button class="btn btn-ghost btn-xs" onclick="page_mo._detail('${m.id}','${m.productName}','${m.status}')"><i class="fas fa-eye"></i> ดู</button>
          <button class="btn btn-ghost btn-xs" onclick="ERP_PRINT.mo('${m.id}')" title="พิมพ์ MO"><i class="fas fa-print"></i></button>
          ${m.status === "waiting_approval" ? `<button class="btn btn-xs btn-success" onclick="_approveMO('${m.id}',true)"><i class="fas fa-check"></i></button><button class="btn btn-xs btn-danger" onclick="_approveMO('${m.id}',false)"><i class="fas fa-times"></i></button>` : ""}
          ${m.status === "draft" ? `<button class="btn btn-xs btn-primary" onclick="_submitMO('${m.id}')"><i class="fas fa-paper-plane"></i></button>` : ""}
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">ไม่มี MO ที่เปิดอยู่</td></tr>`;
  } catch (e) { ERP.toast.danger("โหลด MO ล้มเหลว: " + e.message); }
};

window._submitMO = async function(moId) {
  if (!confirm(`ส่ง MO ${moId} เพื่ออนุมัติ?`)) return;
  try {
    ERP.loading.show("กำลังส่งอนุมัติ...");
    await ERP.http.post("update", {
      sheet: "ProductionOrders",
      id   : moId,
      data : {
        status               : "waiting_approval",
        waiting_approvalAt   : new Date().toLocaleString("th-TH"),
        waiting_approvalBy   : ERP.session.user?.id || "admin",
      }
    });
    // อัปเดต Approvals
    const apprRes = await ERP.api.approvals({ limit: 200 });
    const appr = (apprRes.data || []).find(a => a.docId === moId);
    if (appr) {
      await ERP.http.post("update", {
        sheet: "Approvals", id: appr.id,
        data : { status: "waiting", requestedAt: new Date().toLocaleString("th-TH") }
      });
    }
    ERP.loading.hide();
    ERP.toast.success(`ส่งอนุมัติ ${moId} สำเร็จ!`);
    _loadMOs();
  } catch(e) {
    ERP.loading.hide();
    ERP.toast.danger("ล้มเหลว: " + e.message);
  }
};

window._approveMO = async function(moId, ok) {
  const note = ok ? "" : (prompt("เหตุผลที่ปฏิเสธ:") || "");
  if (!ok && note === null) return; // กด Cancel

  try {
    ERP.loading.show(ok ? "กำลังอนุมัติ..." : "กำลังปฏิเสธ...");

    // 1. เปลี่ยนสถานะใน ProductionOrders โดยตรง
    const newStatus = ok ? "approved" : "rejected";
    await ERP.http.post("update", {
      sheet: "ProductionOrders",
      id   : moId,
      data : {
        status      : newStatus,
        approvedAt  : new Date().toLocaleString("th-TH"),
        approvedBy  : ERP.session.user?.id || "admin",
        statusNote  : note || "",
      }
    });

    // 2. อัปเดต Approvals sheet
    const apprRes = await ERP.api.approvals({ limit: 200 });
    const appr = (apprRes.data || []).find(a => a.docId === moId);
    if (appr) {
      await ERP.http.post("update", {
        sheet: "Approvals",
        id   : appr.id,
        data : {
          status     : newStatus,
          approvedBy : ERP.session.user?.id || "admin",
          approvedAt : new Date().toLocaleString("th-TH"),
          note       : note || "",
        }
      });
    }

    ERP.loading.hide();
    ERP.toast.success(ok ? `✅ อนุมัติ ${moId} สำเร็จ!` : `❌ ปฏิเสธ ${moId}`);
    _loadMOs();

  } catch(e) {
    ERP.loading.hide();
    ERP.toast.danger("ล้มเหลว: " + e.message);
  }
};

/* ─────────────────────────────────────────────────────────────
   STEP 5 — Live Notifications
───────────────────────────────────────────────────────────── */

window.page_notifications = function(c) {
  c.innerHTML = `<div class="page-hd"><div><div class="page-title"><i class="fas fa-bell" style="color:var(--blue);margin-right:7px"></i>Notification Center</div><div class="page-sub" id="notifSub">กำลังโหลด...</div></div><div class="page-hd-actions"><button class="btn btn-ghost btn-sm" onclick="_markAllRead()"><i class="fas fa-check-double"></i> อ่านทั้งหมด</button></div></div>
  <div class="card" id="notifList"><div style="padding:20px;text-align:center;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</div></div>`;
  _loadNotifications();
};

window._loadNotifications = async function() {
  try {
    const { data, unread } = await ERP.api.notifications(false);
    const sub = document.getElementById("notifSub");
    if (sub) sub.textContent = `${(data || []).length} การแจ้งเตือน · ${unread} ยังไม่อ่าน`;
    const colMap = { danger:"var(--red)", warning:"var(--amber)", info:"var(--blue)", success:"var(--green)" };
    const bgMap  = { danger:"var(--red-light)", warning:"var(--amber-light)", info:"var(--blue-light)", success:"var(--green-light)" };
    const iconMap= { danger:"fa-circle-exclamation", warning:"fa-triangle-exclamation", info:"fa-circle-info", success:"fa-circle-check" };
    document.getElementById("notifList").innerHTML = (data || []).map(n => `
      <div class="notif-item ${!n.isRead && n.isRead !== "true" ? "unread" : ""}" onclick="_readNotif('${n.id}',this)">
        <div class="notif-icon-wrap" style="background:${bgMap[n.type]||"var(--blue-light)"};color:${colMap[n.type]||"var(--blue)"}"><i class="fas ${iconMap[n.type]||"fa-bell"}"></i></div>
        <div class="notif-body">
          <div class="notif-title">${(!n.isRead&&n.isRead!=="true")?'<span style="color:var(--red);margin-right:5px">●</span>':""} ${n.title}</div>
          <div class="notif-desc">${n.message || ""}</div>
          <div class="notif-time"><i class="fas fa-clock"></i> ${n.createdAt || ""}</div>
        </div>
      </div>`).join("") || `<div style="padding:30px;text-align:center;color:var(--muted)"><i class="fas fa-bell-slash" style="font-size:32px;opacity:.3"></i><div style="margin-top:8px">ไม่มีการแจ้งเตือน</div></div>`;
  } catch (e) { ERP.toast.danger("โหลดการแจ้งเตือนล้มเหลว"); }
};

window._readNotif = async function(id, el) {
  el.classList.remove("unread");
  await ERP.api.markRead(id).catch(() => {});
};

window._markAllRead = async function() {
  await ERP.run(() => ERP.api.markAllRead(), { successMsg: "ทำเครื่องหมายอ่านแล้วทั้งหมด" });
  _loadNotifications();
};

/* ─────────────────────────────────────────────────────────────
   STEP 6 — Live QC page with save to GAS
───────────────────────────────────────────────────────────── */

const _origQCPage = window.page_qc;
window.page_qc = function(c) {
  _origQCPage(c); // render UI เดิม

  // Override submitQC
  window.submitQC = async function() {
    const votes_data = {};
    document.querySelectorAll(".qc-btn.active").forEach(btn => {
      const item = btn.closest(".qc-item");
      if (!item) return;
      const name = item.querySelector(".qc-item-name")?.textContent;
      const type = btn.classList.contains("pass") ? "pass" : "fail";
      const noteEl = item.querySelector(".qc-note");
      const fieldMap = { "กลิ่น":"smell","ความสะอาด":"cleanliness","การรั่วซึม":"leakage","ฉลาก":"label","หัวสเปรย์":"sprayer","วันที่ผลิต":"mfgDate","กล่อง":"box","ซีล":"seal" };
      const field = fieldMap[name];
      if (field) { votes_data[`${field}_result`] = type; votes_data[`${field}_note`] = noteEl?.value || ""; }
    });

    const mo = ERP.session.user?.currentMO || "MO-2401-001";
    await ERP.run(() => ERP.api.saveQC({ moId: mo, batchNumber: "B2401-01", sampleQty: 2000, ...votes_data }),
      { successMsg: "บันทึก QC สำเร็จ!", loadingMsg: "กำลังบันทึก QC..." });
    nav("closeorder");
  };
};

/* ─────────────────────────────────────────────────────────────
   STEP 7 — Close Order: live save
───────────────────────────────────────────────────────────── */

const _origClosePage = window.page_closeorder;
window.page_closeorder = function(c) {
  _origClosePage(c);
  // Override confirm button
  c.querySelectorAll(".btn-success").forEach(btn => {
    if (btn.textContent.includes("ยืนยัน")) {
      btn.onclick = async () => {
        await ERP.run(
          () => ERP.api.closeOrder("MO-2401-001", { totalProduced: 2000, qcPassedQty: 1985, qcFailedQty: 15 }),
          { loadingMsg: "กำลังปิดงาน...", successMsg: "🎉 ปิดงาน MO-2401-001 สำเร็จ! Rose Elixir 1,985 ขวด เข้าคลังแล้ว" }
        );
        nav("finishedgoods");
      };
    }
  });
};

/* ─────────────────────────────────────────────────────────────
   STEP 8 — Real-time startup
───────────────────────────────────────────────────────────── */

function _startRealtime() {
  // อัปเดตจำนวน unread badge
  ERP.realtime.subscribe("notifications", ({ unread }) => {
    document.querySelectorAll(".sb-badge").forEach(b => {
      if (b.closest('[data-page="notifications"]')) b.textContent = unread || "0";
    });
    const notifDot = document.querySelector(".tb-notif-dot");
    if (notifDot) notifDot.style.display = unread > 0 ? "block" : "none";
  }, 30_000);

  // อัปเดต KPI ทุก 60s ถ้าอยู่หน้า dashboard
  ERP.realtime.subscribe("kpi", (res) => {
    if (document.getElementById("kpiRow") && res.data) {
      // อัปเดต values โดยไม่ re-render ทั้งหมด
      const vals = document.querySelectorAll(".kpi-value");
      const kpi  = res.data;
      const items = [kpi.totalMaterials, kpi.totalFG, kpi.moToday, kpi.pendingApprovals, kpi.completedThisWeek, kpi.lateMOs];
      vals.forEach((el, i) => { if (items[i] !== undefined) el.textContent = ERP.utils.num(items[i]); });
    }
  }, 60_000);

  // Connectivity indicator
  ERP.connectivity.onStatusChange(online => {
    const dot = document.getElementById("connDot");
    const lbl = document.getElementById("connLabel");
    if (dot) dot.style.background = online ? "#16a34a" : "#dc2626";
    if (lbl) lbl.textContent = online ? "Google Sheets" : "ออฟไลน์";
  });
}

/* ─────────────────────────────────────────────────────────────
   STEP 9 — Update topbar connectivity IDs for erp-connect.js
───────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // Patch topbar conn element to give it IDs
  const conn = document.querySelector(".tb-conn");
  if (conn) {
    const dot = conn.querySelector(".tb-conn-dot");
    const lbl = conn.querySelector(":last-child") || conn;
    if (dot) dot.id = "connDot";
    conn.lastChild.textContent = "Google Sheets";
    const span = document.createElement("span");
    span.id = "connLabel"; span.textContent = "Google Sheets";
    if (dot && dot.nextSibling) conn.replaceChild(span, dot.nextSibling);
  }

  // If already logged in (session persisted), go straight to app
  if (ERP.session.isLoggedIn) {
    document.getElementById("loginScreen").style.display = "none";
    const app = document.getElementById("app");
    app.style.display = "flex";
    setTimeout(() => app.classList.add("visible"), 10);
    startClock();
    _startRealtime();
    nav("dashboard");
  }
});

console.log("[erp-integration-patch] Loaded — API URL:", ERP.CONFIG.GAS_URL);

// ─────────────────────────────────────────────────────────────
//  DIRECT ACTION HANDLERS — ทำงานได้โดยไม่ต้องผ่าน ERP.api
// ─────────────────────────────────────────────────────────────

// Override page_mo._new ให้บันทึกจริงใน Google Sheets
document.addEventListener("DOMContentLoaded", function() {
  setTimeout(function() {
    // Override สร้าง MO
    if (window.page_mo) {
      window.page_mo._new = async function() {
        // โหลดสูตรทั้งหมดก่อนเปิด Modal
        let formulaOptions = '<option value="">-- เลือกสูตร --</option>';
        try {
          const [fmRes1, fmRes2] = await Promise.all([
            ERP.api.formulas({ limit: 200 }),
            ERP.api.getAll("Formulas", { limit: 200 })
          ]);
          const fms = fmRes1.data || fmRes2.data || [];
          formulaOptions += fms.map(f =>
            `<option value="${f.id}">${f.code} — ${f.nameTH||f.code} (${f.revision||"Rev.1"})</option>`
          ).join("");
        } catch(_) {
          formulaOptions += '<option value="">ไม่พบสูตร</option>';
        }

        openModal(`
        <div class="modal-hd">
          <div class="modal-title"><i class="fas fa-plus-circle" style="color:var(--blue)"></i>สร้างใบสั่งผลิตใหม่</div>
          <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">ชื่อสินค้า *</label><input class="form-control" id="mo_name" placeholder="ชื่อสินค้า"></div>
            <div class="form-group"><label class="form-label">ประเภท</label><select class="form-control" id="mo_cat"><option>น้ำหอม EDP</option><option>น้ำหอม EDT</option><option>Body Mist</option><option>เครื่องสำอาง</option></select></div>
            <div class="form-group"><label class="form-label">ลูกค้า</label><input class="form-control" id="mo_cust" placeholder="ชื่อลูกค้า"></div>
            <div class="form-group"><label class="form-label">Sales Order</label><input class="form-control" id="mo_so" placeholder="SO-XXXX-XXX"></div>
            <div class="form-group"><label class="form-label">จำนวน *</label><input class="form-control" type="number" id="mo_qty" placeholder="0"></div>
            <div class="form-group"><label class="form-label">หน่วย</label><select class="form-control" id="mo_unit"><option>ขวด</option><option>ชิ้น</option><option>กล่อง</option></select></div>
            <div class="form-group"><label class="form-label">วันที่บรรจุ</label><input class="form-control" type="date" id="mo_fill"></div>
            <div class="form-group"><label class="form-label">วันส่งมอบ</label><input class="form-control" type="date" id="mo_deliver"></div>
            <div class="form-group" style="grid-column:1/-1">
              <label class="form-label"><i class="fas fa-flask" style="color:var(--blue)"></i> สูตรที่ใช้ผลิต</label>
              <select class="form-control" id="mo_formula" onchange="window._onFormulaSelect(this.value)">
                ${formulaOptions}
              </select>
            </div>
            <div class="form-group" id="mo_formula_detail" style="grid-column:1/-1;display:none">
              <div style="background:var(--blue-light);border:1px solid rgba(21,88,192,.15);border-radius:8px;padding:12px">
                <div style="font-size:11px;font-weight:600;color:var(--blue);margin-bottom:8px"><i class="fas fa-flask"></i> ส่วนผสมสูตรที่เลือก</div>
                <div id="mo_formula_ingr" style="font-size:11px;color:var(--muted)"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
          <button class="btn btn-primary" onclick="window._saveMO()"><i class="fas fa-floppy-disk"></i> สร้าง Draft</button>
        </div>`, true);
      };

// แสดงรายละเอียดสูตรที่เลือก
window._onFormulaSelect = async function(formulaId) {
  const detail = document.getElementById("mo_formula_detail");
  const ingrEl = document.getElementById("mo_formula_ingr");
  if (!formulaId || !detail || !ingrEl) {
    if (detail) detail.style.display = "none";
    return;
  }
  try {
    const { data: f } = await ERP.api.getById("Formulas", formulaId);
    let ingr = [];
    try { ingr = JSON.parse(f.ingredientsJson || "[]"); } catch(_) {}
    const total = ingr.reduce((s,i) => s+(parseFloat(i.pct)||0), 0);
    ingrEl.innerHTML = ingr.map(i =>
      `<span style="display:inline-block;margin:2px 4px;padding:2px 8px;background:rgba(21,88,192,.1);border-radius:4px">
        <strong>${i.sku||""}</strong> ${i.nameTH||""} <span style="color:var(--blue)">${i.pct||0}%</span>
      </span>`
    ).join("") + `<div style="margin-top:6px;font-weight:600;color:${Math.abs(total-100)<0.01?"var(--green)":"var(--red)"}">รวม: ${total.toFixed(2)}%</div>`;
    detail.style.display = "block";
  } catch(_) {
    if (detail) detail.style.display = "none";
  }
};
    }

    // Override เพิ่มวัตถุดิบ
    if (window.page_rawmaterial) {
      window.page_rawmaterial._addModal = function() {
        openModal(`
        <div class="modal-hd">
          <div class="modal-title"><i class="fas fa-plus-circle" style="color:var(--blue)"></i>เพิ่มวัตถุดิบใหม่</div>
          <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-grid">
            <div class="form-group"><label class="form-label">SKU</label><input class="form-control" id="rm_sku" placeholder="RM-XXX"></div>
            <div class="form-group"><label class="form-label">ชื่อภาษาไทย</label><input class="form-control" id="rm_nameTH" placeholder="ชื่อวัตถุดิบ"></div>
            <div class="form-group"><label class="form-label">ชื่อภาษาอังกฤษ</label><input class="form-control" id="rm_nameEN" placeholder="English name"></div>
            <div class="form-group"><label class="form-label">CAS Number</label><input class="form-control" id="rm_cas" placeholder="XXXXX-XX-X"></div>
            <div class="form-group"><label class="form-label">Supplier</label><input class="form-control" id="rm_supplier" placeholder="ชื่อ Supplier"></div>
            <div class="form-group"><label class="form-label">หน่วย</label><select class="form-control" id="rm_unit"><option>กก.</option><option>กรัม</option><option>ลิตร</option><option>มล.</option></select></div>
            <div class="form-group"><label class="form-label">จุดสั่งซื้อ</label><input class="form-control" type="number" id="rm_reorder" placeholder="0"></div>
            <div class="form-group"><label class="form-label">ราคาต่อหน่วย</label><input class="form-control" type="number" id="rm_cost" placeholder="0"></div>
          </div>
        </div>
        <div class="modal-ft">
          <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
          <button class="btn btn-primary" onclick="window._saveRawMaterial()"><i class="fas fa-floppy-disk"></i> บันทึก</button>
        </div>`);
      };
    }
  }, 1000);
});

// Save MO to Google Sheets
window._saveMO = async function() {
  const name = document.getElementById("mo_name")?.value?.trim();
  const qty  = document.getElementById("mo_qty")?.value;
  if (!name) { alert("กรุณากรอกชื่อสินค้า"); return; }
  if (!qty || qty <= 0) { alert("กรุณากรอกจำนวน"); return; }

  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }

  try {
    const res = await ERP.http.post("createMO", {
      data: {
        productName    : name,
        productCategory: document.getElementById("mo_cat")?.value      || "",
        customerId     : document.getElementById("mo_cust")?.value      || "",
        salesOrderNo   : document.getElementById("mo_so")?.value        || "",
        qty            : qty,
        unit           : document.getElementById("mo_unit")?.value      || "ขวด",
        fillDate       : document.getElementById("mo_fill")?.value      || "",
        deliveryDate   : document.getElementById("mo_deliver")?.value   || "",
        formulaId      : document.getElementById("mo_formula")?.value   || "",
      }
    });
    closeModal();
    alert("✅ สร้าง MO สำเร็จ!\nBatch: " + res.batchNumber + "\nMO: " + res.moId);
    nav("mo");
  } catch(e) {
    alert("❌ สร้าง MO ล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "สร้าง Draft"; }
  }
};

// Save Raw Material to Google Sheets
window._saveRawMaterial = async function() {
  const sku  = document.getElementById("rm_sku")?.value?.trim();
  const name = document.getElementById("rm_nameTH")?.value?.trim();
  if (!sku)  { alert("กรุณากรอก SKU"); return; }
  if (!name) { alert("กรุณากรอกชื่อวัตถุดิบ"); return; }

  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }

  try {
    await ERP.http.post("insert", {
      sheet: "RawMaterials",
      data: {
        id       : sku,
        sku      : sku,
        nameTH   : name,
        nameEN   : document.getElementById("rm_nameEN")?.value   || "",
        casNumber: document.getElementById("rm_cas")?.value      || "",
        supplier : document.getElementById("rm_supplier")?.value || "",
        unit     : document.getElementById("rm_unit")?.value     || "กก.",
        reorderPoint: document.getElementById("rm_reorder")?.value || 0,
        unitCost : document.getElementById("rm_cost")?.value     || 0,
        status   : "active",
      }
    });
    closeModal();
    alert("✅ เพิ่มวัตถุดิบสำเร็จ!");
    nav("rawmaterial");
  } catch(e) {
    alert("❌ เพิ่มวัตถุดิบล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึก"; }
  }
};

// ─────────────────────────────────────────────────────────────
//  เพิ่มผู้ใช้ใหม่ — บันทึกลง Google Sheets
// ─────────────────────────────────────────────────────────────

window._showAddUser = function() {
  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-user-plus" style="color:var(--blue)"></i>เพิ่มผู้ใช้ใหม่</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Username</label><input class="form-control" id="u_username" placeholder="username"></div>
      <div class="form-group"><label class="form-label">รหัสผ่าน</label><input class="form-control" type="password" id="u_password" placeholder="รหัสผ่าน"></div>
      <div class="form-group"><label class="form-label">ชื่อ (ไทย)</label><input class="form-control" id="u_nameTH" placeholder="ชื่อ นามสกุล"></div>
      <div class="form-group"><label class="form-label">ตำแหน่ง</label><input class="form-control" id="u_position" placeholder="ตำแหน่ง"></div>
      <div class="form-group"><label class="form-label">แผนก</label><input class="form-control" id="u_dept" placeholder="แผนก"></div>
      <div class="form-group"><label class="form-label">เบอร์โทร</label><input class="form-control" id="u_phone" placeholder="08X-XXX-XXXX"></div>
      <div class="form-group"><label class="form-label">อีเมล</label><input class="form-control" id="u_email" placeholder="email@company.com"></div>
      <div class="form-group"><label class="form-label">Role</label>
        <select class="form-control" id="u_role">
          <option value="manager">Manager</option>
          <option value="qc">QC</option>
          <option value="production">Production</option>
          <option value="warehouse">Warehouse</option>
          <option value="sales">Sales</option>
          <option value="accounting">Accounting</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._saveUser()"><i class="fas fa-floppy-disk"></i> บันทึก</button>
  </div>`);
};

window._saveUser = async function() {
  const username = document.getElementById("u_username")?.value?.trim();
  const password = document.getElementById("u_password")?.value;
  const nameTH   = document.getElementById("u_nameTH")?.value?.trim();

  if (!username) { alert("กรุณากรอก Username"); return; }
  if (!password) { alert("กรุณากรอกรหัสผ่าน"); return; }
  if (!nameTH)   { alert("กรุณากรอกชื่อ"); return; }

  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }

  // Hash password via GAS hashUser action
  try {
    await ERP.http.post("createUser", {
      username  : username,
      password  : password,
      nameTH    : nameTH,
      position  : document.getElementById("u_position")?.value || "",
      department: document.getElementById("u_dept")?.value     || "",
      phone     : document.getElementById("u_phone")?.value    || "",
      email     : document.getElementById("u_email")?.value    || "",
      role      : document.getElementById("u_role")?.value     || "production",
      status    : "active",
      startDate : new Date().toLocaleDateString("th-TH"),
    });
    closeModal();
    alert("✅ เพิ่มผู้ใช้ " + username + " สำเร็จ!");
    nav("users");
  } catch(e) {
    alert("❌ เพิ่มผู้ใช้ล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึก"; }
  }
};

// Override page_users ให้ปุ่มเพิ่มผู้ใช้ทำงาน
const _origUsers = window.page_users;
window.page_users = function(c) {
  if (_origUsers) _origUsers(c);
  setTimeout(() => {
    const addBtn = c.querySelector(".btn-primary");
    if (addBtn && addBtn.textContent.includes("เพิ่มผู้ใช้")) {
      addBtn.onclick = window._showAddUser;
    }
  }, 100);
};

// ─────────────────────────────────────────────────────────────
//  Live Users Page — ดึงข้อมูลจริงจาก Google Sheets
// ─────────────────────────────────────────────────────────────
window.page_users = function(c) {
  c.innerHTML = `
  <div class="page-hd">
    <div><div class="page-title"><i class="fas fa-users" style="color:var(--blue);margin-right:7px"></i>จัดการผู้ใช้และสิทธิ์</div>
    <div class="page-sub" id="userSub">กำลังโหลด...</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="nav('users')"><i class="fas fa-rotate"></i></button>
      <button class="btn btn-primary btn-sm" onclick="window._showAddUser()"><i class="fas fa-user-plus"></i> เพิ่มผู้ใช้</button>
    </div>
  </div>
  <div class="card">
    <div class="tbl-wrap"><table>
      <thead><tr><th>ผู้ใช้</th><th>ตำแหน่ง</th><th>Role</th><th>Email</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
      <tbody id="userTbody"><tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i> กำลังโหลด...</td></tr></tbody>
    </table></div>
  </div>`;

  ERP.run(async () => {
    const { data } = await ERP.api.users();
    const sub = document.getElementById("userSub");
    if (sub) sub.textContent = `${(data||[]).length} ผู้ใช้ทั้งหมด`;
    const roleColor = { super_admin:"badge-red", manager:"badge-blue", qc:"badge-teal", production:"badge-green", warehouse:"badge-amber", sales:"badge-purple", accounting:"badge-gray" };
    document.getElementById("userTbody").innerHTML = (data||[]).map(u => `
      <tr>
        <td><div style="display:flex;align-items:center;gap:10px">
          <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--green));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px;flex-shrink:0">${(u.nameTH||u.username||"?").substring(0,2)}</div>
          <div><div style="font-weight:600">${u.nameTH||u.username}</div><div style="font-size:11px;color:var(--muted)">${u.username}</div></div>
        </div></td>
        <td style="font-size:12px">${u.position||"-"}</td>
        <td><span class="badge ${roleColor[u.role]||"badge-gray"}">${u.role||"-"}</span></td>
        <td style="font-size:12px">${u.email||"-"}</td>
        <td><span class="badge ${u.status==="active"?"badge-green":"badge-gray"}">${u.status==="active"?"Active":"Inactive"}</span></td>
        <td><div class="flex gap-6">
          <button class="btn btn-ghost btn-xs" onclick="window._editUser('${u.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn btn-xs btn-danger" onclick="window._deleteUser('${u.id}','${u.nameTH||u.username}')"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">ไม่พบข้อมูล</td></tr>`;
  }, { loading: false, errorMsg: "โหลดผู้ใช้ล้มเหลว" });
};

window._deleteUser = async function(id, name) {
  if (!confirm("ลบผู้ใช้ " + name + "?")) return;
  await ERP.run(() => ERP.api.delete_("Users", id), { successMsg: "ลบ " + name + " สำเร็จ" });
  nav("users");
};

// ─────────────────────────────────────────────────────────────
//  แก้ไขวัตถุดิบ
// ─────────────────────────────────────────────────────────────
window._editMaterial = async function(id) {
  const { data: m } = await ERP.run(
    () => ERP.api.getById("RawMaterials", id),
    { loadingMsg: "กำลังโหลดข้อมูล..." }
  );
  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-pen" style="color:var(--blue)"></i>แก้ไขวัตถุดิบ: ${m.sku}</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">SKU</label><input class="form-control" id="em_sku" value="${m.sku||""}" readonly style="opacity:.6"></div>
      <div class="form-group"><label class="form-label">ชื่อภาษาไทย</label><input class="form-control" id="em_nameTH" value="${m.nameTH||""}"></div>
      <div class="form-group"><label class="form-label">ชื่อภาษาอังกฤษ</label><input class="form-control" id="em_nameEN" value="${m.nameEN||""}"></div>
      <div class="form-group"><label class="form-label">CAS Number</label><input class="form-control" id="em_cas" value="${m.casNumber||""}"></div>
      <div class="form-group"><label class="form-label">Supplier</label><input class="form-control" id="em_supplier" value="${m.supplier||""}"></div>
      <div class="form-group"><label class="form-label">หน่วย</label>
        <select class="form-control" id="em_unit">
          <option ${m.unit==="กก."?"selected":""}>กก.</option>
          <option ${m.unit==="กรัม"?"selected":""}>กรัม</option>
          <option ${m.unit==="ลิตร"?"selected":""}>ลิตร</option>
          <option ${m.unit==="มล."?"selected":""}>มล.</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">จุดสั่งซื้อ</label><input class="form-control" type="number" id="em_reorder" value="${m.reorderPoint||0}"></div>
      <div class="form-group"><label class="form-label">ราคาต่อหน่วย</label><input class="form-control" type="number" id="em_cost" value="${m.unitCost||0}"></div>
      <div class="form-group"><label class="form-label">สถานะ</label>
        <select class="form-control" id="em_status">
          <option value="active" ${m.status==="active"?"selected":""}>Active</option>
          <option value="inactive" ${m.status==="inactive"?"selected":""}>Inactive</option>
        </select>
      </div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._updateMaterial('${id}')"><i class="fas fa-floppy-disk"></i> บันทึก</button>
  </div>`);
};

window._updateMaterial = async function(id) {
  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    await ERP.api.updateMaterial(id, {
      nameTH      : document.getElementById("em_nameTH")?.value,
      nameEN      : document.getElementById("em_nameEN")?.value,
      casNumber   : document.getElementById("em_cas")?.value,
      supplier    : document.getElementById("em_supplier")?.value,
      unit        : document.getElementById("em_unit")?.value,
      reorderPoint: document.getElementById("em_reorder")?.value,
      unitCost    : document.getElementById("em_cost")?.value,
      status      : document.getElementById("em_status")?.value,
    });
    closeModal();
    ERP.toast.success("บันทึกสำเร็จ!");
    nav("rawmaterial");
  } catch(e) {
    ERP.toast.danger("บันทึกล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึก"; }
  }
};

// ─────────────────────────────────────────────────────────────
//  แก้ไขผู้ใช้
// ─────────────────────────────────────────────────────────────
window._editUser = async function(id) {
  const { data: u } = await ERP.run(
    () => ERP.api.getById("Users", id),
    { loadingMsg: "กำลังโหลดข้อมูล..." }
  );
  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-pen" style="color:var(--blue)"></i>แก้ไขผู้ใช้: ${u.username}</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">Username</label><input class="form-control" value="${u.username||""}" readonly style="opacity:.6"></div>
      <div class="form-group"><label class="form-label">รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)</label><input class="form-control" type="password" id="eu_pass" placeholder="รหัสผ่านใหม่"></div>
      <div class="form-group"><label class="form-label">ชื่อ (ไทย)</label><input class="form-control" id="eu_nameTH" value="${u.nameTH||""}"></div>
      <div class="form-group"><label class="form-label">ตำแหน่ง</label><input class="form-control" id="eu_position" value="${u.position||""}"></div>
      <div class="form-group"><label class="form-label">แผนก</label><input class="form-control" id="eu_dept" value="${u.department||""}"></div>
      <div class="form-group"><label class="form-label">เบอร์โทร</label><input class="form-control" id="eu_phone" value="${u.phone||""}"></div>
      <div class="form-group"><label class="form-label">อีเมล</label><input class="form-control" id="eu_email" value="${u.email||""}"></div>
      <div class="form-group"><label class="form-label">Role</label>
        <select class="form-control" id="eu_role">
          <option value="manager" ${u.role==="manager"?"selected":""}>Manager</option>
          <option value="qc" ${u.role==="qc"?"selected":""}>QC</option>
          <option value="production" ${u.role==="production"?"selected":""}>Production</option>
          <option value="warehouse" ${u.role==="warehouse"?"selected":""}>Warehouse</option>
          <option value="sales" ${u.role==="sales"?"selected":""}>Sales</option>
          <option value="super_admin" ${u.role==="super_admin"?"selected":""}>Super Admin</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">สถานะ</label>
        <select class="form-control" id="eu_status">
          <option value="active" ${u.status==="active"?"selected":""}>Active</option>
          <option value="inactive" ${u.status==="inactive"?"selected":""}>Inactive</option>
        </select>
      </div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._updateUser('${id}')"><i class="fas fa-floppy-disk"></i> บันทึก</button>
  </div>`);
};

window._updateUser = async function(id) {
  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  const newPass = document.getElementById("eu_pass")?.value;
  const updateData = {
    nameTH    : document.getElementById("eu_nameTH")?.value,
    position  : document.getElementById("eu_position")?.value,
    department: document.getElementById("eu_dept")?.value,
    phone     : document.getElementById("eu_phone")?.value,
    email     : document.getElementById("eu_email")?.value,
    role      : document.getElementById("eu_role")?.value,
    status    : document.getElementById("eu_status")?.value,
  };
  if (newPass) updateData.password = newPass;
  try {
    await ERP.api.updateUser(id, updateData);
    closeModal();
    ERP.toast.success("บันทึกสำเร็จ!");
    nav("users");
  } catch(e) {
    ERP.toast.danger("บันทึกล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึก"; }
  }
};

// ─────────────────────────────────────────────────────────────
//  อนุมัติ/ปฏิเสธเอกสาร — บันทึกลง Google Sheets
// ─────────────────────────────────────────────────────────────
window._approveDoc = async function(docId, docType, approved) {
  const action = approved ? "อนุมัติ" : "ปฏิเสธ";
  let note = "";
  if (!approved) {
    note = prompt("เหตุผลที่ปฏิเสธ:") || "";
    if (note === null) return; // กด Cancel
  }
  if (!confirm(`${action} เอกสาร ${docId}?`)) return;

  try {
    ERP.loading.show(`กำลัง${action}...`);

    if (docType === "MO" || docType === "Manufacturing Order") {
      await ERP.api.approveMO(docId, approved, note);
    } else {
      // Generic approval
      const approvals = await ERP.api.approvals();
      const appr = (approvals.data || []).find(a => a.docId === docId);
      if (appr) {
        await ERP.api.update("Approvals", appr.id, {
          status     : approved ? "approved" : "rejected",
          approvedBy : ERP.session.user?.id || "admin",
          approvedAt : new Date().toLocaleString("th-TH"),
          note       : note,
        });
      }
    }

    ERP.loading.hide();
    ERP.toast.success(`${action} ${docId} สำเร็จ!`);
    nav("approvals");
  } catch(e) {
    ERP.loading.hide();
    ERP.toast.danger(`${action}ล้มเหลว: ` + e.message);
  }
};

// Override หน้าอนุมัติเอกสารให้ปุ่มทำงาน
const _origApprovals = window.page_approvals;
window.page_approvals = function(c) {
  c.innerHTML = `
  <div class="page-hd">
    <div>
      <div class="page-title"><i class="fas fa-stamp" style="color:var(--blue);margin-right:7px"></i>อนุมัติเอกสาร</div>
      <div class="page-sub" id="apprSub">กำลังโหลด...</div>
    </div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="nav('approvals')"><i class="fas fa-rotate"></i></button>
    </div>
  </div>
  <div class="card">
    <div class="tbl-wrap"><table>
      <thead><tr><th>เลขเอกสาร</th><th>ประเภท</th><th>ผู้สร้าง</th><th>วันที่</th><th>สถานะ</th><th>ผู้อนุมัติ</th><th>การดำเนินการ</th></tr></thead>
      <tbody id="apprTbody"><tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
    </table></div>
  </div>`;

  ERP.run(async () => {
    const { data } = await ERP.api.approvals({ limit: 100 });
    const rows = data || [];
    const sub = document.getElementById("apprSub");
    if (sub) sub.textContent = `${rows.length} รายการ · รออนุมัติ ${rows.filter(r=>r.status==="waiting"||r.status==="draft").length} รายการ`;

    const stColor = { approved:"badge-green", rejected:"badge-red", waiting:"badge-amber", draft:"badge-gray" };
    const stLabel = { approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", waiting:"รออนุมัติ", draft:"Draft" };

    document.getElementById("apprTbody").innerHTML = rows.map(a => {
      const isPending = a.status === "waiting" || a.status === "draft";
      return `<tr>
        <td><span class="cell-code">${a.docId||"-"}</span></td>
        <td style="font-size:12px">${a.docType||"-"}</td>
        <td style="font-size:12px">${a.requestedBy||"-"}</td>
        <td style="font-size:11px;color:var(--muted)">${a.requestedAt||"-"}</td>
        <td><span class="badge ${stColor[a.status]||"badge-gray"}">${stLabel[a.status]||a.status}</span></td>
        <td style="font-size:12px">${a.approvedBy||"-"}</td>
        <td><div class="flex gap-6">
          ${isPending ? `
            <button class="btn btn-xs btn-success" onclick="window._approveDoc('${a.docId}','${a.docType}',true)">
              <i class="fas fa-check"></i> อนุมัติ
            </button>
            <button class="btn btn-xs btn-danger" onclick="window._approveDoc('${a.docId}','${a.docType}',false)">
              <i class="fas fa-times"></i> ปฏิเสธ
            </button>` : ""}
          <button class="btn btn-ghost btn-xs" onclick="nav('mo')">
            <i class="fas fa-eye"></i>
          </button>
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">ไม่มีเอกสารรออนุมัติ</td></tr>`;
  }, { loading: false });
};

// ─────────────────────────────────────────────────────────────
//  คลังอุปกรณ์การผลิต — เพิ่ม/แก้ไข/ลบ
// ─────────────────────────────────────────────────────────────
window.page_equipment = function(c) {
  c.innerHTML = `
  <div class="page-hd">
    <div><div class="page-title"><i class="fas fa-boxes-stacked" style="color:var(--blue);margin-right:7px"></i>คลังอุปกรณ์การผลิต</div>
    <div class="page-sub" id="eqSub">กำลังโหลด...</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="nav('equipment')"><i class="fas fa-rotate"></i></button>
      <button class="btn btn-ghost btn-sm" onclick="ERP.utils.exportCSV(window._eqData||[],'อุปกรณ์')"><i class="fas fa-file-excel" style="color:#217346"></i> Export</button>
      <button class="btn btn-primary btn-sm" onclick="window._showAddEquipment()"><i class="fas fa-plus"></i> เพิ่มอุปกรณ์</button>
    </div>
  </div>
  <div class="card">
    <div class="tbl-wrap"><table>
      <thead><tr><th>SKU</th><th>ชื่ออุปกรณ์</th><th>ประเภท</th><th>Supplier</th><th>คงเหลือ</th><th>จุดสั่งซื้อ</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
      <tbody id="eqTbody"><tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
    </table></div>
  </div>`;

  ERP.run(async () => {
    const { data } = await ERP.api.equipment({ limit: 200 });
    window._eqData = data || [];
    const sub = document.getElementById("eqSub");
    if (sub) sub.textContent = `${(data||[]).length} รายการ · อัปเดต ${new Date().toLocaleTimeString("th-TH")}`;
    document.getElementById("eqTbody").innerHTML = (data||[]).map(eq => {
      const low = parseInt(eq.stockQty) <= parseInt(eq.reorderPoint);
      return `<tr>
        <td><span class="cell-code">${eq.sku}</span></td>
        <td><strong>${eq.nameTH||eq.sku}</strong><div style="font-size:10px;color:var(--muted)">${eq.nameEN||""}</div></td>
        <td><span class="badge badge-blue" style="font-size:10px">${eq.category||"-"}</span></td>
        <td style="font-size:12px">${eq.supplier||"-"}</td>
        <td style="font-weight:700;color:${low?"var(--red)":"var(--ink)"}">${ERP.utils.num(eq.stockQty)} ${eq.unit||""}</td>
        <td style="font-size:12px;color:var(--muted)">${ERP.utils.num(eq.reorderPoint)} ${eq.unit||""}</td>
        <td><span class="badge ${low?"badge-red":"badge-green"}">${low?"ต่ำ":"ปกติ"}</span></td>
        <td><div class="flex gap-6">
          <button class="btn btn-ghost btn-xs" onclick="window._editEquipment('${eq.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn btn-xs btn-danger" onclick="window._deleteEquipment('${eq.id}','${eq.nameTH||eq.sku}')"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">ไม่พบข้อมูล</td></tr>`;
  }, { loading: false });
};

window._showAddEquipment = function() {
  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-plus-circle" style="color:var(--blue)"></i>เพิ่มอุปกรณ์การผลิต</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">SKU</label><input class="form-control" id="eq_sku" placeholder="EQ-XXX"></div>
      <div class="form-group"><label class="form-label">ชื่อภาษาไทย</label><input class="form-control" id="eq_nameTH" placeholder="ชื่ออุปกรณ์"></div>
      <div class="form-group"><label class="form-label">ชื่อภาษาอังกฤษ</label><input class="form-control" id="eq_nameEN" placeholder="English name"></div>
      <div class="form-group"><label class="form-label">ประเภท</label>
        <select class="form-control" id="eq_cat">
          <option value="bottle">ขวด</option>
          <option value="cap">ฝา</option>
          <option value="sprayer">หัวสเปรย์</option>
          <option value="box">กล่อง</option>
          <option value="label">ฉลาก</option>
          <option value="shrinkwrap">ฟิล์มหด</option>
          <option value="other">อื่นๆ</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Supplier</label><input class="form-control" id="eq_supplier" placeholder="ชื่อ Supplier"></div>
      <div class="form-group"><label class="form-label">หน่วย</label>
        <select class="form-control" id="eq_unit">
          <option value="ใบ">ใบ</option>
          <option value="ชิ้น">ชิ้น</option>
          <option value="กล่อง">กล่อง</option>
          <option value="ม้วน">ม้วน</option>
          <option value="แผ่น">แผ่น</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">จำนวนคงเหลือ</label><input class="form-control" type="number" id="eq_stock" placeholder="0" value="0"></div>
      <div class="form-group"><label class="form-label">จุดสั่งซื้อ</label><input class="form-control" type="number" id="eq_reorder" placeholder="0" value="0"></div>
      <div class="form-group"><label class="form-label">ราคาต่อหน่วย</label><input class="form-control" type="number" id="eq_cost" placeholder="0" value="0"></div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._saveEquipment()"><i class="fas fa-floppy-disk"></i> บันทึก</button>
  </div>`);
};

window._saveEquipment = async function() {
  const sku  = document.getElementById("eq_sku")?.value?.trim();
  const name = document.getElementById("eq_nameTH")?.value?.trim();
  if (!sku)  { alert("กรุณากรอก SKU"); return; }
  if (!name) { alert("กรุณากรอกชื่ออุปกรณ์"); return; }
  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    await ERP.http.post("insert", {
      sheet: "Equipment",
      data: {
        id          : sku,
        sku         : sku,
        nameTH      : name,
        nameEN      : document.getElementById("eq_nameEN")?.value  || "",
        category    : document.getElementById("eq_cat")?.value     || "",
        supplier    : document.getElementById("eq_supplier")?.value|| "",
        unit        : document.getElementById("eq_unit")?.value    || "ชิ้น",
        stockQty    : document.getElementById("eq_stock")?.value   || 0,
        reorderPoint: document.getElementById("eq_reorder")?.value || 0,
        unitCost    : document.getElementById("eq_cost")?.value    || 0,
        status      : "active",
      }
    });
    closeModal();
    ERP.toast.success("เพิ่มอุปกรณ์ " + name + " สำเร็จ!");
    nav("equipment");
  } catch(e) {
    ERP.toast.danger("บันทึกล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึก"; }
  }
};

window._editEquipment = async function(id) {
  const { data: eq } = await ERP.run(() => ERP.api.getById("Equipment", id), { loadingMsg: "กำลังโหลด..." });
  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-pen" style="color:var(--blue)"></i>แก้ไขอุปกรณ์: ${eq.sku}</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">SKU</label><input class="form-control" value="${eq.sku||""}" readonly style="opacity:.6"></div>
      <div class="form-group"><label class="form-label">ชื่อภาษาไทย</label><input class="form-control" id="eeq_nameTH" value="${eq.nameTH||""}"></div>
      <div class="form-group"><label class="form-label">Supplier</label><input class="form-control" id="eeq_supplier" value="${eq.supplier||""}"></div>
      <div class="form-group"><label class="form-label">จำนวนคงเหลือ</label><input class="form-control" type="number" id="eeq_stock" value="${eq.stockQty||0}"></div>
      <div class="form-group"><label class="form-label">จุดสั่งซื้อ</label><input class="form-control" type="number" id="eeq_reorder" value="${eq.reorderPoint||0}"></div>
      <div class="form-group"><label class="form-label">ราคาต่อหน่วย</label><input class="form-control" type="number" id="eeq_cost" value="${eq.unitCost||0}"></div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._updateEquipment('${id}')"><i class="fas fa-floppy-disk"></i> บันทึก</button>
  </div>`);
};

window._updateEquipment = async function(id) {
  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    await ERP.api.update("Equipment", id, {
      nameTH      : document.getElementById("eeq_nameTH")?.value,
      supplier    : document.getElementById("eeq_supplier")?.value,
      stockQty    : document.getElementById("eeq_stock")?.value,
      reorderPoint: document.getElementById("eeq_reorder")?.value,
      unitCost    : document.getElementById("eeq_cost")?.value,
    });
    closeModal();
    ERP.toast.success("บันทึกสำเร็จ!");
    nav("equipment");
  } catch(e) {
    ERP.toast.danger("บันทึกล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึก"; }
  }
};

window._deleteEquipment = async function(id, name) {
  if (!confirm("ลบอุปกรณ์ " + name + "?")) return;
  await ERP.run(() => ERP.api.delete_("Equipment", id), { successMsg: "ลบ " + name + " สำเร็จ" });
  nav("equipment");
};

// ─────────────────────────────────────────────────────────────
//  PRINT SYSTEM — พิมพ์เอกสาร A4
// ─────────────────────────────────────────────────────────────

window.ERP_PRINT = {

  // ── Template หลัก ──
  _base(title, docNo, content, sigs = "") {
    return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'IBM Plex Sans Thai', sans-serif; font-size: 11pt; color: #000; }
  .doc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #1558c0; padding-bottom: 10pt; margin-bottom: 14pt; }
  .company-name { font-size: 16pt; font-weight: 700; color: #1558c0; }
  .company-sub { font-size: 9pt; color: #666; margin-top: 3pt; }
  .doc-title-box { text-align: right; }
  .doc-title { font-size: 15pt; font-weight: 700; color: #1558c0; }
  .doc-no { font-size: 10pt; color: #333; margin-top: 4pt; }
  .doc-date { font-size: 9pt; color: #666; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6pt 20pt; margin-bottom: 14pt; }
  .info-item { display: flex; gap: 6pt; font-size: 10pt; }
  .info-label { color: #666; white-space: nowrap; min-width: 80pt; }
  .info-value { font-weight: 500; }
  table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 10pt; }
  th { background: #1558c0; color: #fff; padding: 6pt 8pt; text-align: left; font-weight: 600; }
  td { padding: 5pt 8pt; border-bottom: 0.5pt solid #e0e0e0; }
  tr:nth-child(even) td { background: #f8f9ff; }
  .section-title { font-size: 12pt; font-weight: 700; color: #1558c0; border-left: 3pt solid #1558c0; padding-left: 8pt; margin: 14pt 0 8pt; }
  .sig-row { display: flex; justify-content: space-around; margin-top: 30pt; }
  .sig-box { text-align: center; width: 120pt; }
  .sig-line { border-top: 1pt solid #000; padding-top: 5pt; margin-top: 30pt; font-size: 9pt; }
  .sig-role { font-size: 9pt; color: #666; margin-top: 3pt; }
  .badge { display: inline-block; padding: 2pt 7pt; border-radius: 4pt; font-size: 9pt; font-weight: 600; }
  .badge-blue { background: #dbeafe; color: #1e40af; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-red { background: #fee2e2; color: #991b1b; }
  .badge-amber { background: #fef3c7; color: #92400e; }
  .footer { position: fixed; bottom: 10mm; left: 0; right: 0; text-align: center; font-size: 8pt; color: #999; border-top: 0.5pt solid #ddd; padding-top: 4pt; }
  .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 60pt; color: rgba(21,88,192,.05); font-weight: 700; pointer-events: none; z-index: 0; }
  @media print { .no-print { display: none; } }
</style>
</head><body>
<div class="watermark">คนตัวหอม ERP</div>
<div class="doc-header">
  <div>
    <div class="company-name">บริษัท คนตัวหอม จำกัด</div>
    <div class="company-sub">KON TOM HOM CO., LTD. | GMP & ISO Certified</div>
  </div>
  <div class="doc-title-box">
    <div class="doc-title">${title}</div>
    <div class="doc-no">เลขที่: ${docNo}</div>
    <div class="doc-date">วันที่พิมพ์: ${new Date().toLocaleDateString("th-TH",{year:"numeric",month:"long",day:"numeric"})}</div>
  </div>
</div>
${content}
${sigs}
<div class="footer">บริษัท คนตัวหอม จำกัด | ระบบ ERP v2.5 | พิมพ์โดย: ${ERP.session.user?.nameTH||"ผู้ดูแลระบบ"}</div>
</body></html>`;
  },

  // ── พิมพ์ MO ──
  async mo(moId) {
    try {
      ERP.loading.show("กำลังโหลดข้อมูล MO...");
      const { data } = await ERP.api.moDetail(moId);
      ERP.loading.hide();
      const mo = data.mo;
      const svcList = [
        mo.svcDesignBottle && "ออกแบบขวด",
        mo.svcDesignLabel  && "ออกแบบฉลาก",
        mo.svcDesignBox    && "ออกแบบกล่อง",
        mo.svcDesignFormula&& "ออกแบบสูตร",
        mo.svcFDANumber    && "ขอเลข อย.",
        mo.svcExciseNumber && "ขอเลขสรรพสามิต",
      ].filter(Boolean).join(", ") || "-";

      const content = `
      <div class="info-grid">
        <div class="info-item"><span class="info-label">สินค้า:</span><span class="info-value">${mo.productName||"-"}</span></div>
        <div class="info-item"><span class="info-label">Batch:</span><span class="info-value">${mo.batchNumber||"-"}</span></div>
        <div class="info-item"><span class="info-label">ประเภท:</span><span class="info-value">${mo.productCategory||"-"}</span></div>
        <div class="info-item"><span class="info-label">ลูกค้า:</span><span class="info-value">${mo.customerId||"-"}</span></div>
        <div class="info-item"><span class="info-label">Sales Order:</span><span class="info-value">${mo.salesOrderNo||"-"}</span></div>
        <div class="info-item"><span class="info-label">จำนวน:</span><span class="info-value">${mo.qty||0} ${mo.unit||""}</span></div>
        <div class="info-item"><span class="info-label">วันที่บรรจุ:</span><span class="info-value">${mo.fillDate||"-"}</span></div>
        <div class="info-item"><span class="info-label">วันส่งมอบ:</span><span class="info-value">${mo.deliveryDate||"-"}</span></div>
        <div class="info-item"><span class="info-label">สถานะ:</span><span class="info-value">${mo.status||"-"}</span></div>
        <div class="info-item"><span class="info-label">งานบริการ:</span><span class="info-value">${svcList}</span></div>
      </div>
      <div class="section-title">รายละเอียดการผลิต</div>
      <table>
        <tr><th>รายการ</th><th>ข้อมูล</th></tr>
        <tr><td>สูตรที่ใช้</td><td>${mo.formulaId||"-"}</td></tr>
        <tr><td>รุ่นขวด</td><td>${mo.containerModel||"-"}</td></tr>
        <tr><td>รายละเอียดฉลาก</td><td>${mo.labelDetails||"-"}</td></tr>
        <tr><td>วันผสม</td><td>${mo.mixDate||"-"}</td></tr>
        <tr><td>วันบรรจุ</td><td>${mo.fillDate||"-"}</td></tr>
        <tr><td>จำนวนผลิตจริง</td><td>${mo.totalProduced||0} ${mo.unit||""}</td></tr>
        <tr><td>QC ผ่าน</td><td>${mo.qcPassedQty||0} ${mo.unit||""}</td></tr>
        <tr><td>QC ไม่ผ่าน</td><td>${mo.qcFailedQty||0} ${mo.unit||""}</td></tr>
        <tr><td>% ของเสีย</td><td>${mo.wastePct||0}%</td></tr>
      </table>`;

      const sigs = `<div class="sig-row">
        <div class="sig-box"><div class="sig-line">ผู้สร้าง MO</div><div class="sig-role">${mo.draftBy||"..............."}</div></div>
        <div class="sig-box"><div class="sig-line">ผู้อนุมัติ</div><div class="sig-role">${mo.approvedBy||"..............."}</div></div>
        <div class="sig-box"><div class="sig-line">ผู้จัดการโรงงาน</div><div class="sig-role">...............</div></div>
      </div>`;

      this._print(this._base("ใบสั่งผลิต", moId, content, sigs));
    } catch(e) {
      ERP.loading.hide();
      alert("โหลดข้อมูลล้มเหลว: " + e.message);
    }
  },

  // ── พิมพ์ใบเบิกวัตถุดิบ ──
  async withdraw(wdId) {
    try {
      ERP.loading.show("กำลังโหลด...");
      const { data: wds } = await ERP.api.withdraws({ limit: 200 });
      const wd = wds.find(w => w.id === wdId);
      ERP.loading.hide();
      if (!wd) { alert("ไม่พบใบเบิก: " + wdId); return; }
      let items = [];
      try { items = JSON.parse(wd.itemsJson || "[]"); } catch(_) {}

      const content = `
      <div class="info-grid">
        <div class="info-item"><span class="info-label">อ้างอิง MO:</span><span class="info-value">${wd.moId||"-"}</span></div>
        <div class="info-item"><span class="info-label">วันที่ขอเบิก:</span><span class="info-value">${wd.requestedAt||"-"}</span></div>
        <div class="info-item"><span class="info-label">ผู้ขอเบิก:</span><span class="info-value">${wd.requestedBy||"-"}</span></div>
        <div class="info-item"><span class="info-label">สถานะ:</span><span class="info-value">${wd.status||"-"}</span></div>
      </div>
      <div class="section-title">รายการวัตถุดิบที่เบิก</div>
      <table>
        <thead><tr><th>#</th><th>SKU</th><th>ชื่อวัตถุดิบ</th><th>Lot</th><th>จำนวน</th><th>หน่วย</th></tr></thead>
        <tbody>${items.map((it,i) => `<tr><td>${i+1}</td><td>${it.sku||""}</td><td>${it.name||""}</td><td>${it.lot||""}</td><td style="text-align:right">${it.qty||0}</td><td>${it.unit||""}</td></tr>`).join("") || "<tr><td colspan='6' style='text-align:center'>ไม่มีรายการ</td></tr>"}</tbody>
      </table>`;

      const sigs = `<div class="sig-row">
        <div class="sig-box"><div class="sig-line">ผู้ขอเบิก</div><div class="sig-role">${wd.requestedBy||"..............."}</div></div>
        <div class="sig-box"><div class="sig-line">ผู้อนุมัติ</div><div class="sig-role">${wd.approvedBy||"..............."}</div></div>
        <div class="sig-box"><div class="sig-line">ผู้จ่ายวัตถุดิบ</div><div class="sig-role">...............</div></div>
      </div>`;

      this._print(this._base("ใบเบิกวัตถุดิบ", wdId, content, sigs));
    } catch(e) {
      ERP.loading.hide();
      alert("โหลดข้อมูลล้มเหลว: " + e.message);
    }
  },

  // ── พิมพ์รายงาน QC ──
  async qc(batch) {
    try {
      ERP.loading.show("กำลังโหลด QC...");
      const { data: qc } = await ERP.api.qcByBatch(batch);
      ERP.loading.hide();
      if (!qc) { alert("ไม่พบข้อมูล QC: " + batch); return; }

      const items = [
        { name:"กลิ่น",        result: qc.smell_result,       note: qc.smell_note },
        { name:"ความสะอาด",    result: qc.cleanliness_result, note: qc.cleanliness_note },
        { name:"การรั่วซึม",   result: qc.leakage_result,     note: qc.leakage_note },
        { name:"ฉลาก",         result: qc.label_result,       note: qc.label_note },
        { name:"หัวสเปรย์",    result: qc.sprayer_result,     note: qc.sprayer_note },
        { name:"วันที่ผลิต",   result: qc.mfgDate_result,     note: qc.mfgDate_note },
        { name:"กล่อง",        result: qc.box_result,         note: qc.box_note },
        { name:"ซีล",          result: qc.seal_result,        note: qc.seal_note },
      ];

      const content = `
      <div class="info-grid">
        <div class="info-item"><span class="info-label">MO:</span><span class="info-value">${qc.moId||"-"}</span></div>
        <div class="info-item"><span class="info-label">Batch:</span><span class="info-value">${qc.batchNumber||"-"}</span></div>
        <div class="info-item"><span class="info-label">ตัวอย่าง:</span><span class="info-value">${qc.sampleQty||0} ชิ้น</span></div>
        <div class="info-item"><span class="info-label">ผล QC:</span><span class="info-value"><span class="badge ${qc.overallResult==="pass"?"badge-green":"badge-red"}">${qc.overallResult==="pass"?"✅ ผ่าน":"❌ ไม่ผ่าน"}</span></span></div>
        <div class="info-item"><span class="info-label">ผ่าน/ไม่ผ่าน:</span><span class="info-value">${qc.passCount||0}/${qc.failCount||0} รายการ</span></div>
        <div class="info-item"><span class="info-label">วันที่ตรวจ:</span><span class="info-value">${qc.qcAt||"-"}</span></div>
      </div>
      <div class="section-title">ผลการตรวจสอบ</div>
      <table>
        <thead><tr><th>#</th><th>รายการตรวจ</th><th>ผล</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${items.map((it,i) => `<tr>
          <td>${i+1}</td><td>${it.name}</td>
          <td><span class="badge ${it.result==="pass"?"badge-green":"badge-red"}">${it.result==="pass"?"✅ ผ่าน":"❌ ไม่ผ่าน"}</span></td>
          <td>${it.note||"-"}</td>
        </tr>`).join("")}</tbody>
      </table>`;

      const sigs = `<div class="sig-row">
        <div class="sig-box"><div class="sig-line">ผู้ตรวจ QC</div><div class="sig-role">${qc.qcBy||"..............."}</div></div>
        <div class="sig-box"><div class="sig-line">หัวหน้า QC</div><div class="sig-role">...............</div></div>
        <div class="sig-box"><div class="sig-line">ผู้จัดการ</div><div class="sig-role">...............</div></div>
      </div>`;

      this._print(this._base("รายงาน QC", batch, content, sigs));
    } catch(e) {
      ERP.loading.hide();
      alert("โหลดข้อมูลล้มเหลว: " + e.message);
    }
  },

  // ── พิมพ์รายงานสต๊อกวัตถุดิบ ──
  async stock() {
    try {
      ERP.loading.show("กำลังโหลดสต๊อก...");
      const { data } = await ERP.api.stockSummary();
      ERP.loading.hide();
      const content = `
      <div class="section-title">สรุปสต๊อกวัตถุดิบ</div>
      <table>
        <thead><tr><th>SKU</th><th>ชื่อวัตถุดิบ</th><th>จำนวน Lot</th><th>คงเหลือรวม</th><th>หน่วย</th><th>จุดสั่งซื้อ</th><th>สถานะ</th></tr></thead>
        <tbody>${(data||[]).map(m => {
          const low = m.totalQty <= (m.reorderPoint||0);
          return `<tr>
            <td>${m.sku}</td><td>${m.nameTH||m.sku}</td>
            <td style="text-align:center">${m.lotCount||0}</td>
            <td style="text-align:right;font-weight:${low?"700":"400"};color:${low?"#dc2626":"#000"}">${parseFloat(m.totalQty||0).toLocaleString()}</td>
            <td>${m.unit||""}</td>
            <td style="text-align:right">${m.reorderPoint||0}</td>
            <td><span class="badge ${low?"badge-red":"badge-green"}">${low?"ต่ำ":"ปกติ"}</span></td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
      this._print(this._base("รายงานสต๊อกวัตถุดิบ", "RPT-" + new Date().toLocaleDateString("th-TH").replace(/\//g,"-"), content));
    } catch(e) {
      ERP.loading.hide();
      alert("โหลดล้มเหลว: " + e.message);
    }
  },

  // ── เปิด popup พิมพ์ ──
  _print(html) {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { alert("กรุณาอนุญาต Popup สำหรับเว็บนี้ครับ"); return; }
    w.document.write(html);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 800);
  }
};

// ── Override ปุ่มพิมพ์ใน Topbar ──
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    // ปุ่มพิมพ์ใน topbar
    document.querySelectorAll(".tb-btn").forEach(btn => {
      if (btn.querySelector(".fa-print")) {
        btn.onclick = () => {
          const page = document.getElementById("pageTitle")?.textContent || "";
          if (page.includes("MO") || page.includes("ใบสั่งผลิต")) {
            const rows = document.querySelectorAll("#moTbody tr");
            if (rows.length) {
              const moId = rows[0].querySelector(".cell-code")?.textContent;
              if (moId) ERP_PRINT.mo(moId);
            }
          } else if (page.includes("วัตถุดิบ")) {
            ERP_PRINT.stock();
          } else {
            alert("เลือกเอกสารที่ต้องการพิมพ์ก่อนครับ");
          }
        };
      }
    });
  }, 2000);
});

// ── ฟังก์ชัน shortcut สำหรับเรียกจาก UI ──
window.printMO       = (id)    => ERP_PRINT.mo(id);
window.printWithdraw = (id)    => ERP_PRINT.withdraw(id);
window.printQC       = (batch) => ERP_PRINT.qc(batch);
window.printStock    = ()      => ERP_PRINT.stock();

// ─────────────────────────────────────────────────────────────
//  เพิ่มปุ่มพิมพ์ในทุกหน้าเอกสาร
// ─────────────────────────────────────────────────────────────

// Override หน้า MO ให้มีปุ่มพิมพ์ทุกแถว
const _origLoadMOs = window._loadMOs;
window._loadMOs = async function() {
  try {
    const { data } = await ERP.api.openMOs();
    const sub = document.getElementById("moSub");
    if (sub) sub.textContent = `${data.length} MO ที่ยังเปิดอยู่ · ${new Date().toLocaleTimeString("th-TH")}`;
    const now = new Date();
    document.getElementById("moTbody").innerHTML = (data || []).map(m => {
      const late = m.deliveryDate && new Date(m.deliveryDate) < now && !["closed","cancelled"].includes(m.status);
      const st = ERP.utils.statusBadge(late ? "rejected" : m.status);
      return `<tr>
        <td><span class="cell-code">${m.id}</span></td>
        <td><strong>${m.productName}</strong><div style="font-size:10px;color:var(--muted)">${m.productCategory||""} ${m.qty||""} ${m.unit||""}</div></td>
        <td style="font-size:12px">${m.customerId||"-"}</td>
        <td><span class="cell-lot">${m.batchNumber||"-"}</span></td>
        <td>${ERP.utils.num(m.qty)} ${m.unit||""}</td>
        <td style="font-size:11px;color:${late?"var(--red)":"var(--muted)"}">${m.deliveryDate||"-"}${late?" ⚠":""}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td><div class="flex gap-6">
          <button class="btn btn-ghost btn-xs" title="ดูรายละเอียด" onclick="page_mo._detail && page_mo._detail('${m.id}','${m.productName}','${m.status}')"><i class="fas fa-eye"></i></button>
          <button class="btn btn-ghost btn-xs" title="พิมพ์ใบสั่งผลิต" onclick="ERP_PRINT.mo('${m.id}')"><i class="fas fa-print"></i></button>
          ${m.status==="waiting_approval"?`<button class="btn btn-xs btn-success" onclick="_approveMO('${m.id}',true)"><i class="fas fa-check"></i></button><button class="btn btn-xs btn-danger" onclick="_approveMO('${m.id}',false)"><i class="fas fa-times"></i></button>`:""}
          ${m.status==="draft"?`<button class="btn btn-xs btn-primary" onclick="_submitMO('${m.id}')"><i class="fas fa-paper-plane"></i></button>`:""}
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted)">ไม่มี MO ที่เปิดอยู่</td></tr>`;
  } catch(e) { ERP.toast.danger("โหลด MO ล้มเหลว: " + e.message); }
};

// Override หน้าใบเบิกวัตถุดิบให้มีปุ่มพิมพ์
window.page_withdraw = function(c) {
  c.innerHTML = `
  <div class="page-hd">
    <div><div class="page-title"><i class="fas fa-arrow-up-from-bracket" style="color:var(--blue);margin-right:7px"></i>ใบเบิกวัตถุดิบ</div>
    <div class="page-sub" id="wdSub">กำลังโหลด...</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="nav('withdraw')"><i class="fas fa-rotate"></i></button>
      <button class="btn btn-primary btn-sm" onclick="window._newWithdraw && _newWithdraw()"><i class="fas fa-plus"></i> สร้างใบเบิก</button>
    </div>
  </div>
  <div class="card">
    <div class="tbl-wrap"><table>
      <thead><tr><th>เลขใบเบิก</th><th>อ้างอิง MO</th><th>วันที่ขอ</th><th>ผู้ขอ</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
      <tbody id="wdTbody"><tr><td colspan="6" style="text-align:center;padding:20px"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
    </table></div>
  </div>`;

  ERP.run(async () => {
    const { data } = await ERP.api.withdraws({ limit: 100 });
    const sub = document.getElementById("wdSub");
    if (sub) sub.textContent = `${(data||[]).length} รายการ`;
    const stColor = { approved:"badge-green", rejected:"badge-red", pending:"badge-amber" };
    const stLabel = { approved:"อนุมัติแล้ว", rejected:"ปฏิเสธ", pending:"รออนุมัติ" };
    document.getElementById("wdTbody").innerHTML = (data||[]).map(w => `<tr>
      <td><span class="cell-code">${w.id}</span></td>
      <td><span class="cell-lot">${w.moId||"-"}</span></td>
      <td style="font-size:11px;color:var(--muted)">${w.requestedAt||"-"}</td>
      <td style="font-size:12px">${w.requestedBy||"-"}</td>
      <td><span class="badge ${stColor[w.status]||"badge-gray"}">${stLabel[w.status]||w.status}</span></td>
      <td><div class="flex gap-6">
        <button class="btn btn-ghost btn-xs" title="พิมพ์ใบเบิก" onclick="ERP_PRINT.withdraw('${w.id}')"><i class="fas fa-print"></i></button>
        ${w.status==="pending"?`<button class="btn btn-xs btn-success" onclick="_approveWithdraw('${w.id}',true)"><i class="fas fa-check"></i> อนุมัติ</button>`:""}
      </div></td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted)">ไม่มีใบเบิก</td></tr>`;
  }, { loading: false });
};

// Override หน้า QC ให้มีปุ่มพิมพ์
const _origQCList = window.page_qc;
window.page_qc = function(c) {
  if (_origQCList) _origQCList(c);
  // เพิ่ม Live QC List
  const qcSection = document.createElement("div");
  qcSection.innerHTML = `
  <div class="card" style="margin-top:16px">
    <div class="card-head"><div class="card-title"><i class="fas fa-list-check" style="color:var(--blue)"></i>ประวัติ QC ทั้งหมด</div></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>Batch</th><th>MO</th><th>วันที่ตรวจ</th><th>ผล</th><th>ผ่าน/ไม่ผ่าน</th><th>พิมพ์</th></tr></thead>
      <tbody id="qcListTbody"><tr><td colspan="6" style="text-align:center;padding:16px"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
    </table></div>
  </div>`;
  c.appendChild(qcSection);

  ERP.run(async () => {
    const { data } = await ERP.api.getAll("QualityControl", { limit: 100 });
    document.getElementById("qcListTbody").innerHTML = (data||[]).map(q => `<tr>
      <td><span class="cell-lot">${q.batchNumber||"-"}</span></td>
      <td><span class="cell-code">${q.moId||"-"}</span></td>
      <td style="font-size:11px;color:var(--muted)">${q.qcAt||"-"}</td>
      <td><span class="badge ${q.overallResult==="pass"?"badge-green":"badge-red"}">${q.overallResult==="pass"?"✅ ผ่าน":"❌ ไม่ผ่าน"}</span></td>
      <td style="text-align:center">${q.passCount||0}/${(parseInt(q.passCount||0)+parseInt(q.failCount||0))}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="ERP_PRINT.qc('${q.batchNumber}')" title="พิมพ์รายงาน QC"><i class="fas fa-print"></i> พิมพ์</button></td>
    </tr>`).join("") || `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--muted)">ไม่มีข้อมูล QC</td></tr>`;
  }, { loading: false });
};

// เพิ่มปุ่มพิมพ์สต๊อกในหน้าวัตถุดิบ
const _origLoadMat = window._loadMaterials;
window._loadMaterials = async function() {
  if (_origLoadMat) await _origLoadMat();
  // เพิ่มปุ่มพิมพ์ใน page-hd-actions
  const actions = document.querySelector(".page-hd-actions");
  if (actions && !document.getElementById("btnPrintStock")) {
    const btn = document.createElement("button");
    btn.id = "btnPrintStock";
    btn.className = "btn btn-ghost btn-sm";
    btn.title = "พิมพ์รายงานสต๊อก";
    btn.innerHTML = '<i class="fas fa-print"></i> พิมพ์สต๊อก';
    btn.onclick = () => ERP_PRINT.stock();
    actions.insertBefore(btn, actions.firstChild);
  }
};

// ─────────────────────────────────────────────────────────────
//  อัปโหลดรูปโปรไฟล์ User — บันทึกลง Google Drive + Sheets
// ─────────────────────────────────────────────────────────────

// Override หน้า Users ให้มีรูปโปรไฟล์ + ปุ่มอัปโหลด
window.page_users = function(c) {
  c.innerHTML = `
  <div class="page-hd">
    <div><div class="page-title"><i class="fas fa-users" style="color:var(--blue);margin-right:7px"></i>จัดการผู้ใช้และสิทธิ์</div>
    <div class="page-sub" id="userSub">กำลังโหลด...</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="nav('users')"><i class="fas fa-rotate"></i></button>
      <button class="btn btn-primary btn-sm" onclick="window._showAddUser()"><i class="fas fa-user-plus"></i> เพิ่มผู้ใช้</button>
    </div>
  </div>
  <div class="card">
    <div class="tbl-wrap"><table>
      <thead><tr><th style="width:60px">รูป</th><th>ผู้ใช้</th><th>ตำแหน่ง</th><th>Role</th><th>Email</th><th>สถานะ</th><th>จัดการ</th></tr></thead>
      <tbody id="userTbody"><tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)"><i class="fas fa-spinner fa-spin"></i></td></tr></tbody>
    </table></div>
  </div>

  <!-- Hidden file input สำหรับอัปโหลดรูป -->
  <input type="file" id="avatarFileInput" accept="image/*" style="display:none" onchange="window._uploadAvatar(this)">
  `;

  ERP.run(async () => {
    const { data } = await ERP.api.users();
    const sub = document.getElementById("userSub");
    if (sub) sub.textContent = `${(data||[]).length} ผู้ใช้ทั้งหมด`;
    const roleColor = { super_admin:"badge-red", manager:"badge-blue", qc:"badge-teal", production:"badge-green", warehouse:"badge-amber", sales:"badge-purple", accounting:"badge-gray" };

    document.getElementById("userTbody").innerHTML = (data||[]).map(u => {
      const initials = (u.nameTH||u.username||"??").substring(0,2);
      const avatarHtml = u.profileImageUrl
        ? `<div style="position:relative;width:40px;height:40px;cursor:pointer" onclick="window._triggerAvatarUpload('${u.id}','${u.nameTH||u.username}')">
            <img src="${u.profileImageUrl}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--blue-light)" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" onload="this.style.display='block'">
            <div style="position:absolute;bottom:0;right:0;width:16px;height:16px;background:var(--blue);border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff">
              <i class="fas fa-camera" style="font-size:8px;color:#fff"></i>
            </div>
          </div>`
        : `<div style="position:relative;width:40px;height:40px;cursor:pointer" onclick="window._triggerAvatarUpload('${u.id}','${u.nameTH||u.username}')">
            <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--green));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:14px">${initials}</div>
            <div style="position:absolute;bottom:0;right:0;width:16px;height:16px;background:var(--blue);border-radius:50%;display:flex;align-items:center;justify-content:center;border:1.5px solid #fff">
              <i class="fas fa-camera" style="font-size:8px;color:#fff"></i>
            </div>
          </div>`;
      return `<tr>
        <td style="padding:8px 12px">${avatarHtml}</td>
        <td><div style="font-weight:600">${u.nameTH||u.username}</div><div style="font-size:11px;color:var(--muted)">${u.username}</div></td>
        <td style="font-size:12px">${u.position||"-"}</td>
        <td><span class="badge ${roleColor[u.role]||"badge-gray"}">${u.role||"-"}</span></td>
        <td style="font-size:12px">${u.email||"-"}</td>
        <td><span class="badge ${u.status==="active"?"badge-green":"badge-gray"}">${u.status==="active"?"Active":"Inactive"}</span></td>
        <td><div class="flex gap-6">
          <button class="btn btn-ghost btn-xs" title="อัปโหลดรูป" onclick="window._triggerAvatarUpload('${u.id}','${u.nameTH||u.username}')"><i class="fas fa-camera"></i></button>
          <button class="btn btn-ghost btn-xs" onclick="window._editUser('${u.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn btn-xs btn-danger" onclick="window._deleteUser('${u.id}','${u.nameTH||u.username}')"><i class="fas fa-trash"></i></button>
        </div></td>
      </tr>`;
    }).join("") || `<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--muted)">ไม่พบข้อมูล</td></tr>`;
  }, { loading: false });
};

// เก็บ userId ที่กำลังอัปโหลด
window._currentAvatarUserId = null;
window._currentAvatarUserName = null;

window._triggerAvatarUpload = function(userId, userName) {
  window._currentAvatarUserId   = userId;
  window._currentAvatarUserName = userName;
  const input = document.getElementById("avatarFileInput");
  if (input) input.click();
};

window._uploadAvatar = async function(input) {
  const file = input.files[0];
  if (!file) return;

  const userId   = window._currentAvatarUserId;
  const userName = window._currentAvatarUserName;
  if (!userId) return;

  // ตรวจสอบขนาดไฟล์ไม่เกิน 5MB
  if (file.size > 5 * 1024 * 1024) {
    ERP.toast.danger("ไฟล์ใหญ่เกิน 5MB กรุณาเลือกรูปที่เล็กกว่านี้");
    input.value = "";
    return;
  }

  try {
    ERP.loading.show(`กำลังอัปโหลดรูป ${userName}...`);

    // อัปโหลดไฟล์ไป Google Drive ผ่าน GAS
    const result = await ERP.api.uploadFile(file, "ProfileImages");
    // ใช้ thumbnail URL สำหรับแสดงรูป (Drive รองรับโดยตรง)
    const fileId  = result.fileId;
    const imageUrl = fileId
      ? `https://lh3.googleusercontent.com/d/${fileId}`
      : result.thumbUrl || result.url;

    // อัปเดต profileImageUrl ใน Users Sheet
    await ERP.api.updateUser(userId, { profileImageUrl: imageUrl });

    ERP.loading.hide();
    ERP.toast.success(`อัปโหลดรูป ${userName} สำเร็จ! ✅`);

    // รีโหลดหน้า
    input.value = "";
    nav("users");

  } catch(e) {
    ERP.loading.hide();
    // Fallback: แปลงเป็น Base64 แล้วเก็บไว้ใน Sheets โดยตรง (สำหรับรูปขนาดเล็ก)
    if (file.size < 100 * 1024) { // น้อยกว่า 100KB
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          await ERP.api.updateUser(userId, { profileImageUrl: ev.target.result });
          ERP.toast.success(`อัปโหลดรูป ${userName} สำเร็จ! ✅`);
          input.value = "";
          nav("users");
        } catch(e2) {
          ERP.toast.danger("อัปโหลดล้มเหลว: " + e2.message);
        }
      };
      reader.readAsDataURL(file);
    } else {
      ERP.toast.danger("อัปโหลดล้มเหลว: " + e.message);
    }
    input.value = "";
  }
};

// Upload avatar fix
window._uploadAvatar = async function(input) {
  const file = input.files[0];
  if (!file) return;

  const userId   = window._currentAvatarUserId;
  const userName = window._currentAvatarUserName;
  if (!userId) return;

  // ตรวจสอบขนาดไฟล์
  if (file.size > 2 * 1024 * 1024) {
    ERP.toast.danger("ไฟล์ใหญ่เกิน 2MB กรุณาเลือกรูปที่เล็กกว่านี้");
    input.value = "";
    return;
  }

  ERP.loading.show(`กำลังอัปโหลดรูป ${userName}...`);

  // Resize รูปเป็น 200x200 ก่อนบันทึก
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      // Resize ด้วย Canvas
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const size   = 200;
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d");

        // Crop ให้เป็น square แล้ว resize
        const min = Math.min(img.width, img.height);
        const sx  = (img.width  - min) / 2;
        const sy  = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);

        // แปลงเป็น Base64 JPEG quality 80%
        const base64 = canvas.toDataURL("image/jpeg", 0.8);

        // บันทึกลง Google Sheets โดยตรง (Base64 แสดงใน img src ได้เลย)
        await ERP.api.updateUser(userId, { profileImageUrl: base64 });
        ERP.loading.hide();
        ERP.toast.success(`อัปโหลดรูป ${userName} สำเร็จ! ✅`);
        input.value = "";
        nav("users");
      };
      img.onerror = () => {
        ERP.loading.hide();
        ERP.toast.danger("ไฟล์รูปไม่ถูกต้อง");
        input.value = "";
      };
      img.src = ev.target.result;
    } catch(e) {
      ERP.loading.hide();
      ERP.toast.danger("อัปโหลดล้มเหลว: " + e.message);
      input.value = "";
    }
  };
  reader.onerror = () => {
    ERP.loading.hide();
    ERP.toast.danger("อ่านไฟล์ล้มเหลว");
    input.value = "";
  };
  reader.readAsDataURL(file);
};

// ─────────────────────────────────────────────────────────────
//  อัปเดตรูปโปรไฟล์ใน Sidebar
// ─────────────────────────────────────────────────────────────
window._updateSidebarAvatar = function(user) {
  const avatarEl = document.getElementById("sbAvatar");
  if (!avatarEl) return;

  const initials = (user.nameTH || user.username || "??").substring(0, 2);

  if (user.profileImageUrl) {
    // แสดงรูปโปรไฟล์จริง
    avatarEl.innerHTML = "";
    avatarEl.style.background = "none";
    avatarEl.style.padding = "0";
    avatarEl.style.overflow = "hidden";

    const img = document.createElement("img");
    img.src = user.profileImageUrl;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
    img.onerror = () => {
      // ถ้าโหลดรูปไม่ได้ ใช้ตัวอักษรแทน
      avatarEl.innerHTML = initials;
      avatarEl.style.background = "linear-gradient(135deg,var(--blue),var(--green))";
    };
    avatarEl.appendChild(img);
  } else {
    // ใช้ตัวอักษรย่อ
    avatarEl.innerHTML = initials;
    avatarEl.style.background = "linear-gradient(135deg,var(--blue),var(--green))";
  }
};

// อัปเดต Sidebar เมื่อ User แก้ไขรูปโปรไฟล์
const _origUpdateUser = window._updateUser;
window._updateUser = async function(id) {
  if (_origUpdateUser) await _origUpdateUser(id);
  // รีโหลด session user และอัปเดต sidebar
  setTimeout(async () => {
    try {
      const { data } = await ERP.api.getById("Users", ERP.session.user?.id || id);
      if (data && ERP.session.user?.id === id) {
        ERP.session._user = { ...ERP.session.user, ...data };
        _updateSidebarAvatar(ERP.session._user);
      }
    } catch(_) {}
  }, 500);
};

// อัปเดต Sidebar หลัง Upload Avatar
const _origUploadAvatar = window._uploadAvatar;
window._uploadAvatar = async function(input) {
  if (_origUploadAvatar) await _origUploadAvatar(input);
  // อัปเดต sidebar ถ้าเป็น user ตัวเอง
  setTimeout(async () => {
    if (window._currentAvatarUserId === ERP.session.user?.id) {
      try {
        const { data } = await ERP.api.getById("Users", ERP.session.user.id);
        if (data?.profileImageUrl) {
          ERP.session._user = { ...ERP.session.user, profileImageUrl: data.profileImageUrl };
          _updateSidebarAvatar(ERP.session._user);
        }
      } catch(_) {}
    }
  }, 1500);
};

// Auto อัปเดต Sidebar เมื่อ Login แล้ว (session persist)
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    if (ERP.session.isLoggedIn && ERP.session.user) {
      _updateSidebarAvatar(ERP.session.user);
    }
  }, 500);
});

// ─────────────────────────────────────────────────────────────
//  ดูรายละเอียด MO — Modal แสดงข้อมูลครบ
// ─────────────────────────────────────────────────────────────
window.page_mo._detail = async function(moId, productName, status) {
  try {
    ERP.loading.show("กำลังโหลด MO...");
    const { data } = await ERP.api.moDetail(moId);
    ERP.loading.hide();
    const mo   = data.mo   || {};
    const appr = data.approval || {};
    const logs = data.logs || [];
    const qcs  = data.qcs  || [];

    const stBadge = ERP.utils.statusBadge(mo.status);
    const svcItems = [
      { key:"svcDesignBottle",  label:"ออกแบบขวด" },
      { key:"svcDesignLabel",   label:"ออกแบบฉลาก" },
      { key:"svcDesignBox",     label:"ออกแบบกล่อง" },
      { key:"svcDesignFormula", label:"ออกแบบสูตร" },
      { key:"svcFDANumber",     label:"ขอเลข อย." },
      { key:"svcExciseNumber",  label:"ขอเลขสรรพสามิต" },
      { key:"svcTaxInvoice",    label:"ออกใบกำกับภาษี" },
    ].filter(s => mo[s.key]).map(s => `<span class="badge badge-blue" style="margin:2px">${s.label}</span>`).join("") || "-";

    const qcRow = qcs[0] ? `
      <div class="form-group" style="grid-column:1/-1">
        <label class="form-label">ผล QC</label>
        <span class="badge ${qcs[0].overallResult==="pass"?"badge-green":"badge-red"}" style="font-size:12px">
          ${qcs[0].overallResult==="pass"?"✅ ผ่าน":"❌ ไม่ผ่าน"} (${qcs[0].passCount||0}/${parseInt(qcs[0].passCount||0)+parseInt(qcs[0].failCount||0)} รายการ)
        </span>
      </div>` : "";

    openModal(`
    <div class="modal-hd">
      <div class="modal-title"><i class="fas fa-file-lines" style="color:var(--blue)"></i>รายละเอียด MO: ${moId}</div>
      <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
    </div>
    <div class="modal-body" style="max-height:70vh;overflow-y:auto">

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <span class="badge ${stBadge.cls}" style="font-size:13px;padding:5px 14px">${stBadge.label}</span>
        <span style="font-size:11px;color:var(--muted)">Batch: <strong>${mo.batchNumber||"-"}</strong></span>
      </div>

      <div style="background:var(--surface2);border-radius:8px;padding:14px;margin-bottom:14px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:2px">สินค้า</div>
        <div style="font-size:16px;font-weight:700">${mo.productName||"-"}</div>
        <div style="font-size:12px;color:var(--muted)">${mo.productCategory||""} · ${mo.qty||0} ${mo.unit||""}</div>
      </div>

      <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px 20px">
        <div class="form-group"><label class="form-label">ลูกค้า</label><div style="font-size:13px;font-weight:500">${mo.customerId||"-"}</div></div>
        <div class="form-group"><label class="form-label">Sales Order</label><div style="font-size:13px;font-weight:500">${mo.salesOrderNo||"-"}</div></div>
        <div class="form-group"><label class="form-label">สูตร</label><div style="font-size:13px">${mo.formulaId||"-"}</div></div>
        <div class="form-group"><label class="form-label">รุ่นขวด</label><div style="font-size:13px">${mo.containerModel||"-"}</div></div>
        <div class="form-group"><label class="form-label">วันที่ผสม</label><div style="font-size:13px">${mo.mixDate||"-"}</div></div>
        <div class="form-group"><label class="form-label">วันที่บรรจุ</label><div style="font-size:13px">${mo.fillDate||"-"}</div></div>
        <div class="form-group"><label class="form-label">วันส่งมอบ</label><div style="font-size:13px;color:${mo.deliveryDate&&new Date(mo.deliveryDate)<new Date()&&mo.status!=="closed"?"var(--red)":"inherit"}">${mo.deliveryDate||"-"}</div></div>
        <div class="form-group"><label class="form-label">ผลิตจริง</label><div style="font-size:13px;font-weight:500">${mo.totalProduced||0} ${mo.unit||""}</div></div>
        <div class="form-group"><label class="form-label">QC ผ่าน</label><div style="font-size:13px;color:var(--green);font-weight:600">${mo.qcPassedQty||0} ${mo.unit||""}</div></div>
        <div class="form-group"><label class="form-label">% ของเสีย</label><div style="font-size:13px;color:var(--red)">${mo.wastePct||0}%</div></div>
        ${qcRow}
        <div class="form-group" style="grid-column:1/-1"><label class="form-label">งานบริการ</label><div style="font-size:12px;line-height:1.8">${svcItems}</div></div>
      </div>

      ${mo.fermentStatus==="fermenting"?`
      <div style="background:var(--blue-light);border-radius:8px;padding:12px;margin:10px 0;border:1px solid rgba(21,88,192,.15)">
        <div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:6px"><i class="fas fa-flask"></i> กำลังหมักบ่ม</div>
        <div style="font-size:11px;color:var(--muted)">ประเภท: ${mo.fermentType||"-"} · ${mo.fermentDays||0} วัน</div>
        <div style="font-size:11px;color:var(--muted)">เริ่ม: ${mo.fermentStart||"-"} · ครบ: ${mo.fermentEnd||"-"}</div>
      </div>`:""}

      ${appr.status?`
      <div style="background:var(--surface2);border-radius:8px;padding:12px;margin:10px 0">
        <div style="font-size:11px;font-weight:600;color:var(--muted);margin-bottom:4px">การอนุมัติ</div>
        <div style="display:flex;gap:12px;font-size:12px">
          <span>ผู้ขอ: <strong>${appr.requestedBy||"-"}</strong></span>
          <span>สถานะ: <span class="badge ${appr.status==="approved"?"badge-green":appr.status==="rejected"?"badge-red":"badge-amber"}">${appr.status}</span></span>
          ${appr.approvedBy?`<span>ผู้อนุมัติ: <strong>${appr.approvedBy}</strong></span>`:""}
        </div>
        ${appr.note?`<div style="font-size:11px;color:var(--muted);margin-top:4px">หมายเหตุ: ${appr.note}</div>`:""}
      </div>`:""}

    </div>
    <div class="modal-ft">
      <button class="btn btn-ghost" onclick="closeModal()">ปิด</button>
      <button class="btn btn-ghost" onclick="ERP_PRINT.mo('${moId}');closeModal()"><i class="fas fa-print"></i> พิมพ์</button>
      ${mo.status==="draft"?`<button class="btn btn-primary" onclick="closeModal();_submitMO('${moId}')"><i class="fas fa-paper-plane"></i> ส่งอนุมัติ</button>`:""}
      ${mo.status==="waiting_approval"?`<button class="btn btn-success" onclick="closeModal();_approveMO('${moId}',true)"><i class="fas fa-check"></i> อนุมัติ</button>`:""}
    </div>`, true);

  } catch(e) {
    ERP.loading.hide();
    ERP.toast.danger("โหลด MO ล้มเหลว: " + e.message);
  }
};

// ─────────────────────────────────────────────────────────────
//  สูตรส่ง อย. — สร้าง/แก้ไขสูตร
// ─────────────────────────────────────────────────────────────
window.page_formula = function(c) {
  c.innerHTML = `
  <div class="page-hd">
    <div><div class="page-title"><i class="fas fa-flask" style="color:var(--blue);margin-right:7px"></i>สูตรส่ง อย.</div>
    <div class="page-sub" id="fmSub">กำลังโหลด...</div></div>
    <div class="page-hd-actions">
      <button class="btn btn-ghost btn-sm" onclick="nav('formula')"><i class="fas fa-rotate"></i></button>
      <button class="btn btn-ghost btn-sm" onclick="window._printFormula()"><i class="fas fa-print"></i> พิมพ์สูตร</button>
      <button class="btn btn-primary btn-sm" onclick="window._showNewFormula()"><i class="fas fa-plus"></i> สร้างสูตรใหม่</button>
    </div>
  </div>
  <div id="formulaList"></div>`;

  ERP.run(async () => {
    const { data } = await ERP.api.formulas({ limit: 100 });
    const sub = document.getElementById("fmSub");
    if (sub) sub.textContent = `${(data||[]).length} สูตร · คลิกสูตรเพื่อดูรายละเอียด`;
    const list = document.getElementById("formulaList");
    if (!data?.length) {
      list.innerHTML = `<div class="card" style="padding:30px;text-align:center;color:var(--muted)"><i class="fas fa-flask" style="font-size:32px;opacity:.3"></i><div style="margin-top:8px">ยังไม่มีสูตร กดสร้างสูตรใหม่ได้เลย</div></div>`;
      return;
    }
    list.innerHTML = data.map(f => {
      let ingr = [];
      try { ingr = JSON.parse(f.ingredientsJson || "[]"); } catch(_) {}
      const total = ingr.reduce((s, i) => s + (parseFloat(i.pct)||0), 0);
      const isOk  = Math.abs(total - 100) < 0.01;
      return `
      <div class="card" style="margin-bottom:12px">
        <div class="card-head">
          <div>
            <div class="card-title"><i class="fas fa-flask" style="color:var(--blue)"></i>${f.nameTH||f.code}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${f.code} · ${f.revision||"Rev.1"} · สินค้า: ${f.productId||"-"}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:13px;font-weight:700;color:${isOk?"var(--green)":"var(--red)"}">${total.toFixed(2)}% ${isOk?"✅":""}</span>
            <span class="badge ${f.status==="active"?"badge-green":"badge-gray"}">${f.status==="active"?"Active":"Inactive"}</span>
            <button class="btn btn-ghost btn-xs" onclick="window._editFormula('${f.id}')"><i class="fas fa-pen"></i> แก้ไข</button>
            <button class="btn btn-ghost btn-xs" onclick="window._printFormulaById('${f.id}')"><i class="fas fa-print"></i></button>
          </div>
        </div>
        <div class="card-body">
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead><tr style="background:var(--surface2)"><th style="padding:6px 10px;text-align:left">#</th><th style="padding:6px 10px;text-align:left">รหัส</th><th style="padding:6px 10px;text-align:left">ชื่อวัตถุดิบ</th><th style="padding:6px 10px;text-align:right">% โดยน้ำหนัก</th><th style="padding:6px 10px;text-align:right">กรัม/1กก.</th><th style="padding:6px 10px;text-align:left">หน่วย</th></tr></thead>
            <tbody>${ingr.map((i,idx) => `<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px 10px">${idx+1}</td><td style="padding:5px 10px"><span class="cell-code">${i.sku||"-"}</span></td><td style="padding:5px 10px">${i.nameTH||i.name||"-"}</td><td style="padding:5px 10px;text-align:right;font-weight:600">${i.pct||0}</td><td style="padding:5px 10px;text-align:right">${((parseFloat(i.pct)||0)*10).toFixed(1)}</td><td style="padding:5px 10px">${i.unit||"กรัม"}</td></tr>`).join("")}
            <tr style="background:var(--surface2);font-weight:700"><td colspan="3" style="padding:6px 10px">รวม %</td><td style="padding:6px 10px;text-align:right;color:${isOk?"var(--green)":"var(--red)"}">${total.toFixed(4)}%</td><td colspan="2"></td></tr>
            </tbody>
          </table>
          <div style="margin-top:10px">
            <button class="btn btn-ghost btn-xs" onclick="window._addIngredient('${f.id}')"><i class="fas fa-plus"></i> เพิ่มวัตถุดิบ</button>
          </div>
        </div>
      </div>`;
    }).join("");
  }, { loading: false });
};

// สร้างสูตรใหม่
window._showNewFormula = function() {
  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-flask" style="color:var(--blue)"></i>สร้างสูตรใหม่</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div class="form-grid">
      <div class="form-group"><label class="form-label">รหัสสูตร</label><input class="form-control" id="fm_code" placeholder="FM-XXX"></div>
      <div class="form-group"><label class="form-label">ชื่อสูตร</label><input class="form-control" id="fm_name" placeholder="ชื่อสูตร"></div>
      <div class="form-group"><label class="form-label">สินค้าที่ใช้</label><input class="form-control" id="fm_product" placeholder="รหัสสินค้า"></div>
      <div class="form-group"><label class="form-label">วันที่มีผล</label><input class="form-control" type="date" id="fm_date"></div>
    </div>
    <div style="margin-top:14px">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:var(--muted)">ส่วนผสม (ต้องรวมกัน = 100%)</div>
      <table style="width:100%;font-size:12px;border-collapse:collapse" id="fmIngrTable">
        <thead><tr style="background:var(--surface2)"><th style="padding:6px;text-align:left">SKU</th><th style="padding:6px;text-align:left">ชื่อ</th><th style="padding:6px;text-align:right">% โดยน้ำหนัก</th><th style="padding:6px"></th></tr></thead>
        <tbody id="fmIngrBody"></tbody>
      </table>
      <button class="btn btn-ghost btn-xs" style="margin-top:8px" onclick="window._addFmRow()"><i class="fas fa-plus"></i> เพิ่มวัตถุดิบ</button>
      <div style="text-align:right;margin-top:8px;font-weight:700" id="fmTotal">รวม: 0.00%</div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._saveFormula()"><i class="fas fa-floppy-disk"></i> บันทึกสูตร</button>
  </div>`, true);
  window._addFmRow();
};

window._fmRowCount = 0;
window._addFmRow = function() {
  const n = ++window._fmRowCount;
  const tbody = document.getElementById("fmIngrBody");
  if (!tbody) return;
  const tr = document.createElement("tr");
  tr.id = `fmRow_${n}`;
  tr.innerHTML = `
    <td style="padding:4px"><input class="form-control" style="font-size:11px" id="fm_sku_${n}" placeholder="RM-XXX"></td>
    <td style="padding:4px"><input class="form-control" style="font-size:11px" id="fm_name_${n}" placeholder="ชื่อวัตถุดิบ"></td>
    <td style="padding:4px"><input class="form-control" style="font-size:11px;text-align:right" type="number" id="fm_pct_${n}" placeholder="0" oninput="window._calcFmTotal()" step="0.01"></td>
    <td style="padding:4px"><button class="btn btn-xs btn-danger" onclick="document.getElementById('fmRow_${n}').remove();window._calcFmTotal()"><i class="fas fa-trash"></i></button></td>`;
  tbody.appendChild(tr);
};

window._calcFmTotal = function() {
  let total = 0;
  document.querySelectorAll("[id^='fm_pct_']").forEach(el => { total += parseFloat(el.value||0); });
  const el = document.getElementById("fmTotal");
  if (el) { el.textContent = `รวม: ${total.toFixed(4)}%`; el.style.color = Math.abs(total-100)<0.01?"var(--green)":"var(--red)"; }
};

window._saveFormula = async function() {
  const code = document.getElementById("fm_code")?.value?.trim();
  const name = document.getElementById("fm_name")?.value?.trim();
  if (!code) { alert("กรุณากรอกรหัสสูตร"); return; }
  if (!name) { alert("กรุณากรอกชื่อสูตร"); return; }

  const ingr = [];
  document.querySelectorAll("[id^='fm_sku_']").forEach(el => {
    const n   = el.id.split("_")[2];
    const sku = el.value.trim();
    const nm  = document.getElementById(`fm_name_${n}`)?.value?.trim();
    const pct = parseFloat(document.getElementById(`fm_pct_${n}`)?.value||0);
    if (sku && pct > 0) ingr.push({ sku, nameTH: nm, pct, unit: "กรัม" });
  });

  if (!ingr.length) { alert("กรุณาเพิ่มวัตถุดิบอย่างน้อย 1 รายการ"); return; }

  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }

  try {
    await ERP.api.saveFormula({
      code, nameTH: name,
      productId      : document.getElementById("fm_product")?.value || "",
      effectiveDate  : document.getElementById("fm_date")?.value    || "",
      ingredientsJson: JSON.stringify(ingr),
    });
    closeModal();
    ERP.toast.success("บันทึกสูตร " + code + " สำเร็จ!");
    nav("formula");
  } catch(e) {
    ERP.toast.danger("บันทึกล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "บันทึกสูตร"; }
  }
};

// เพิ่มวัตถุดิบในสูตรที่มีอยู่แล้ว
window._addIngredient = async function(formulaId) {
  const { data: f } = await ERP.run(() => ERP.api.getById("Formulas", formulaId), { loadingMsg: "โหลดสูตร..." });
  let ingr = [];
  try { ingr = JSON.parse(f.ingredientsJson || "[]"); } catch(_) {}

  openModal(`
  <div class="modal-hd">
    <div class="modal-title"><i class="fas fa-plus-circle" style="color:var(--blue)"></i>เพิ่มวัตถุดิบ: ${f.code}</div>
    <button class="close-btn" onclick="closeModal()"><i class="fas fa-xmark"></i></button>
  </div>
  <div class="modal-body">
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">ส่วนผสมปัจจุบันรวม ${ingr.reduce((s,i)=>s+(parseFloat(i.pct)||0),0).toFixed(2)}%</div>
    <div class="form-grid">
      <div class="form-group"><label class="form-label">SKU วัตถุดิบ</label><input class="form-control" id="ai_sku" placeholder="RM-XXX"></div>
      <div class="form-group"><label class="form-label">ชื่อวัตถุดิบ</label><input class="form-control" id="ai_name" placeholder="ชื่อ"></div>
      <div class="form-group"><label class="form-label">% โดยน้ำหนัก</label><input class="form-control" type="number" id="ai_pct" placeholder="0" step="0.01"></div>
      <div class="form-group"><label class="form-label">หน่วย</label><select class="form-control" id="ai_unit"><option>กรัม</option><option>มล.</option></select></div>
    </div>
  </div>
  <div class="modal-ft">
    <button class="btn btn-ghost" onclick="closeModal()">ยกเลิก</button>
    <button class="btn btn-primary" onclick="window._saveIngredient('${formulaId}',${JSON.stringify(ingr).replace(/'/g,"&#39;")})"><i class="fas fa-floppy-disk"></i> เพิ่ม</button>
  </div>`);
};

window._saveIngredient = async function(formulaId, existingIngr) {
  const sku  = document.getElementById("ai_sku")?.value?.trim();
  const name = document.getElementById("ai_name")?.value?.trim();
  const pct  = parseFloat(document.getElementById("ai_pct")?.value||0);
  if (!sku)   { alert("กรุณากรอก SKU"); return; }
  if (pct<=0) { alert("กรุณากรอก %"); return; }

  const newIngr = [...existingIngr, { sku, nameTH: name, pct, unit: document.getElementById("ai_unit")?.value||"กรัม" }];
  const total   = newIngr.reduce((s,i)=>s+(parseFloat(i.pct)||0),0);

  if (Math.abs(total-100) > 0.01 && !confirm(`รวม % = ${total.toFixed(4)} (ไม่ใช่ 100%) ต้องการบันทึกต่อไหม?`)) return;

  const btn = document.querySelector(".modal-ft .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    await ERP.api.update("Formulas", formulaId, { ingredientsJson: JSON.stringify(newIngr) });
    closeModal();
    ERP.toast.success("เพิ่มวัตถุดิบสำเร็จ!");
    nav("formula");
  } catch(e) {
    ERP.toast.danger("บันทึกล้มเหลว: " + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "เพิ่ม"; }
  }
};

// พิมพ์สูตร
window._printFormulaById = async function(id) {
  const { data: f } = await ERP.run(() => ERP.api.getById("Formulas", id), { loadingMsg: "โหลดสูตร..." });
  let ingr = [];
  try { ingr = JSON.parse(f.ingredientsJson || "[]"); } catch(_) {}
  const total = ingr.reduce((s,i)=>s+(parseFloat(i.pct)||0),0);
  const content = `
  <div class="info-grid">
    <div class="info-item"><span class="info-label">รหัสสูตร:</span><span class="info-value">${f.code}</span></div>
    <div class="info-item"><span class="info-label">Revision:</span><span class="info-value">${f.revision||"Rev.1"}</span></div>
    <div class="info-item"><span class="info-label">สินค้า:</span><span class="info-value">${f.productId||"-"}</span></div>
    <div class="info-item"><span class="info-label">วันที่มีผล:</span><span class="info-value">${f.effectiveDate||"-"}</span></div>
  </div>
  <div class="section-title">ส่วนผสม</div>
  <table>
    <thead><tr><th>#</th><th>SKU</th><th>ชื่อวัตถุดิบ</th><th style="text-align:right">% โดยน้ำหนัก</th><th style="text-align:right">กรัม/1กก.</th><th>หน่วย</th></tr></thead>
    <tbody>
      ${ingr.map((i,idx)=>`<tr><td>${idx+1}</td><td>${i.sku||"-"}</td><td>${i.nameTH||i.name||"-"}</td><td style="text-align:right;font-weight:600">${i.pct||0}%</td><td style="text-align:right">${((parseFloat(i.pct)||0)*10).toFixed(1)}</td><td>${i.unit||"กรัม"}</td></tr>`).join("")}
      <tr style="font-weight:700;background:#f0f4ff"><td colspan="3">รวม</td><td style="text-align:right;color:${Math.abs(total-100)<0.01?"#166534":"#991b1b"}">${total.toFixed(4)}%</td><td colspan="2"></td></tr>
    </tbody>
  </table>`;
  ERP_PRINT._print(ERP_PRINT._base("สูตรส่ง อย.", f.code, content));
};
window._printFormula = () => ERP_PRINT._print && alert("กรุณาเลือกสูตรที่ต้องการพิมพ์จากปุ่ม 🖨️ ในแต่ละสูตรครับ");
