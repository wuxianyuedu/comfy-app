/**
 * `PUT /api/production` 契约（Phase 3b-2）：① 未鉴权 → 401；② 缺 project/production → 400
 * （不静默写空行）；③ 正常 PUT → 落库一行，JSON 列（shots/progress）原样存回。
 * 走 test-db 内存库（真 Drizzle），只 mock 鉴权与 db 两处边界。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { NextRequest } from "next/server";
import { isPlainRecord } from "~/lib/is-record";

vi.mock("~/server/db", async () => {
  const { createTestDb } = await import("../../../../tests/helpers/test-db");
  return { db: createTestDb() };
});

const auth = vi.hoisted((): { user: { id: string } | null } => ({
  user: { id: "u1" },
}));
vi.mock("~/server/auth/request-user", () => ({
  requireRequestUser: () => auth.user,
}));

import { getTestDb, seedUser } from "../../../../tests/helpers/test-db";
import { productionRepository } from "~/lib/core/repository-production";
import { GET, PUT } from "./route";

const tdb = getTestDb();

beforeEach(() => {
  tdb.$reset();
  seedUser(tdb, { id: "u1", email: "u1@test.dev" });
  auth.user = { id: "u1" };
});

function putRequest(body: unknown) {
  const req = new NextRequest("http://localhost/api/production", { method: "PUT" });
  req.json = () => Promise.resolve(body);
  return req;
}

describe("PUT /api/production", () => {
  it("未鉴权 → 401", async () => {
    auth.user = null;
    const res = await PUT(putRequest({ project: "proj_1", production: {} }));
    expect(res.status).toBe(401);
  });

  it("缺 project → 400（不写空行）", async () => {
    const res = await PUT(putRequest({ production: { title: "x" } }));
    expect(res.status).toBe(400);
  });

  it("缺 production → 400", async () => {
    const res = await PUT(putRequest({ project: "proj_1" }));
    expect(res.status).toBe(400);
  });

  it("正常 PUT 落库一行，JSON 列原样存回", async () => {
    const res = await PUT(
      putRequest({
        project: "proj_1",
        production: {
          title: "我的短剧",
          shots: [{ id: "s1", prompt: "p" }],
          progress: { stage: "storyboard", rendered: false },
        },
      }),
    );
    expect(res.status).toBe(200);
    /* 应答在 `ok` 之外带 `stale` 与 `updatedAt` 两枚读数（ISSUE #5147）：
     * 前者说「这次是不是基于更旧的副本」，后者给客户端推进写入基线。 */
    const body: unknown = await res.json();
    if (!isPlainRecord(body)) {
      throw new TypeError(`响应不是对象：${JSON.stringify(body)}`);
    }
    expect(body.ok).toBe(true);
    expect(body.stale).toBe(false);
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.title).toBe("我的短剧");
    expect(got?.shots).toEqual([{ id: "s1", prompt: "p" }]);
    expect(got?.progress).toEqual({ stage: "storyboard", rendered: false });
  });

  it("目标 project 已归属他人时返回 403 且不覆盖", async () => {
    seedUser(tdb, { id: "u2", email: "u2@test.dev" });
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "u1 的",
      shots: [{ id: "s1" }],
    });
    auth.user = { id: "u2" };
    const res = await PUT(
      putRequest({
        project: "proj_1",
        production: {
          title: "u2 篡改",
          shots: [{ id: "bad" }],
        },
      }),
    );
    expect(res.status).toBe(403);
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.title).toBe("u1 的");
    expect(got?.shots).toEqual([{ id: "s1" }]);
  });
});

function getRequest(project: string | null) {
  const url = new URL("http://localhost/api/production");
  if (project !== null && project !== "") {
    url.searchParams.set("project", project);
  }
  return new NextRequest(url);
}

