// @vitest-environment jsdom
/**
 * 「在浏览器里持久一件小事」的口径（规范 16 §16.2.4.28）。
 *
 * 这条账的形状与 `list-filter` 同族：**不是重复代码，是判据** —— 全库十余处
 * 各写一遍「读 localStorage」，而它们对**怎么判「没有浏览器」**各判各的：
 * 一种是 `typeof window === "undefined"`、一种是 `typeof localStorage ===
 * "undefined"`、还有一种是干脆不判只靠 try/catch —— 三套同时存在，
 * 在 SSR、jsdom、隐私模式下行为不同。
 *
 * 所以用例逐个钉住这五件事：
 *   1. SSR（没有 window）→ 读 `null` / 写 `false` / 不抛；
 *   2. 正常读写走通；
 *   3. **写失败（配额满 / 隐私模式）静默且返回 false**（记忆是增强不是功能）；
 *   4. **坏数据与「没存过」都回落默认值**（不抛）；
 *   5. **「键不存在」与「存过 `null`」分得开**（判据是 `getItem` 的返回值，
 *      不是解析结果）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasBrowserStorage,
  readStorageItem,
  readStorageJson,
  removeStorageItem,
  writeStorageItem,
  writeStorageJson,
} from "./browser-storage";

const KEY = "comfyapp:test:v1";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("hasBrowserStorage", () => {
  it("有 window 与 localStorage 时为 true", () => {
    expect(hasBrowserStorage()).toBe(true);
  });

  it("localStorage 被策略禁用（访问即抛）时为 false，不把异常冒出去", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("SecurityError");
      },
    });
    try {
      expect(hasBrowserStorage()).toBe(false);
      /* 读 / 写 / 删在这一形态下同样静默 —— 三条路径都要过 `hasBrowserStorage`。 */
      expect(readStorageItem(KEY)).toBeNull();
      expect(writeStorageItem(KEY, "x")).toBe(false);
      expect(removeStorageItem(KEY)).toBe(false);
    } finally {
      if (original) Object.defineProperty(window, "localStorage", original);
    }
  });
});

describe("读 / 写 / 删", () => {
  it("写进去能读出来（返回 true）", () => {
    expect(writeStorageItem(KEY, "值")).toBe(true);
    expect(readStorageItem(KEY)).toBe("值");
  });

  it("没存过读回 null", () => {
    expect(readStorageItem("comfyapp:never:v1")).toBeNull();
  });

  it("删掉之后读回 null", () => {
    writeStorageItem(KEY, "x");
    expect(removeStorageItem(KEY)).toBe(true);
    expect(readStorageItem(KEY)).toBeNull();
  });

  it("写失败（配额满）静默并返回 false，不抛", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    expect(writeStorageItem(KEY, "x")).toBe(false);
    expect(readStorageItem(KEY)).toBeNull();
  });

  it("读失败（被策略拒）回落 null，不抛", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("SecurityError");
    });
    expect(readStorageItem(KEY)).toBeNull();
  });
});

describe("JSON 键", () => {
  it("正常往返", () => {
    expect(writeStorageJson(KEY, { a: 1 })).toBe(true);
    expect(readStorageJson(KEY, null)).toEqual({ a: 1 });
  });

  it("坏数据回落默认值（不抛）", () => {
    writeStorageItem(KEY, "{ 不是 JSON");
    expect(readStorageJson(KEY, { fallback: true })).toEqual({
      fallback: true,
    });
  });

  it("「没存过」回落默认值；**存过 `null` 就是 `null`**（那是合法 JSON 值）", () => {
    /* 判据取 `getItem` 的返回值，不是解析结果 —— 所以「键不存在」与
     * 「键存在且值为 `null`」能被分开。这与调用处要的不冲突：
     * 所有用 JSON 的落点存的都是对象 / 数组，`null` 从来不是它们的合法载荷。 */
    expect(readStorageJson("comfyapp:never2:v1", "默认")).toBe("默认");
    writeStorageJson(KEY, null);
    expect(readStorageJson(KEY, "默认")).toBeNull();
  });

  it("窄化函数给了就用它；它抛出也回落默认值", () => {
    writeStorageItem(KEY, "42");
    expect(readStorageJson(KEY, 0, (raw) => Number.parseInt(raw, 10))).toBe(42);

    writeStorageItem(KEY, "不是数字");
    expect(
      readStorageJson(KEY, -1, () => {
        throw new Error("窄化失败");
      }),
    ).toBe(-1);
  });
});
