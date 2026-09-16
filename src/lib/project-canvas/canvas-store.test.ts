// @vitest-environment jsdom
// 项目画布的本地索引（localStorage）+ 服务端镜像策略单测。
// 覆盖三条容易回归的规则：
//   1. 空草稿名哨兵（当前默认名 "未命名"）决定要不要被回收；
//   2. 被用户命名过的空画布**不能**被回收（用户刻意保存的空灵感板）；
//   3. findNextAvailableName 在 base 本身以 "_<n>" 结尾时不会死循环。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectListQuery = vi.fn();
const projectUpsertMutate = vi.fn();
const projectDeleteMutate = vi.fn();

vi.mock("~/trpc/vanilla", () => ({
  vanillaApi: {
    project: {
      list: {
        query: (...args: unknown[]) => projectListQuery(...args) as never,
      },
      upsert: {
        mutate: (...args: unknown[]) =>
          Promise.resolve(projectUpsertMutate(...args)),
      },
      delete: {
        mutate: (...args: unknown[]) =>
          Promise.resolve(projectDeleteMutate(...args)),
      },
    },
  },
}));

import {
  EMPTY_DRAFT_NAMES,
  createDraftProject,
  createProject,
  findNextAvailableName,
  getAllProjectNames,
  getProject,
  hydrateFromServer,
  isEmptyDraftName,
  isProjectNameTaken,
  listProjects,
  reapAllEmptyDrafts,
  reapEmptyProject,
  setActive,
} from "./canvas-store";

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

describe("setActive", () => {
  it("写入 active key", () => {
    setActive("p-x");
    expect(localStorage.getItem("comfyapp.canvas.active.v1")).toBe("p-x");
  });
});
