// KTM x JWP task board API (owner Stone, 2026-11-12)
// The web page (GitHub Pages, opened through LIFF) sends the user's LIFF ID token; this function verifies it
// with LINE, maps the LINE userId to a person, and reads/writes line.tasks + line.task_details.
// Never sends LINE messages itself: "send to group" only marks DRAFT tasks as an APPROVED batch, and the
// existing line-tasks function posts it. All writes go through audited SQL functions (line.task_changes).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const LIFF_CHANNEL_ID = "2012582367";
const GROUP = "C1d3f5a1c1ebcb6ca4f9087dba402939b";
const ORIGINS = ["https://sirasirip-creator.github.io", "http://localhost:8000", "http://127.0.0.1:8000"];
const PEOPLE = ["สโตน", "พี่กฤษ", "พี่จอม", "พี่จำรอง", "พี่ดอน", "อาเอื้อย", "พี่นน"];

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  db: { schema: "line" }, auth: { persistSession: false },
});

function cors(origin: string | null) {
  const o = origin && ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    "access-control-allow-origin": o,
    "access-control-allow-headers": "content-type, x-line-id-token",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "origin",
  };
}

type Me = { user_id: string; nickname: string | null; role: string; display_name: string };

async function verify(idToken: string): Promise<{ sub: string; name: string; picture?: string } | null> {
  if (!idToken || idToken.length > 4000) return null;
  const r = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: LIFF_CHANNEL_ID }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return j?.sub ? { sub: j.sub, name: String(j.name ?? ""), picture: j.picture } : null;
}

async function whoAmI(idToken: string): Promise<Me | null> {
  const v = await verify(idToken);
  if (!v) return null;
  const { data: u } = await db.from("board_users").select("*").eq("user_id", v.sub).maybeSingle();
  if (!u) {
    // first visit: maybe the bot already knows this person in the group
    const { data: p } = await db.from("people").select("nickname").eq("group_id", GROUP).eq("user_id", v.sub).maybeSingle();
    const row = { user_id: v.sub, nickname: (p as any)?.nickname ?? null, display_name: v.name, picture_url: v.picture ?? null,
      role: p ? "editor" : "pending", approved_by: p ? "line.people" : null, last_seen_at: new Date().toISOString() };
    await db.from("board_users").insert(row);
    return { user_id: v.sub, nickname: row.nickname, role: row.role, display_name: v.name };
  }
  await db.from("board_users").update({ display_name: v.name, picture_url: v.picture ?? null, last_seen_at: new Date().toISOString() }).eq("user_id", v.sub);
  return { user_id: v.sub, nickname: (u as any).nickname, role: (u as any).role, display_name: v.name };
}

const isOwner = (me: Me, owners: { nickname: string }[]) => !!me.nickname && (owners ?? []).some((o) => o.nickname === me.nickname);
const actor = (me: Me) => me.nickname ?? me.display_name ?? me.user_id;

async function listTasks(me: Me) {
  const { data: tasks } = await db.from("tasks").select("id,no,title,owners,due_date,urgent,status,batch_id,done_at,created_at")
    .eq("group_id", GROUP).neq("status", "CANCELLED").order("no");
  const ids = (tasks ?? []).map((t: any) => t.id);
  const { data: det } = await db.from("task_details").select("*").in("task_id", ids.length ? ids : [0]);
  const { data: cats } = await db.from("task_categories").select("name,sort_order").eq("group_id", GROUP).order("sort_order");
  const dmap = new Map((det ?? []).map((d: any) => [d.task_id, d]));
  const out = (tasks ?? []).map((t: any) => {
      const d: any = dmap.get(t.id) ?? {};
      return {
        no: t.no, title: t.title, owners: t.owners ?? [], due_date: t.due_date, urgent: t.urgent, status: t.status,
        in_group: t.status !== "DRAFT", done_at: t.done_at,
        category: d.category ?? null, detail: d.detail ?? null, source: d.source ?? null,
        meeting_notes: d.meeting_notes ?? null, meeting_links: d.meeting_links ?? null,
        needs_purchase: d.needs_purchase ?? false, buyer: d.buyer ?? null,
        progress: d.progress ?? null, progress_at: d.progress_at ?? null, updated_at: d.updated_at ?? null, updated_by: d.updated_by ?? null,
      };
    });
  return { tasks: out, categories: (cats ?? []).map((c: any) => c.name), people: PEOPLE };
}

async function history(no: number) {
  const { data } = await db.from("task_changes").select("field,old_value,new_value,changed_by,source,changed_at")
    .eq("group_id", GROUP).eq("no", no).order("changed_at", { ascending: false }).limit(50);
  return { history: data ?? [] };
}

async function recent() {
  const { data } = await db.from("task_changes").select("no,field,old_value,new_value,changed_by,source,changed_at")
    .eq("group_id", GROUP).order("changed_at", { ascending: false }).limit(40);
  return { changes: data ?? [] };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.replace(/[{}]/g, "").slice(0, max) : undefined);