describe("GET /api/production", () => {
  it("未鉴权 → 401", async () => {
    auth.user = null;
    const res = await GET(getRequest("proj_1"));
    expect(res.status).toBe(401);
  });

  it("缺 project → 400", async () => {
    const res = await GET(getRequest(null));
    expect(res.status).toBe(400);
  });

  it("无该行 → { exists:false }", async () => {
    const res = await GET(getRequest("missing"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ exists: false });
  });

  it("有行 → exists:true 且回传 production（JSON 列已解析）", async () => {
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "我的短剧",
      shots: [{ id: "s1" }],
    });
    const res = await GET(getRequest("proj_1"));
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (
      !isPlainRecord(body) ||
      typeof body.exists !== "boolean" ||
      !isPlainRecord(body.production) ||
      typeof body.production.title !== "string"
    ) {
      throw new Error(`生产数据响应形状不符：${JSON.stringify(body)}`);
    }
    expect(body.exists).toBe(true);
    expect(body.production.title).toBe("我的短剧");
    expect(body.production.shots).toEqual([{ id: "s1" }]);
  });
});

/* ── 双操作者的写侧保护（ISSUE #5147）────────────────────────
 *
 * 现场：AI 侧把 scenes / characters / shots 写进 production，界面那份旧草稿
 * （这三列全空）随后自动保存 —— 同一行被整片盖成空。下面四组用例就是那条
 * 判据链：① 只带剧本的窄写入不许动那三列；② 整份快照撞上更新的库要拒写；
 * ③ 窄写入撞上更新的库照写（只覆盖用户改过的字段，不会清空别人的内容）；
 * ④ `stale` 是读数，库里一个字节都没变。
 */
