// 首页模型概览的推导：一块只有判断力的界面，就把它全部钉在纯函数上。
//
// 四条判据各有其所以然：
//   · 空目录不列，但要给出「有几个目录是空的」—— 全空时界面不能看起来像没做；
//   · 按数量降序，而不是按目录名字母序 —— 这块要回答的是「我主要在用些什么」；
//   · 首帧是 loading 不是 error —— 否则每次冷启动都会闪一句「读不到」；
//   · total 只加有模型的那些，与列出的行是同一个口径 —— 两处口径不一致时
//     「共 N 个」会和下面的行数对不上，正是本仓库反复栽过的那类自相矛盾。
import { describe, expect, it } from "vitest";

import { deriveModelOverview } from "./model-overview-derive";

function folder(folderName: string, label: string, count: number) {
  return { folder: folderName, label, count };
}

describe("deriveModelOverview 分组与排序", () => {
  it("按数量降序列出，且 total 与列出的行同口径", () => {
    const out = deriveModelOverview({
      folders: [
        folder("loras", "LoRA", 12),
        folder("checkpoints", "Checkpoint", 34),
        folder("vae", "VAE", 2),
      ],
      loading: false,
      isError: false,
    });
    expect(out.groups.map((g) => g.folder)).toEqual([
      "checkpoints",
      "loras",
      "vae",
    ]);
    expect(out.total).toBe(48);
    expect(out.emptyFolderCount).toBe(0);
  });

  it("空目录不进列表，但计入 emptyFolderCount", () => {
    const out = deriveModelOverview({
      folders: [
        folder("checkpoints", "Checkpoint", 5),
        folder("sam", "SAM", 0),
        folder("gligen", "GLIGEN", 0),
      ],
      loading: false,
      isError: false,
    });
    expect(out.groups.map((g) => g.folder)).toEqual(["checkpoints"]);
    expect(out.emptyFolderCount).toBe(2);
    expect(out.total).toBe(5);
  });

  it("一个模型都没有：列表为空、total 为 0，且不报错（这是「同步一下就有」的状态）", () => {
    const out = deriveModelOverview({
      folders: [folder("loras", "LoRA", 0)],
      loading: false,
      isError: false,
    });
    expect(out.groups).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.error).toBeNull();
  });

  it("0 与「没有这一档」不是一回事：count 缺失的行按 0 处理，不混进列表", () => {
    const out = deriveModelOverview({
      folders: [
        { folder: "a", label: "A", count: 1 },
        { folder: "b", label: "B" } as never,
      ],
      loading: false,
      isError: false,
    });
    expect(out.groups.map((g) => g.folder)).toEqual(["a"]);
    /* b 的 count 是 undefined → `> 0` 不成立，既不进列表也不该被算成空目录之外的数。 */
    expect(out.emptyFolderCount).toBe(1);
  });
});

describe("deriveModelOverview 的加载与失败态", () => {
  it("首帧（还没有数据、正在取）是 loading，不是 error", () => {
    const out = deriveModelOverview({
      folders: undefined,
      loading: true,
      isError: false,
    });
    expect(out.loading).toBe(true);
    expect(out.error).toBeNull();
    expect(out.groups).toEqual([]);
  });

  it("取数失败才给一句可见说明（硬规则 4：失败要有用户看得见的出口）", () => {
    const out = deriveModelOverview({
      folders: undefined,
      loading: false,
      isError: true,
    });
    expect(out.error).toBeTruthy();
    expect(out.error).toContain("读不到");
  });

  it("说明文案由本模块给，不接受调用方传进来的 Error 对象", () => {
    const out = deriveModelOverview({
      folders: undefined,
      loading: false,
      isError: true,
    });
    /* 两处各写一句错误文案，就会漂成「模型计数暂时读不到」与「加载失败」。 */
    expect(out.error).toBe("模型计数暂时读不到");
  });
});
