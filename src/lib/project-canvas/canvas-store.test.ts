// @vitest-environment jsdom
// 项目画布的本地索引（localStorage）+ 服务端镜像策略单测。
// 覆盖三条容易回归的规则：
//   1. 空草稿名哨兵（当前默认名 "未命名"）决定要不要被回收；
//   2. 被用户命名过的空画布**不能**被回收（用户刻意保存的空灵感板）；
//   3. findNextAvailableName 在 base 本身以 "_<n>" 结尾时不会死循环。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectListQuery = vi.fn();
const projectUpsertMutate = vi.fn<(...args: unknown[]) => unknown>();
const projectDeleteMutate = vi.fn<(...args: unknown[]) => unknown>();

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    project: {
      list: {
        query: (...args: unknown[]) => projectListQuery(...args) as never,
      },
      /* `Promise.resolve().then(() => …)` 而不是 `Promise.resolve(…)`：
       * 后者会把 mock 的**同步抛错**当成 fulfilled 的值吞下去，
       * 于是「服务端拒收这一份」这条路上永远测不到 —— 而这条镜像链的
       * 缺陷恰恰长在失败分支上（台账 A3 装上归属闸之后才有的那一格）。 */
      upsert: {
        mutate: (...args: unknown[]) =>
          Promise.resolve().then(() => projectUpsertMutate(...args)),
      },
      delete: {
        mutate: (...args: unknown[]) =>
          Promise.resolve().then(() => projectDeleteMutate(...args)),
      },
    },
  },
}));

import {
  EMPTY_DRAFT_NAMES,
  createDraftProject,
  createProject,
  deleteProject,
  deleteProjectEverywhere,
  findNextAvailableName,
  getAllProjectNames,
  getActiveId,
  getProject,
  hydrateFromServer,
  isEmptyDraftName,
  isProjectNameTaken,
  listProjects,
  listProjectsWithServer,
  reapAllEmptyDrafts,
  reapEmptyProject,
  setActive,
  upsertProject,
} from "./canvas-store";
import { listSyncNotices } from "./sync-notice";

/** 等一轮宏任务：镜像是 fire-and-forget，登记发生在 promise 落定之后。 */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** tRPC 客户端错误的真实形状：码在 `data.code`。 */
function trpcError(code: string, message: string): unknown {
  return Object.assign(new Error(message), {
    data: { code },
    shape: { message, code },
  });
}

function noticesFor(id: string): string[] {
  return listSyncNotices()
    .filter((notice) => notice.projectId === id)
    .map((notice) => notice.detail);
}

const INDEX_KEY = "comfyapp.canvas.projects.v1";

function seed(projects: Array<Record<string, unknown>>) {
  localStorage.setItem(INDEX_KEY, JSON.stringify(projects));
}

