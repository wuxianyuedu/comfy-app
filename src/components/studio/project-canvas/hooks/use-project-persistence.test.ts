// @vitest-environment jsdom
/**
 * 「镜像被拒」那条提示的用户可见出口。
 *
 * 存储侧（`canvas-store` 把失败登记进 `sync-notice`）已有用例；这里判的是
 * **提示真的会打到用户脸上**，而且是硬规则 4 那一句的两半：
 *   · 挂载时就先读一次状态 —— 写镜像的入口不止这一页（工作区首页新建、画廊删除），
 *     而那些页面上没有提示器；那一次的广播没人接且不排队重放。只订阅不读表的写法
 *     会**在这里红**，而不是等用户换端口发现画布是空的。
 *   · 同一句原因只说一次 —— 自动保存每 500ms 撞一次，不去重就是刷屏。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  update: vi.fn(),
  dismiss: vi.fn(),
  toast: vi.fn(),
};

vi.mock("~/components/studio/ToastProvider", () => ({ useToast: () => toast }));

/* 本文件只管拒收提示那一段；落盘三件套（防抖 / mutation / beforeunload）
 * 的写盘动作在这里必须是空气，否则每个用例都会真的发一次镜像请求。 */
vi.mock("~/lib/project-canvas/canvas-store", () => ({
  upsertProject: vi.fn(),
  clearActiveIfDraft: vi.fn(),
  isEmptyDraftName: vi.fn(() => false),
  reapEmptyProject: vi.fn(),
}));

import { recordSyncFailure } from "~/lib/project-canvas/sync-notice";
import { useProjectPersistence } from "./use-project-persistence";

function args() {
  return {
    projectId: "proj_toast",
    nodes: [],
    edges: [],
    projectName: "灵感板",
    loaded: true,
  };
}

function refusal(
  id: string,
  name: string,
  message: string,
  code = "FORBIDDEN",
): void {
  recordSyncFailure(
    "这份画布没能存进服务端",
    { id, name },
    Object.assign(new Error(message), {
      data: { code },
      shape: { message, code },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  /* 拒收那一条诊断日志由 `sync-notice.test.ts` 判；这里只判提示有没有打到脸上。 */
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 登记表是模块级单例（它的语义就是「这一页还活着的拒收」），用例之间会互相看见。
 *  所以断言一律按**本用例那条画布的名字**筛调用，而不是比全局次数 ——
 *  比次数会把「上一条用例留的记录在挂载时被读出来」算成这条用例的失败。 */
function errorCallsMentioning(name: string): unknown[][] {
  return toast.error.mock.calls.filter((call) =>
    String(call[0]).includes(name),
  );
}

describe("镜像被拒的提示", () => {
  it("挂载时表里已经有一条 → 立刻提示（拒收可能发生在根本没挂提示器的页面上）", () => {
    refusal("proj_toast_a", "甲板", "该项目 id 已属于其他用户");
    /* 本仓库没有配 RTL 的自动 cleanup（`vitest.config.ts` 里没有），所以每个用例
     * 都要自己 `unmount()` —— 否则上一个用例的监听器还挂在 `window` 上，
     * 下一条拒收会被弹三次，而表现完全是「去重坏了」的样子。 */
    const { unmount } = renderHook(() => useProjectPersistence(args()));

    const calls = errorCallsMentioning("甲板");
    expect(calls).toHaveLength(1);
    const [title, detail, duration] = calls[0] ?? [];
    /* 用户认得出的是名字，不是 `proj_1727…`。 */
    expect(title).toContain("甲板");
    expect(title).toContain("没有同步到服务端");
    /* 正文是**按码翻好的人话**（服务端原文另有日志那一行）：
     * 于是同一码的两次拒收（哪怕服务端文案不同）说得是同一句，
     * 而那句必须给出下一步 —— 「改个名字另存一份」。 */
    expect(String(detail)).toContain("已经属于别的用户");
    /* 这句话是要照着做的，不能按默认 3.2s 收起。 */
    expect(duration).toBeGreaterThan(3200);
    unmount();
  });

  it("挂载之后新出现的拒收靠广播提示，同一条原因不重复刷屏", () => {
    const { rerender, unmount } = renderHook(() =>
      useProjectPersistence(args()),
    );
    expect(errorCallsMentioning("乙板")).toHaveLength(0);

    refusal("proj_toast_b", "乙板", "该项目 id 已属于其他用户");
    rerender();
    expect(errorCallsMentioning("乙板")).toHaveLength(1);

    /* 自动保存再撞一次：登记表返回「没变化」⇒ 不广播 ⇒ 读侧不该再多弹一条。
     * 这一条判的是去重，而去重要在两处都成立（登记表 + 读侧的已提示集合）。 */
    refusal("proj_toast_b", "乙板", "该项目 id 已属于其他用户");
    rerender();
    expect(errorCallsMentioning("乙板")).toHaveLength(1);
    unmount();
  });

  it("说法变了要再说一次（同一条画布换了另一种拒收原因）", () => {
    const { rerender, unmount } = renderHook(() =>
      useProjectPersistence(args()),
    );
    refusal("proj_toast_c", "丙板", "该项目 id 已属于其他用户");
    rerender();
    expect(errorCallsMentioning("丙板")).toHaveLength(1);

    /* 换成 `UNAUTHORIZED`：翻出来的是另一句、给的是另一个下一步
     * （「重新登录」而不是「改名」），所以必须重新说一次。
     * 反过来说，同一码的两次拒收说得是同一句话 —— 那才是上面那条不刷屏的原因。 */
    refusal("proj_toast_c", "丙板", "会话已失效", "UNAUTHORIZED");
    rerender();
    const calls = errorCallsMentioning("丙板");
    expect(calls).toHaveLength(2);
    expect(String(calls[1]?.[1])).toContain("重新登录");
    unmount();
  });
});
