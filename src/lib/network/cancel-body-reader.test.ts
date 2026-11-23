// cancelBodyReader 的单测（ISSUE #4796 抽共享出口时的行为钉）：
// cancel 同步抛 / 异步拒都不外溢；releaseLock 恒被调；旧测试桩没有 cancel 也照常解锁。
import { describe, expect, it, vi } from "vitest";

import { cancelBodyReader } from "./cancel-body-reader";

describe("cancelBodyReader（ISSUE #4796）", () => {
  it("正常路径：cancel 与 releaseLock 都被调", () => {
    const cancel = vi.fn(() => Promise.resolve());
    const releaseLock = vi.fn();
    cancelBodyReader({ cancel, releaseLock });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("cancel 同步抛错不外溢，releaseLock 仍被调", () => {
    const cancel = vi.fn(() => {
      throw new Error("cancel 不可用");
    });
    const releaseLock = vi.fn();
    expect(() => {
      cancelBodyReader({ cancel, releaseLock });
    }).not.toThrow();
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("cancel 返回 rejected promise 不外溢（catch 兜底，无未处理拒绝）", async () => {
    const cancel = vi.fn(() => Promise.reject(new Error("已取消失败")));
    const releaseLock = vi.fn();
    cancelBodyReader({ cancel, releaseLock });
    /* 让微任务里的 .catch 跑完 —— 若兜底缺失，这里会以 Unhandled Rejection 形式炸掉。 */
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });

  it("旧测试桩没有 cancel 方法：照常 releaseLock", () => {
    const releaseLock = vi.fn();
    expect(() => {
      cancelBodyReader({ releaseLock });
    }).not.toThrow();
    expect(releaseLock).toHaveBeenCalledTimes(1);
  });
});