beforeEach(() => {
  localStorage.clear();
  projectListQuery.mockReset();
  projectUpsertMutate.mockReset();
  projectDeleteMutate.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("空草稿名哨兵", () => {
  it("当前默认名算空草稿（可回收）；旧版 legacy 默认名不再识别", () => {
    expect(EMPTY_DRAFT_NAMES).toEqual(["未命名"]);
    expect(isEmptyDraftName("未命名")).toBe(true);
    expect(isEmptyDraftName("未命名项目")).toBe(false);
  });

  it("用户命名过的空画布不算空草稿", () => {
    expect(isEmptyDraftName("空白灵感板")).toBe(false);
    expect(isEmptyDraftName("")).toBe(false);
    expect(isEmptyDraftName(undefined)).toBe(false);
  });
});

describe("reapEmptyProject", () => {
  it("默认名 + 零节点零边 → 回收", () => {
    seed([{ id: "p1", name: "未命名", updatedAt: 1, nodes: [], edges: [] }]);
    expect(reapEmptyProject("p1")).toBe(true);
    expect(listProjects()).toHaveLength(0);
  });

  it("旧版 legacy 默认名不再被回收（仅当前默认名是哨兵）", () => {
    seed([
      { id: "p1", name: "未命名项目", updatedAt: 1, nodes: [], edges: [] },
    ]);
    expect(reapEmptyProject("p1")).toBe(false);
    expect(listProjects()).toHaveLength(1);
  });

  it("已被用户命名的空画布不被回收（刻意保存的空白板）", () => {
    seed([
      { id: "p1", name: "空白灵感板", updatedAt: 1, nodes: [], edges: [] },
    ]);
    expect(reapEmptyProject("p1")).toBe(false);
    expect(listProjects()).toHaveLength(1);
  });

  it("有节点或有边就不回收（哪怕名字还是默认名）", () => {
    seed([
      {
        id: "p1",
        name: "未命名",
        updatedAt: 1,
        nodes: [{ id: "n1" }],
        edges: [],
      },
    ]);
    expect(reapEmptyProject("p1")).toBe(false);
  });

  it("不存在的 id 返回 false", () => {
    expect(reapEmptyProject("nope")).toBe(false);
  });
});

describe("reapAllEmptyDrafts", () => {
  it("只清默认的空草稿，返回清理条数", () => {
    seed([
      { id: "p1", name: "未命名", updatedAt: 3, nodes: [], edges: [] },
      { id: "p2", name: "我的项目", updatedAt: 2, nodes: [], edges: [] },
      { id: "p3", name: "未命名项目", updatedAt: 1, nodes: [], edges: [] },
    ]);
    // p1 当前哨兵被清；p3 legacy 名已不识别，保留
    expect(reapAllEmptyDrafts()).toBe(1);
    expect(listProjects().map((p) => p.id)).toEqual(["p2", "p3"]);
  });

  it("没有可清理项时不写 localStorage（避免无谓的 changed 事件）", () => {
    seed([{ id: "p1", name: "我的项目", updatedAt: 1, nodes: [], edges: [] }]);
    const setItem = vi.spyOn(localStorage, "setItem");
    expect(reapAllEmptyDrafts()).toBe(0);
    expect(setItem).not.toHaveBeenCalled();
  });
});

/* ISSUE #1501：回收的两条闸都不许碰「用户此刻站着的那个项目」。
 *
 * 首页「新建画布项目」走的 `createProject` 会立刻落一行
 *「零节点零连线 + 名字 = 未命名」的索引 —— 它**正好命中**空草稿哨兵，
 * 于是刷新时被 `reapAllEmptyDrafts`（workspace 页面挂载即调）清掉，
 * active-id 跟着被清，`openableViews` 就不再列那六个项目页签。
 * 用户视角是「刚点完新建、刷新一下就被踢出项目」。
 *
 * 「它是不是空草稿」与「它能不能删」是两件事：前者如实为真，
 * 后者必须再看一眼它是不是当前活跃项目。 */
describe("活跃项目不可回收（ISSUE #1501）", () => {
  it("reapAllEmptyDrafts 不动活跃项目，也不清 active-id", () => {
    const live = createProject();
    expect(getActiveId()).toBe(live.id);

    expect(reapAllEmptyDrafts()).toBe(0);

    expect(getActiveId()).toBe(live.id);
    expect(listProjects().map((p) => p.id)).toEqual([live.id]);
  });

  it("同一批里非活跃的空草稿照旧被清（新闸没把回收关掉）", () => {
    seed([{ id: "stale", name: "未命名", updatedAt: 1, nodes: [], edges: [] }]);
    const live = createProject();
    /* `createProject` 会把 active 指到它自己，这里挪开 —— 好让上面那行
     * 陈旧草稿成为「非活跃」的，从而落进清扫范围。 */
    setActive("other");

    expect(reapAllEmptyDrafts()).toBe(1);
    expect(listProjects().map((p) => p.id)).toEqual([live.id]);
    /* active 指向一条索引里没有的悬空 id → 顺手清掉（原有行为不变） */
    expect(getActiveId()).toBe(null);
  });

  it("reapEmptyProject 对活跃项目返回 false（不删、不清 active）", () => {
    const live = createProject();
    expect(reapEmptyProject(live.id)).toBe(false);
    expect(getActiveId()).toBe(live.id);
    expect(listProjects().map((p) => p.id)).toEqual([live.id]);
  });

  it("createDraftProject 造的草稿本来就不在索引里，清扫碰不到它", () => {
    const draft = createDraftProject();
    expect(reapAllEmptyDrafts()).toBe(0);
    expect(getActiveId()).toBe(draft.id);
    expect(listProjects()).toHaveLength(0);
  });
});

/* 清扫不能只在本地删 —— 否则每清一条，服务端就攒下一行再也指不回的记录
 *（界面读的是客户端索引 `projects.v1`，不是 `project` 表）。ISSUE #1501 里
 * 那几行 `未命名` / `未命名_2` / `未命名_3` 就是这么来的。 */
describe("清扫要连服务端一起删（ISSUE #1501 的孤儿行）", () => {
  it("reapAllEmptyDrafts 对每条被清的空草稿发一次删除", async () => {
    seed([
      { id: "d1", name: "未命名", updatedAt: 3, nodes: [], edges: [] },
      { id: "d2", name: "未命名", updatedAt: 2, nodes: [], edges: [] },
      { id: "keep", name: "我的项目", updatedAt: 1, nodes: [], edges: [] },
    ]);
    setActive("keep");

    expect(reapAllEmptyDrafts()).toBe(2);
    await settled();

    expect(projectDeleteMutate.mock.calls.map((call) => call[0])).toEqual([
      { projectId: "d1" },
      { projectId: "d2" },
    ]);
  });

  it("没有可清的就一条删除都不发", async () => {
    seed([
      { id: "keep", name: "我的项目", updatedAt: 1, nodes: [], edges: [] },
    ]);
    setActive("keep");
    expect(reapAllEmptyDrafts()).toBe(0);
    await settled();
    expect(projectDeleteMutate).not.toHaveBeenCalled();
  });
});

describe("findNextAvailableName", () => {
  it("名字空闲就原样返回", () => {
    seed([{ id: "p1", name: "灵感", updatedAt: 1, nodes: [], edges: [] }]);
    expect(findNextAvailableName("草稿")).toBe("草稿");
  });

  it("重名时按 _2 / _3 递增", () => {
    seed([
      { id: "p1", name: "未命名", updatedAt: 2, nodes: [], edges: [] },
      { id: "p2", name: "未命名_2", updatedAt: 1, nodes: [], edges: [] },
    ]);
    expect(findNextAvailableName("未命名")).toBe("未命名_3");
  });

  it("base 本身以 _<n> 结尾时仍能找到空位（不会自撞）", () => {
    seed([{ id: "p1", name: "灵感_3", updatedAt: 1, nodes: [], edges: [] }]);
    expect(findNextAvailableName("灵感_3")).toBe("灵感_3_2");
  });

  it("空白 base 回落到默认名", () => {
    expect(findNextAvailableName("   ")).toBe("未命名");
  });

  it("excludeId 让重命名时的自撞不成问题", () => {
    seed([{ id: "p1", name: "灵感", updatedAt: 1, nodes: [], edges: [] }]);
    expect(isProjectNameTaken("灵感", "p1")).toBe(false);
    expect(isProjectNameTaken("灵感")).toBe(true);
  });
});

describe("getAllProjectNames", () => {
  it("按 trim 后的名字去重", () => {
    seed([
      { id: "p1", name: "灵感", updatedAt: 2, nodes: [], edges: [] },
      { id: "p2", name: "  灵感  ", updatedAt: 1, nodes: [], edges: [] },
    ]);
    expect([...getAllProjectNames()]).toEqual(["灵感"]);
  });
});

describe("createProject / createDraftProject", () => {
  it("createProject 立即入索引并设为 active", () => {
    const p = createProject("我的画布");
    expect(getProject(p.id)?.name).toBe("我的画布");
    expect(localStorage.getItem("comfyapp.canvas.active.v1")).toBe(p.id);
  });

  it("重名时自动加后缀，不会覆盖已有项目", () => {
    const first = createProject("未命名");
    const second = createProject("未命名");
    expect(second.id).not.toBe(first.id);
    expect(second.name).toBe("未命名_2");
    expect(listProjects()).toHaveLength(2);
  });

  it("createDraftProject 只设 active，不进索引（避免空草稿污染最近项目）", () => {
    const draft = createDraftProject();
    expect(listProjects()).toHaveLength(0);
    expect(localStorage.getItem("comfyapp.canvas.active.v1")).toBe(draft.id);
    expect(getProject(draft.id)).toBeNull();
  });

  it("listProjects 按 updatedAt 倒序", () => {
    seed([
      { id: "old", name: "旧", updatedAt: 100, nodes: [], edges: [] },
      { id: "new", name: "新", updatedAt: 200, nodes: [], edges: [] },
    ]);
    expect(listProjects().map((p) => p.id)).toEqual(["new", "old"]);
  });
});

describe("hydrateFromServer", () => {
  it("服务端 updatedAt 更新时覆盖本地，并落盘", async () => {
    seed([{ id: "p1", name: "本地旧", updatedAt: 100, nodes: [], edges: [] }]);
    projectListQuery.mockResolvedValue([
      {
        id: "p1",
        name: "服务端新",
        updatedAt: new Date(500),
        nodes: [],
        edges: [],
      },
    ]);

    await hydrateFromServer();
    // 时间相同（500 >= 100）→ 服务端胜出
    const merged = getProject("p1");
    expect(merged?.name).toBe("服务端新");
    expect(merged?.updatedAt).toBe(500);
  });

  it("本地更新时保留本地副本，不倒退", async () => {
    seed([{ id: "p1", name: "本地新", updatedAt: 900, nodes: [], edges: [] }]);
    projectListQuery.mockResolvedValue([
      {
        id: "p1",
        name: "服务端旧",
        updatedAt: new Date(500),
        nodes: [],
        edges: [],
      },
    ]);
    await hydrateFromServer();
    expect(getProject("p1")?.name).toBe("本地新");
  });

  it("拉取失败不抛错（local-first：本地数据不能因为网络问题丢）", async () => {
    seed([{ id: "p1", name: "本地", updatedAt: 1, nodes: [], edges: [] }]);
    projectListQuery.mockRejectedValue(new Error("offline"));
    await expect(hydrateFromServer()).resolves.toBeUndefined();
    expect(listProjects()).toHaveLength(1);
  });
});

describe("服务端镜像的失败出口", () => {
  /* 这一组只判「登记了什么状态」，日志那一半由 `sync-notice.test.ts` 判；
   * 不静音的话每个用例都会往转录里写几行 warn。 */
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("被拒（项目 id 属于别人）→ 登记成一条可查的拒收，本地索引照常写入", async () => {
    projectUpsertMutate.mockImplementation(() => {
      throw trpcError("FORBIDDEN", "该项目 id 已属于其他用户，不能覆盖");
    });
    upsertProject({
      id: "proj_m1",
      name: "灵感板",
      updatedAt: 1,
      nodes: [],
      edges: [],
    });
    await settled();

    /* 提示按码翻成人话（原文另有日志那一行），这里判的是「这条状态存在且说得清」 */
    expect(noticesFor("proj_m1")).toHaveLength(1);
    expect(noticesFor("proj_m1")[0]).toContain("已经属于别的用户");
    /* 本地优先的语义没变：被服务端拒 ≠ 把用户的画布从本地索引里删掉。 */
    expect(getProject("proj_m1")?.name).toBe("灵感板");
  });

  it("离线 / 服务端在重启 → 不打扰用户，但留一行日志", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    projectUpsertMutate.mockImplementation(() => {
      throw new Error("Failed to fetch");
    });
    upsertProject({
      id: "proj_m2",
      name: "A",
      updatedAt: 1,
      nodes: [],
      edges: [],
    });
    await settled();

    expect(noticesFor("proj_m2")).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("下一轮同步成功 → 那条拒收撤掉（用户照着提示改完名字不该还剩一条红）", async () => {
    projectUpsertMutate.mockImplementationOnce(() => {
      throw trpcError("FORBIDDEN", "该项目 id 已属于其他用户");
    });
    upsertProject({
      id: "proj_m3",
      name: "A",
      updatedAt: 1,
      nodes: [],
      edges: [],
    });
    await settled();
    expect(noticesFor("proj_m3")).toHaveLength(1);

    upsertProject({
      id: "proj_m3",
      name: "我的灵感板",
      updatedAt: 2,
      nodes: [],
      edges: [],
    });
    await settled();
    expect(noticesFor("proj_m3")).toHaveLength(0);
  });

  it("删除被服务端拒收 → 说的是「没能从服务端删掉」，不是「同步失败」", async () => {
    seed([
      { id: "proj_m4", name: "该删的", updatedAt: 1, nodes: [], edges: [] },
    ]);
    projectDeleteMutate.mockImplementationOnce(() => {
      throw trpcError("UNAUTHORIZED", "会话已失效");
    });
    deleteProject("proj_m4");
    await settled();

    expect(noticesFor("proj_m4")).toHaveLength(1);
    /* 后果与「没能存进去」不同：本机已经删了、服务端还留着，
     * 换端口时它会再冒出来 —— 文案必须说得出这一句。 */
    expect(noticesFor("proj_m4")[0]).toContain("没能从服务端删掉");
    expect(listProjects().map((project) => project.id)).not.toContain(
      "proj_m4",
    );
  });

  it("重复的自动保存只留一条拒收（每 500ms 撞一次不许刷出一串提示）", async () => {
    projectUpsertMutate.mockImplementation(() => {
      throw trpcError("FORBIDDEN", "该项目 id 已属于其他用户");
    });
    const p = {
      id: "proj_m5",
      name: "A",
      updatedAt: 1,
      nodes: [],
      edges: [],
    };
    upsertProject(p);
    upsertProject(p);
    upsertProject(p);
    await settled();
    expect(noticesFor("proj_m5")).toHaveLength(1);
  });
});

describe("setActive", () => {
  it("写入 active key", () => {
    setActive("p-x");
    expect(localStorage.getItem("comfyapp.canvas.active.v1")).toBe("p-x");
  });
});

/* ── ISSUE #1522：服务端独有行的可见性与删除入口 ────────────────────────
 *
 * 现场：`project` 表里有 4 行 `未命名*`，而「所有项目」那一屏显示「还没有画布
 * 项目」—— 那一屏只读客户端索引，服务端独有行既看不见、也没有任何删除入口。
 * 下面这几条守的是那两句新承诺：**并集可见** + **索引里没有也删得掉**。
 */
describe("listProjectsWithServer（并集 + 出处标注）", () => {
  it("服务端独有行也在列表里，标 origin=server", async () => {
    seed([
      { id: "proj_local", name: "本地的", updatedAt: 2, nodes: [], edges: [] },
    ]);
    projectListQuery.mockResolvedValue([
      { id: "proj_orphan", name: "未命名", updatedAt: 3, nodes: [], edges: [] },
    ]);
    const { entries, ok } = await listProjectsWithServer();
    expect(ok).toBe(true);
    expect(entries.map((entry) => entry.id)).toEqual([
      "proj_orphan",
      "proj_local",
    ]);
    expect(entries.find((e) => e.id === "proj_orphan")?.origin).toBe("server");
    expect(entries.find((e) => e.id === "proj_local")?.origin).toBe("local");
  });

  it("两侧都有的同一 id 只出现一行，取较新的一侧，标 origin=both", async () => {
    seed([
      { id: "proj_both", name: "旧的", updatedAt: 1, nodes: [], edges: [] },
    ]);
    projectListQuery.mockResolvedValue([
      { id: "proj_both", name: "新的", updatedAt: 9, nodes: [], edges: [] },
    ]);
    const { entries } = await listProjectsWithServer();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("新的");
    expect(entries[0]?.origin).toBe("both");
  });

  it("本地更新时以本地为准（不把用户刚改的名字冲回去）", async () => {
    seed([
      { id: "proj_b", name: "我刚改的", updatedAt: 9, nodes: [], edges: [] },
    ]);
    projectListQuery.mockResolvedValue([
      { id: "proj_b", name: "服务端旧的", updatedAt: 1, nodes: [], edges: [] },
    ]);
    const { entries } = await listProjectsWithServer();
    expect(entries[0]?.name).toBe("我刚改的");
    expect(entries[0]?.origin).toBe("both");
  });

  it("拉不到服务端时 ok=false 且照常列本地项目（不是空列表）", async () => {
    seed([
      { id: "proj_off", name: "离线也有", updatedAt: 1, nodes: [], edges: [] },
    ]);
    projectListQuery.mockRejectedValue(new Error("ECONNREFUSED"));
    const { entries, ok } = await listProjectsWithServer();
    expect(ok).toBe(false);
    expect(entries.map((entry) => entry.id)).toEqual(["proj_off"]);
  });
});

describe("deleteProjectEverywhere（索引里没有那一行也删得掉）", () => {
  it("只存在于服务端的行：删服务端那一份（这正是 #1522 缺的那个口子）", async () => {
    projectDeleteMutate.mockResolvedValue({ ok: true });
    deleteProjectEverywhere("proj_orphan", "未命名");
    await settled();
    expect(projectDeleteMutate).toHaveBeenCalledWith({
      projectId: "proj_orphan",
    });
  });

  it("索引里有这行时走既有出口：本地清掉 + 服务端也删", async () => {
    seed([
      { id: "proj_has", name: "有的", updatedAt: 1, nodes: [], edges: [] },
    ]);
    projectDeleteMutate.mockResolvedValue({ ok: true });
    deleteProjectEverywhere("proj_has", "有的");
    await settled();
    expect(listProjects()).toHaveLength(0);
    expect(projectDeleteMutate).toHaveBeenCalledWith({ projectId: "proj_has" });
  });

  it("删服务端独有行时，悬空的 active-id 一并清掉", () => {
    setActive("proj_orphan");
    projectDeleteMutate.mockResolvedValue({ ok: true });
    deleteProjectEverywhere("proj_orphan", "未命名");
    expect(getActiveId()).toBeNull();
  });

  it("服务端拒收 → 说的是「没能从服务端删掉」，不是静默", async () => {
    projectDeleteMutate.mockImplementationOnce(() => {
      throw trpcError("FORBIDDEN", "不属于当前用户");
    });
    deleteProjectEverywhere("proj_orphan", "未命名");
    await settled();
    expect(noticesFor("proj_orphan")[0]).toContain("没能从服务端删掉");
  });
});
