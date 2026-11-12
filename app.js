// KTM x JWP task board · LIFF front end. Data lives in Supabase (line.tasks + line.task_details);
// every call goes through the ktm-board edge function with the user's LINE ID token.
const LIFF_ID = "2012582367-bQEgRlGx";
const API = "https://uakmibblktqvpgurefrt.supabase.co/functions/v1/ktm-board";
const HANDOVER = "2027-01-15";

const S = { me: null, tasks: [], categories: [], people: [], tab: "mine", cat: "", status: "open", person: "", picked: new Set() };
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- dates (Asia/Bangkok) ---------- */
const DOW = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400e3);
function thDate(ymd) {
  if (!ymd) return "ยังไม่กำหนด";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MON[m - 1]} ${String(y + 543).slice(2)}`;
}
function thTime(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600e3);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
function dueInfo(t) {
  if (!t.due_date) return { text: "ยังไม่กำหนดวันส่ง", cls: "" };
  if (t.status !== "OPEN" && t.status !== "DRAFT") return { text: thDate(t.due_date), cls: "" };
  const n = days(today(), t.due_date);
  if (n < 0) return { text: `${thDate(t.due_date)} · เลย ${-n} วัน`, cls: "due-late", late: true };
  if (n === 0) return { text: `${thDate(t.due_date)} · ครบกำหนดวันนี้`, cls: "due-late" };
  return { text: `${thDate(t.due_date)} · เหลือ ${n} วัน`, cls: n <= 7 ? "due-soon" : "" };
}

/* ---------- API ---------- */
async function api(action, body = {}) {
  const token = liff.getIDToken();
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-id-token": token ?? "" },
    body: JSON.stringify({ action, ...body }),
  });
  if (r.status === 401) { liff.logout(); liff.login({ redirectUri: location.href }); throw new Error("login"); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- helpers ---------- */
const isAdmin = () => S.me?.role === "admin";
const canEdit = (t) => isAdmin() || (S.me?.role === "editor" && t.owners.some((o) => o.nickname === S.me.nickname));
const owners = (t) => t.owners.map((o) => o.nickname).join(", ") || "-";
const shortTitle = (t) => (t.category && t.title.startsWith(t.category + ": ") ? t.title.slice(t.category.length + 2) : t.title);
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
const catOrder = (c) => { const i = S.categories.indexOf(c); return i < 0 ? 99 : i; };
function sortTasks(list) {
  return [...list].sort((a, b) =>
    catOrder(a.category) - catOrder(b.category) ||
    (a.due_date ? 0 : 1) - (b.due_date ? 0 : 1) ||
    (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.no - b.no);
}
function statusBadge(t) {
  if (t.status === "DONE") return '<span class="badge b-green">เสร็จแล้ว</span>';
  if (t.status === "DRAFT") return '<span class="badge b-gray">ยังไม่ส่งเข้ากลุ่ม</span>';
  return "";
}

/* ---------- render ---------- */
function renderHeader() {
  const n = days(today(), HANDOVER);
  $("#countdown").innerHTML = `ส่งมอบ <b>ศ. 15 ม.ค. 2570</b> · เหลือ <b>${n}</b> วัน`;
  const me = S.me;
  $("#me").innerHTML = me ? `<span>${esc(me.nickname || me.display_name)}${isAdmin() ? " · admin" : ""}</span>` : "";
  document.querySelectorAll(".admin-only").forEach((el) => (el.hidden = !isAdmin()));
  $("#fab").hidden = !(S.me && (isAdmin() || S.me.role === "editor")) || S.tab === "users" || S.tab === "recent";
}

function taskCard(t) {
  const d = dueInfo(t);
  const pickable = isAdmin() && t.status === "DRAFT";
  const cls = ["task", t.status === "DONE" ? "done" : "", d.late ? "late" : "", pickable ? "pickable" : ""].join(" ");
  return `<button class="${cls}" data-no="${t.no}">
    <div class="t-head"><span class="t-no">#${t.no}</span><span class="t-title">${esc(shortTitle(t))}</span>
      ${t.urgent ? '<span class="badge b-red">ด่วน</span>' : ""} ${statusBadge(t)}</div>
    <div class="t-meta"><span>${esc(owners(t))}</span><span class="${d.cls}">${esc(d.text)}</span>
      ${t.needs_purchase ? `<span>🛒 ${esc(t.buyer || "Owner")}</span>` : ""}</div>
    ${t.progress ? `<div class="t-prog">${esc(t.progress)}${t.progress_at ? ` <span class="note">· ${thTime(t.progress_at)}</span>` : ""}</div>` : ""}
    ${pickable ? `<input type="checkbox" class="pick" data-pick="${t.no}" ${S.picked.has(t.no) ? "checked" : ""} aria-label="เลือกส่ง #${t.no}">` : ""}
  </button>`;
}

function grouped(list) {
  const groups = new Map();
  for (const t of sortTasks(list)) {
    const k = t.category || "อื่น ๆ";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  let html = "";
  for (const [k, arr] of groups) {
    const open = arr.filter((t) => t.status !== "DONE").length;
    html += `<div class="group"><h2>${esc(k)}</h2><span>${open} เปิด · ${arr.length} งาน</span></div>` + arr.map(taskCard).join("");
  }
  return html || '<div class="empty">ไม่มีงาน</div>';
}

function stats(list) {
  const open = list.filter((t) => t.status === "OPEN");
  const late = open.filter((t) => t.due_date && t.due_date < today()).length;
  const soon = open.filter((t) => t.due_date && t.due_date >= today() && days(today(), t.due_date) <= 7).length;
  const draft = list.filter((t) => t.status === "DRAFT").length;
  return `<div class="stats">
    <div class="stat"><b>${open.length}</b><span>เปิดอยู่</span></div>
    <div class="stat ${late ? "warn" : ""}"><b>${late}</b><span>เลยกำหนด</span></div>
    <div class="stat"><b>${soon}</b><span>ครบใน 7 วัน</span></div>
    <div class="stat"><b>${draft}</b><span>ยังไม่ส่งกลุ่ม</span></div></div>`;
}

function statusFilter(list) {
  if (S.status === "open") return list.filter((t) => t.status !== "DONE");
  if (S.status === "done") return list.filter((t) => t.status === "DONE");
  return list;
}

function renderMine() {
  if (!S.me.nickname) return `<div class="empty">ยังไม่ได้ผูกชื่อกับบัญชี LINE นี้<br>แจ้งสโตนให้ตั้งชื่อในหน้า "ผู้ใช้"</div>`;
  const mine = S.tasks.filter((t) => t.owners.some((o) => o.nickname === S.me.nickname));
  return stats(mine) + filtersHtml(false) + grouped(statusFilter(mine));
}

function filtersHtml(withPeople) {
  const st = [["open", "ยังไม่เสร็จ"], ["done", "เสร็จแล้ว"], ["all", "ทั้งหมด"]]
    .map(([k, v]) => `<button class="chip ${S.status === k ? "on" : ""}" data-status="${k}">${v}</button>`).join("");
  const cats = `<select class="chip" data-cat><option value="">ทุกหมวด</option>${S.categories.map((c) => `<option ${S.cat === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`;
  const ppl = withPeople ? `<select class="chip" data-person><option value="">ทุกคน</option>${S.people.map((p) => `<option ${S.person === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>` : "";
  return `<div class="filters">${st}${cats}${ppl}</div>`;
}

function renderAll() {
  let list = S.tasks;
  if (S.cat) list = list.filter((t) => t.category === S.cat);
  if (S.person) list = list.filter((t) => t.owners.some((o) => o.nickname === S.person));
  return stats(S.tasks) + filtersHtml(true) + grouped(statusFilter(list));
}

const FIELD = { title: "ชื่องาน", owners: "ผู้รับผิดชอบ", due_date: "กำหนดส่ง", urgent: "ด่วน", status: "สถานะ", category: "หมวด", detail: "รายละเอียด",
  source: "ที่มา", meeting_notes: "โน้ตประชุม", meeting_links: "ลิงก์ประชุม", needs_purchase: "มีของต้องซื้อ", buyer: "ผู้จัดซื้อ", progress: "ความคืบหน้า", created: "สร้างงาน" };
const STATUS_TH = { OPEN: "ยังไม่เสร็จ", DONE: "เสร็จแล้ว", CANCELLED: "ยกเลิก", DRAFT: "ยังไม่ส่งเข้ากลุ่ม" };
function showVal(field, v) {
  if (v === null || v === undefined || v === "") return "–";
  if (field === "owners") { try { return JSON.parse(v).map((o) => o.nickname).join(", "); } catch { return v; } }
  if (field === "due_date") return thDate(v);
  if (field === "status") return STATUS_TH[v] ?? v;
  if (field === "urgent" || field === "needs_purchase") return v === "true" ? "ใช่" : "ไม่";
  return v.length > 120 ? v.slice(0, 120) + "…" : v;
}
function changeLine(c) {
  const src = c.source === "line" ? " (LINE)" : c.source === "sheet" ? " (ชีต)" : "";
  const who = /^U[0-9a-f]{32}$/.test(c.changed_by ?? "") ? "ในกลุ่ม LINE" : c.changed_by;
  return `<li>${c.no ? `<b>#${c.no}</b> ` : ""}${esc(FIELD[c.field] ?? c.field)}: ${esc(showVal(c.field, c.old_value))} → <b>${esc(showVal(c.field, c.new_value))}</b>
    <div class="when">${esc(who ?? "")}${src} · ${thTime(c.changed_at)}</div></li>`;
}

async function renderRecent() {
  const r = await api("recent");
  return `<div class="sec"><h4>การแก้ไขล่าสุด (40 รายการ)</h4><ul class="hist">${r.changes.map(changeLine).join("") || "<li>ยังไม่มี</li>"}</ul></div>`;
}

async function renderUsers() {
  const r = await api("users");
  const roles = [["pending", "รออนุมัติ"], ["viewer", "ดูอย่างเดียว"], ["editor", "แก้งานตัวเอง"], ["admin", "admin"], ["blocked", "บล็อก"]];
  return `<p class="note">คนที่เปิดเว็บครั้งแรกจะขึ้นที่นี่ ตั้งชื่อให้ตรงกับชื่อในงาน แล้วเลือกสิทธิ์</p>` + r.users.map((u) => `
    <div class="sec"><div class="row" style="align-items:center;justify-content:space-between">
      <div><b>${esc(u.display_name || "-")}</b><div class="note">${u.last_seen_at ? "ล่าสุด " + thTime(u.last_seen_at) : ""}</div></div></div>
      <div class="row" style="margin-top:8px">
        <select class="f" data-u-nick="${esc(u.user_id)}" style="flex:1"><option value="">– ชื่อในงาน –</option>
          ${r.people.map((p) => `<option ${u.nickname === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
        <select class="f" data-u-role="${esc(u.user_id)}" style="flex:1">${roles.map(([k, v]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="btn" data-u-save="${esc(u.user_id)}">บันทึก</button></div></div>`).join("");
}

async function render() {
  renderHeader();
  const m = $("#main");
  try {
    if (S.tab === "mine") m.innerHTML = renderMine();
    else if (S.tab === "all") m.innerHTML = renderAll();
    else if (S.tab === "recent") { m.innerHTML = '<div class="loading">กำลังโหลด…</div>'; m.innerHTML = await renderRecent(); }
    else if (S.tab === "users") { m.innerHTML = '<div class="loading">กำลังโหลด…</div>'; m.innerHTML = await renderUsers(); }
  } catch (e) { m.innerHTML = `<div class="empty">โหลดไม่สำเร็จ: ${esc(e.message)}</div>`; }
  renderSendbar();
}

function renderSendbar() {
  const n = S.picked.size;
  $("#sendbar").hidden = !(isAdmin() && n && (S.tab === "mine" || S.tab === "all"));
  $("#sendcount").textContent = `เลือก ${n} งาน`;
}

/* ---------- detail sheet ---------- */
function openSheet(html) { $("#sheet-content").innerHTML = html; $("#sheet").hidden = false; document.body.style.overflow = "hidden"; }
function closeSheet() { $("#sheet").hidden = true; document.body.style.overflow = ""; }

async function openTask(no) {
  const t = S.tasks.find((x) => x.no === no);
  if (!t) return;
  const edit = canEdit(t);
  const admin = isAdmin();
  const d = dueInfo(t);
  const ownerChecks = S.people.map((p) => `<label><input type="checkbox" name="owners" value="${esc(p)}" ${t.owners.some((o) => o.nickname === p) ? "checked" : ""}> ${esc(p)}</label>`).join("");
  openSheet(`
    <div class="note">#${t.no} · ${esc(t.category || "")} ${statusBadge(t)} ${t.urgent ? '<span class="badge b-red">ด่วน</span>' : ""}</div>
    <h3>${esc(shortTitle(t))}</h3>
    <dl class="kv sec">
      <dt>ผู้รับผิดชอบ</dt><dd>${esc(owners(t))}</dd>
      <dt>กำหนดส่ง</dt><dd class="${d.cls}">${esc(d.text)}</dd>
      <dt>สถานะ</dt><dd>${esc(STATUS_TH[t.status] ?? t.status)}</dd>
      <dt>จัดซื้อ</dt><dd>${t.needs_purchase ? "มีของต้องซื้อ · " + esc(t.buyer || "Owner") : "–"}</dd>
      <dt>ที่มา</dt><dd>${esc(t.source || "–")}</dd>
    </dl>
    ${t.detail ? `<div class="sec"><h4>รายละเอียด</h4><p>${linkify(t.detail)}</p></div>` : ""}
    ${t.meeting_notes ? `<div class="sec"><h4>โน้ตจากประชุม (Wispr Flow)</h4><p>${linkify(t.meeting_notes)}</p></div>` : ""}
    ${t.meeting_links ? `<div class="sec"><h4>บันทึกประชุม</h4><p>${linkify(t.meeting_links)}</p></div>` : ""}
    ${edit ? `<form class="sec" id="edit">
      <h4>อัปเดตงาน</h4>
      <label class="f">ความคืบหน้า / ติดอะไร</label>
      <textarea name="progress" placeholder="เช่น ส่งแบบให้พี่จอมแล้ว รอคอมเมนต์">${esc(t.progress || "")}</textarea>
      <label class="f">กำหนดส่ง (ถ้าเลื่อน แจ้งในกลุ่มพร้อมเหตุผลด้วย)</label>
      <input type="date" name="due_date" value="${t.due_date || ""}">
      <label class="f"><input type="checkbox" name="needs_purchase" ${t.needs_purchase ? "checked" : ""}> มีอุปกรณ์/วัสดุต้องซื้อ</label>
      <select class="f" name="buyer">${["Owner", ...S.people.filter((p) => p !== "สโตน")].map((p) => `<option ${(t.buyer || "Owner") === p ? "selected" : ""}>${esc(p)}</option>`).join("")}</select>
      ${admin ? `
        <label class="f">ชื่องาน</label><input type="text" name="title" value="${esc(t.title)}">
        <label class="f">หมวด</label><select class="f" name="category">${S.categories.map((c) => `<option ${t.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <label class="f">ผู้รับผิดชอบ</label><div class="checks">${ownerChecks}</div>
        <label class="f"><input type="checkbox" name="urgent" ${t.urgent ? "checked" : ""}> ด่วน</label>
        <label class="f">รายละเอียด</label><textarea name="detail">${esc(t.detail || "")}</textarea>` : ""}
      <div class="actions">
        <button class="btn primary" type="submit">บันทึก</button>
        ${t.status === "OPEN" ? '<button class="btn good" type="button" data-status-set="DONE">✓ เสร็จแล้ว</button>' : ""}
        ${t.status === "DONE" ? '<button class="btn" type="button" data-status-set="OPEN">เปิดงานใหม่</button>' : ""}
        ${admin && t.status !== "CANCELLED" ? '<button class="btn warn" type="button" data-status-set="CANCELLED">ยกเลิกงาน</button>' : ""}
      </div></form>` : `<p class="note" style="margin-top:12px">แก้ได้เฉพาะผู้รับผิดชอบงานนี้และสโตน</p>`}
    <div class="sec"><h4>ประวัติการแก้ไข</h4><ul class="hist" id="hist"><li class="note">กำลังโหลด…</li></ul></div>`);
  const form = $("#edit");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const patch = {};
      const prog = (f.get("progress") || "").trim();
      if (prog !== (t.progress || "")) patch.progress = prog;
      const due = f.get("due_date") || "";
      if (due !== (t.due_date || "")) patch.due_date = due;
      const np = f.get("needs_purchase") === "on";
      if (np !== !!t.needs_purchase) patch.needs_purchase = np;
      const buyer = f.get("buyer");
      if (buyer !== (t.buyer || "Owner")) patch.buyer = buyer;
      if (admin) {
        const title = (f.get("title") || "").trim();
        if (title && title !== t.title) patch.title = title;
        const cat = f.get("category");
        if (cat && cat !== t.category) patch.category = cat;
        const own = f.getAll("owners");
        if (own.join(",") !== t.owners.map((o) => o.nickname).join(",")) patch.owners = own;
        const urg = f.get("urgent") === "on";
        if (urg !== !!t.urgent) patch.urgent = urg;
        const det = (f.get("detail") || "").trim();
        if (det !== (t.detail || "")) patch.detail = det;
      }
      if (!Object.keys(patch).length) return toast("ไม่มีอะไรเปลี่ยน");
      await save(t.no, patch);
    });
    form.querySelectorAll("[data-status-set]").forEach((b) => b.addEventListener("click", async () => {
      const s = b.dataset.statusSet;
      if (s === "CANCELLED" && !confirmInline(b)) return;
      await save(t.no, { status: s });
    }));
  }
  try {
    const h = await api("history", { no: t.no });
    $("#hist").innerHTML = h.history.map((c) => changeLine({ ...c, no: null })).join("") || '<li class="note">ยังไม่มีการแก้ไข</li>';
  } catch { $("#hist").innerHTML = '<li class="note">โหลดประวัติไม่ได้</li>'; }
}

// two-tap confirm without browser dialogs
function confirmInline(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = "1"; btn.textContent = "แตะอีกครั้งเพื่อยืนยัน";
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = "ยกเลิกงาน"; }, 4000);
  return false;
}

async function save(no, patch) {
  try {
    await api("update", { no, patch });
    toast("บันทึกแล้ว");
    await load();
    openTask(no);
  } catch (e) { toast("บันทึกไม่ได้: " + e.message); }
}

function openCreate() {
  openSheet(`<h3>เพิ่มงานใหม่</h3>
    <p class="note">งานใหม่จะยังไม่เข้ากลุ่ม LINE จนกว่าสโตนจะกดส่ง</p>
    <form class="sec" id="create">
      <label class="f">ชื่องาน</label><input type="text" name="title" required maxlength="200">
      <label class="f">หมวด</label><select class="f" name="category">${S.categories.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <label class="f">ผู้รับผิดชอบ</label><div class="checks">${S.people.map((p) => `<label><input type="checkbox" name="owners" value="${esc(p)}" ${S.me.nickname === p ? "checked" : ""}> ${esc(p)}</label>`).join("")}</div>
      <label class="f">กำหนดส่ง</label><input type="date" name="due_date">
      <label class="f">รายละเอียด</label><textarea name="detail"></textarea>
      <div class="actions"><button class="btn primary" type="submit">เพิ่มงาน</button></div>
    </form>`);
  $("#create").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const r = await api("create", { title: f.get("title"), category: f.get("category"), owners: f.getAll("owners"), due_date: f.get("due_date") || null, detail: f.get("detail") || null });
      toast(`เพิ่มงาน #${r.no} แล้ว`);
      closeSheet(); await load(); render();
    } catch (err) { toast("เพิ่มไม่ได้: " + err.message); }
  });
}

/* ---------- events ---------- */
document.addEventListener("click", async (e) => {
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    S.tab = tab.dataset.tab;
    document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b === tab));
    return render();
  }
  if (e.target.closest("[data-close]")) return closeSheet();
  const pick = e.target.closest("[data-pick]");
  if (pick) {
    e.stopPropagation();
    const n = Number(pick.dataset.pick);
    pick.checked ? S.picked.add(n) : S.picked.delete(n);
    return renderSendbar();
  }
  const st = e.target.closest("[data-status]");
  if (st) { S.status = st.dataset.status; return render(); }
  const card = e.target.closest(".task[data-no]");
  if (card) return openTask(Number(card.dataset.no));
  const us = e.target.closest("[data-u-save]");
  if (us) {
    const id = us.dataset.uSave;
    const nickname = document.querySelector(`[data-u-nick="${CSS.escape(id)}"]`).value || null;
    const role = document.querySelector(`[data-u-role="${CSS.escape(id)}"]`).value;
    try { await api("users", { set: { user_id: id, nickname, role } }); toast("บันทึกแล้ว"); render(); } catch (err) { toast(err.message); }
  }
});
document.addEventListener("change", (e) => {
  if (e.target.matches("[data-cat]")) { S.cat = e.target.value; render(); }
  if (e.target.matches("[data-person]")) { S.person = e.target.value; render(); }
});
$("#fab").addEventListener("click", openCreate);
$("#sendbtn").addEventListener("click", async (e) => {
  const b = e.currentTarget;
  if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = `ยืนยันส่ง ${S.picked.size} งานเข้ากลุ่ม`; setTimeout(() => { delete b.dataset.armed; b.textContent = "ส่งเข้ากลุ่ม LINE"; }, 5000); return; }
  delete b.dataset.armed; b.textContent = "ส่งเข้ากลุ่ม LINE";
  try {
    await api("send", { nos: [...S.picked] });
    S.picked.clear();
    toast("ส่งแล้ว บอทจะโพสต์การ์ดเข้ากลุ่มภายใน 1 นาที");
    await load(); render();
  } catch (err) { toast("ส่งไม่ได้: " + err.message); }
});

/* ---------- boot ---------- */
async function load() {
  const r = await api("list");
  S.me = r.me; S.tasks = r.tasks; S.categories = r.categories; S.people = r.people;
}

async function boot() {
  try {
    await liff.init({ liffId: LIFF_ID });
    if (!liff.isLoggedIn()) { liff.login({ redirectUri: location.href }); return; }
    const me = await api("me");
    S.me = me.me;
    if (S.me.role === "pending") {
      renderHeader();
      $("#tabs").hidden = true;
      $("#main").innerHTML = `<div class="empty">สวัสดี ${esc(S.me.display_name)}<br>บัญชีนี้รอสโตนอนุมัติก่อนดูงาน<br><span class="note">แจ้งสโตนในกลุ่มได้เลย</span></div>`;
      return;
    }
    await load();
    const want = new URLSearchParams(location.search).get("task");
    if (!S.me.nickname) S.tab = "all", document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "all"));
    await render();
    if (want) openTask(Number(want));
  } catch (e) {
    if (e.message !== "login") $("#main").innerHTML = `<div class="empty">เปิดไม่สำเร็จ: ${esc(e.message)}</div>`;
  }
}
boot();