describe("PUT /api/production 窄字段写入（#5147）", () => {
  /** AI 侧写完之后的库内状态（6 场景 / 6 角色 / 19 镜的缩小版）。 */
  async function seedAiContent() {
    await productionRepository.upsertForUser("u1", {
      id: "proj_1",
      title: "AI 的项目",
      tone: "悬疑",
      scriptMarkdown: "# AI 写的剧本",
      scenes: [{ id: "sc1" }, { id: "sc2" }],
      characters: [{ id: "ch1" }],
      shots: [{ id: "sh1" }, { id: "sh2" }],
    });
  }

  it("只带 scriptMarkdown 的窄写入 → 场景 / 角色 / 分镜原样留在库里（本单的主修）", async () => {
    await seedAiContent();
    const res = await PUT(
      putRequest({ project: "proj_1", production: { scriptMarkdown: "# 用户改过的剧本" } }),
    );
    expect(res.status).toBe(200);
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.scriptMarkdown).toBe("# 用户改过的剧本");
    /* 这三列是 AI 写的，界面那份旧草稿里没有 —— 缺键 = 不动。 */
    expect(got?.scenes).toEqual([{ id: "sc1" }, { id: "sc2" }]);
    expect(got?.characters).toEqual([{ id: "ch1" }]);
    expect(got?.shots).toEqual([{ id: "sh1" }, { id: "sh2" }]);
    /* title 同理：没带就不写，不是「回默认值」。 */
    expect(got?.title).toBe("AI 的项目");
  });

  it("窄写入可以显式清空某一列（用户真的删了镜头 → shots: [] 要落库）", async () => {
    await seedAiContent();
    const res = await PUT(putRequest({ project: "proj_1", production: { shots: [] } }));
    expect(res.status).toBe(200);
    const got = await productionRepository.getForUser("u1", "proj_1");
    expect(got?.shots).toEqual([]);
    expect(got?.characters).toEqual([{ id: "ch1" }]);
  });

  it("整份快照 + 库已被别人写过（baseUpdatedAt 更旧）→ 跳过写入并回 stale + 现值", async () => {
    await seedAiContent();
    const before = await productionRepository.getForUser("u1", "proj_1");
    if (!before) {
      throw new Error("前置条件不成立：库内应有行");
    }
    /* 界面挂载在「一小时前」：它基于的那一版远早于库里此刻的 updatedAt。 */
    const staleBase = before.updatedAt.getTime() - 3_600_000;
    const res = await PUT(
      putRequest({
        project: "proj_1",
        baseUpdatedAt: staleBase,
        production: {
          title: "未命名项目",
          type: "short_video",
          tone: "",
          logline: "",
          scriptMarkdown: "",
          scenes: [],
          characters: [],
          shots: [],
          progress: { stage: "script", rendered: false },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isPlainRecord(body)) {
      throw new TypeError(`响应不是对象：${JSON.stringify(body)}`);
    }
    expect(body.stale).toBe(true);
    /* 现值随应答回给界面（「是否采用」的判据就在这份内容里）。 */
    if (!isPlainRecord(body.production)) {
      throw new TypeError("stale 应答应带服务端现值");
    }
    expect(body.production.title).toBe("AI 的项目");
    /* 库里一个字节都没变 —— 这是「拒绝」与「写了但内容一样」的分水岭。 */
    const after = await productionRepository.getForUser("u1", "proj_1");
    expect(after?.scenes).toEqual([{ id: "sc1" }, { id: "sc2" }]);
    expect(after?.characters).toEqual([{ id: "ch1" }]);
    expect(after?.shots).toEqual([{ id: "sh1" }, { id: "sh2" }]);
    expect(after?.title).toBe("AI 的项目");
  });

  it("整份快照 + 库没有更新过 → 正常整片写入（旧调用方的行为不变）", async () => {
    await seedAiContent();
    const before = await productionRepository.getForUser("u1", "proj_1");
    if (!before) {
      throw new Error("前置条件不成立：库内应有行");
    }
    const res = await PUT(
      putRequest({
        project: "proj_1",
        baseUpdatedAt: before.updatedAt.getTime(),
        production: {
          title: "用户整份覆盖",
          type: "short_video",
          tone: "轻",
          logline: "L",
          scriptMarkdown: "# 用户剧本",
          scenes: [],
          characters: [],
          shots: [],
          progress: { stage: "script", rendered: false },
        },
      }),
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isPlainRecord(body)) {
      throw new TypeError(`响应不是对象：${JSON.stringify(body)}`);
    }
    expect(body.stale).toBe(false);
    const after = await productionRepository.getForUser("u1", "proj_1");
    expect(after?.title).toBe("用户整份覆盖");
    expect(after?.scenes).toEqual([]);
  });

  it("整份快照但不带 baseUpdatedAt → 不参与版本闸（旧调用方行为不变）", async () => {
    await seedAiContent();
    const res = await PUT(
      putRequest({
        project: "proj_1",
        production: {
          title: "旧调用方",
          type: "short_video",
          tone: "",
          logline: "",
          scriptMarkdown: "",
          scenes: [],
          characters: [],
          shots: [],
        },
      }),
    );
    expect(res.status).toBe(200);
    const after = await productionRepository.getForUser("u1", "proj_1");
    expect(after?.title).toBe("旧调用方");
  });

  it("窄写入 + 库更新过 → 照写用户那一项（不因为版本旧就丢掉用户的改动）", async () => {
    await seedAiContent();
    const before = await productionRepository.getForUser("u1", "proj_1");
    if (!before) {
      throw new Error("前置条件不成立：库内应有行");
    }
    const res = await PUT(
      putRequest({
        project: "proj_1",
        baseUpdatedAt: before.updatedAt.getTime() - 3_600_000,
        production: { scriptMarkdown: "# 用户改的" },
      }),
    );
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isPlainRecord(body)) {
      throw new TypeError(`响应不是对象：${JSON.stringify(body)}`);
    }
    /* stale 仍是读数（界面据此提示「服务端也更新过」），但写入照旧落地：
     * 窄写入只覆盖用户改过的那一列，拦下来等于把用户的改动丢了。 */
    expect(body.stale).toBe(true);
    const after = await productionRepository.getForUser("u1", "proj_1");
    expect(after?.scriptMarkdown).toBe("# 用户改的");
    expect(after?.scenes).toEqual([{ id: "sc1" }, { id: "sc2" }]);
  });

  it("应答带 updatedAt（客户端据此推进写入基线）", async () => {
    const res = await PUT(putRequest({ project: "proj_1", production: { title: "T" } }));
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isPlainRecord(body) || typeof body.updatedAt !== "number") {
      throw new TypeError(`应答应带数值 updatedAt：${JSON.stringify(body)}`);
    }
    expect(Number.isFinite(body.updatedAt)).toBe(true);
  });
});