async function update(me: Me, body: any) {
  const no = Number(body?.no);
  if (!Number.isInteger(no) || no < 1) return { error: "bad task number" };
  const { data: t } = await db.from("tasks").select("owners,status").eq("group_id", GROUP).eq("no", no).maybeSingle();
  if (!t) return { error: "task not found" };
  const admin = me.role === "admin";
  const owner = me.role === "editor" && isOwner(me, (t as any).owners);
  if (!admin && !owner) return { error: "แก้ได้เฉพาะงานที่ตัวเองรับผิดชอบ" };

  const p = body?.patch ?? {};
  const patch: Record<string, unknown> = {};
  // owners and admin
  if ("progress" in p) patch.progress = str(p.progress, 2000) ?? null;
  if ("due_date" in p) { if (p.due_date !== null && p.due_date !== "" && !DATE.test(String(p.due_date))) return { error: "bad date" }; patch.due_date = p.due_date || ""; }
  if ("status" in p) {
    const s = String(p.status);
    if (!["OPEN", "DONE", "CANCELLED"].includes(s)) return { error: "bad status" };
    if (s === "CANCELLED" && !admin) return { error: "ยกเลิกงานได้เฉพาะสโตน" };
    if ((t as any).status === "DRAFT" && s === "OPEN") return { error: "งานนี้ยังไม่ส่งเข้ากลุ่ม" };
    patch.status = s;
  }
  if ("needs_purchase" in p) patch.needs_purchase = !!p.needs_purchase;
  if ("buyer" in p) patch.buyer = str(p.buyer, 100) ?? null;
  // admin only
  if (admin) {
    for (const k of ["title", "category", "detail", "source", "meeting_notes", "meeting_links"]) if (k in p) patch[k] = str(p[k]) ?? null;
    if ("urgent" in p) patch.urgent = !!p.urgent;
    if ("owners" in p && Array.isArray(p.owners)) patch.owners = p.owners.filter((n: unknown) => PEOPLE.includes(String(n))).map((n: unknown) => ({ nickname: String(n) }));
  }
  if (!Object.keys(patch).length) return { error: "nothing to change" };
  const { error } = await db.rpc("board_update_task", { p_group: GROUP, p_no: no, p_patch: patch, p_actor: actor(me) });
  return error ? { error: error.message } : { ok: true };
}

async function create(me: Me, body: any) {
  if (me.role !== "admin" && me.role !== "editor") return { error: "ไม่มีสิทธิ์เพิ่มงาน" };
  const title = str(body?.title, 200)?.trim();
  if (!title) return { error: "ใส่ชื่องาน" };
  const cat = str(body?.category, 60) ?? null;
  const owners = (Array.isArray(body?.owners) ? body.owners : []).filter((n: unknown) => PEOPLE.includes(String(n))).map((n: unknown) => ({ nickname: String(n) }));
  const due = body?.due_date && DATE.test(String(body.due_date)) ? body.due_date : null;
  const { data, error } = await db.rpc("board_create_task", {
    p_group: GROUP, p_title: cat ? `${cat}: ${title}` : title, p_owners: owners, p_due: due, p_category: cat,
    p_detail: str(body?.detail) ?? null, p_actor: actor(me),
  });
  return error ? { error: error.message } : { ok: true, no: data };
}

async function send(me: Me, body: any) {
  if (me.role !== "admin") return { error: "ส่งเข้ากลุ่มได้เฉพาะสโตน" };
  const nos = (Array.isArray(body?.nos) ? body.nos : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
  if (!nos.length) return { error: "เลือกงาน" };
  const { data, error } = await db.rpc("board_send_tasks", { p_group: GROUP, p_nos: nos, p_actor: actor(me) });
  return error ? { error: error.message } : { ok: true, batch: data };
}

async function users(me: Me, body: any) {
  if (me.role !== "admin") return { error: "admin only" };
  if (body?.set) {
    const s = body.set;
    const role = ["pending", "viewer", "editor", "admin", "blocked"].includes(s.role) ? s.role : null;
    const nickname = s.nickname === null || PEOPLE.includes(String(s.nickname)) ? s.nickname : undefined;
    if (!role || nickname === undefined || typeof s.user_id !== "string") return { error: "bad input" };
    await db.from("board_users").update({ role, nickname, approved_by: actor(me) }).eq("user_id", s.user_id);
  }
  const { data } = await db.from("board_users").select("user_id,nickname,display_name,picture_url,role,last_seen_at").order("created_at");
  return { users: data ?? [], people: PEOPLE };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...h, "content-type": "application/json" } });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });
  const me = await whoAmI(req.headers.get("x-line-id-token") ?? "");
  if (!me) return reply(401, { error: "login expired" });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = String(body?.action ?? "me");
  if (me.role === "blocked") return reply(403, { error: "blocked" });
  if (action === "me") return reply(200, { me });
  if (me.role === "pending") return reply(200, { me, pending: true });
  try {
    switch (action) {
      case "list": return reply(200, { me, ...(await listTasks(me)) });
      case "history": return reply(200, await history(Number(body?.no)));
      case "recent": return reply(200, await recent());
      case "update": { const r = await update(me, body); return reply(r.error ? 400 : 200, r); }
      case "create": { const r = await create(me, body); return reply(r.error ? 400 : 200, r); }
      case "send": { const r = await send(me, body); return reply(r.error ? 400 : 200, r); }
      case "users": { const r = await users(me, body); return reply((r as any).error ? 403 : 200, r); }
      default: return reply(400, { error: "unknown action" });
    }
  } catch (e) {
    return reply(500, { error: String(e).slice(0, 200) });
  }
});
