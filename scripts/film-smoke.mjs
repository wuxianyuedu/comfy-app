// Film Studio (一键成片) integration smoke.
// Verifies the end-to-end wiring of the film pipeline WITHOUT needing a GPU:
//   auth (register+login) -> POST /api/film (script -> storyboard) -> GET /api/film/:id
// We deliberately do NOT call /start, because that enqueues ComfyUI video jobs
// (which require a logged-in LTX node / ffmpeg) and would hang the smoke.
//
// Run against a live `next start` server (see task #140 for how it's booted).
const BASE = process.env.BASE_URL || "http://localhost:3700";
const EMAIL = `film_smoke_${Date.now()}@comfy.app`;
const PASS = "FilmSmoke@12345";

const log = (...a) => console.log("[film-smoke]", ...a);

function collectCookies(headers, jar) {
  const arr = headers.getSetCookie ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  for (const c of arr) jar.push(c.split(";")[0]);
  return jar;
}
const jarStr = (jar) => jar.join("; ");

async function authSession() {
  // 1) Register
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASS, name: "Film Smoke" }),
  });
  const reg = await r.json().catch(() => ({}));
  if (!r.ok || !reg.user) {
    console.error("REGISTER_FAIL", r.status, reg);
    process.exit(1);
  }
  log("registered", reg.user.email);

  // 2) CSRF
  const jar = [];
  r = await fetch(`${BASE}/api/auth/csrf`, { headers: { cookie: jarStr(jar) } });
  const csrf = await r.json();
  collectCookies(r.headers, jar);

  // 3) Credentials login
  r = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jarStr(jar) },
    body: new URLSearchParams({
      csrfToken: csrf.csrfToken,
      email: EMAIL,
      password: PASS,
      callbackUrl: `${BASE}/workspace`,
    }).toString(),
  });
  const loginCookies = [];
  collectCookies(r.headers, loginCookies);
  const sessionCookie = loginCookies.find((c) => c.startsWith("authjs.session-token"));
  if (!sessionCookie) {
    console.error("LOGIN_FAIL: no session cookie", r.headers.get("set-cookie"));
    process.exit(1);
  }
  log("session ok");
  return sessionCookie;
}

async function main() {
  const cookie = await authSession();

  // Pick an available style if any (optional; null is fine).
  let styleSlug = null;
  try {
    const sk = await fetch(`${BASE}/api/skills`).then((x) => x.json());
    if (Array.isArray(sk.skills) && sk.skills.length) styleSlug = sk.skills[0].slug;
  } catch {
    /* ignore */
  }

  // 1) Create a film from a script (script -> auto storyboard).
  const script =
    "清晨的咖啡馆，老人擦拭相框，阳光斜照。他想起年轻时的约定。门外，一个熟悉的身影出现……";
  const r = await fetch(`${BASE}/api/film`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      title: "冒烟测试影片",
      script,
      type: "short_video",
      styleSlug,
      size: "1280x720",
      fps: 16,
      framesPerShot: 49,
      subtitleOn: true,
      bgmName: null,
    }),
  });
  const created = await r.json().catch(() => ({}));
  if (!r.ok || !created.id) {
    console.error("CREATE_FAIL", r.status, created);
    process.exit(1);
  }
  log("film created id=", created.id, "shotCount=", created.shotCount);
  if (!Number.isInteger(created.shotCount) || created.shotCount < 1) {
    console.error("STORYBOARD_FAIL: shotCount not positive", created.shotCount);
    process.exit(1);
  }

  // 2) Fetch detail and verify shots exist + wiring fields are present.
  const d = await fetch(`${BASE}/api/film/${created.id}`, { headers: { cookie } });
  const detail = await d.json().catch(() => ({}));
  if (!d.ok || !detail.film) {
    console.error("DETAIL_FAIL", d.status, detail);
    process.exit(1);
  }
  const f = detail.film;
  if (!Array.isArray(f.shots) || f.shots.length !== created.shotCount) {
    console.error("SHOTS_MISMATCH", f.shots?.length, "vs", created.shotCount);
    process.exit(1);
  }
  const bad = f.shots.find((s) => !s.prompt || typeof s.order !== "number" || !s.params);
  if (bad) {
    console.error("SHOT_FIELD_MISSING", bad);
    process.exit(1);
  }
  log("shots verified:", f.shots.length, "status=", f.status);

  // 3) Confirm the workflow was auto-selected (LTX fallback when no WAN model).
  const wf = f.shots[0]?.params?.workflow;
  log("auto-selected video workflow:", wf);

  console.log("FILM_SMOKE_EXIT:0");
}

main().catch((e) => {
  console.error("SMOKE_ERROR", e);
  process.exit(1);
});
