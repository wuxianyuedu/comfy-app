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
 *      不是解析结果）；
 *   6. **cookie 那条通道**：属性串三件齐全（编码 / `path=/` / 显式 `max-age`），
 *      因为没有 document 与服务端读不到这两种坏法长得完全不同。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  hasBrowserStorage,
  readStorageItem,
  readStorageJson,
  removeStorageItem,
  writeCookieItem,
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

  it("删失败（配额之外的另一档）静默 false，且键**确实还在**", () => {
    /* 配对断言：只断 `false` 的话，「其实已经删掉了但返回 false」这种坏法照样绿。
     * 这一档此前没执行者 —— 门槛注释里那句「删失败只有 Safari 隐私模式那一种现场」
     * 只对「访问即抛」成立，`removeItem` 单独被拒是另一条分支。 */
    writeStorageItem(KEY, "留着");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("NotAllowedError");
    });
    expect(removeStorageItem(KEY)).toBe(false);
    expect(readStorageItem(KEY)).toBe("留着");
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

/* ── cookie 那条通道（服务端首屏读得到，所以属性串是对外承诺）─────────────
 * `writeCookieItem` 的全部意义在**那三件属性**：`path=/` 决定 layout 那侧
 * `cookies()` 读不读得到，`max-age` 决定关窗之后还在不在，编码决定值里带
 * `;` / `=` / 空格时会不会把属性串劫持掉。少任何一件都不报错，只是行为变了，
 * 而界面上一切照常 —— 所以这里按**原文**判，而不是判「浏览器里存下了」。 */
describe("writeCookieItem", () => {
  /** 拦下写入的原文（jsdom 真存一份是另一条用例的事）。 */
  function captureCookieWrite(body: () => void): string[] {
    const written: string[] = [];
    const original =
      Object.getOwnPropertyDescriptor(document, "cookie") ??
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(document),
        "cookie",
      );
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set(value: string) {
        written.push(value);
      },
    });
    try {
      body();
    } finally {
      if (original) {
        Object.defineProperty(document, "cookie", original);
      } else {
        Reflect.deleteProperty(document, "cookie");
      }
    }
    return written;
  }

  it("写出的是 name=编码值; path=/; max-age=<秒> 三件齐全", () => {
    const [raw] = captureCookieWrite(() =>
      writeCookieItem("comfyapp:sidebar", "open", 3600),
    );
    expect(raw).toBe("comfyapp:sidebar=open; path=/; max-age=3600");
  });

  it("值里带分号与等号时必须编码，不能劫持属性串", () => {
    /* 不编码的写法（`name=value; path=/`）在 `value = "a; path=/evil"` 时
     * 会写出一条带第二个 path 的 cookie —— 浏览器取最后一份，服务端读到的
     * 就不是本应用那条了。 */
    const [raw] = captureCookieWrite(() =>
      writeCookieItem("k", "a; path=/evil =x", 60),
    );
    expect(raw).toBe("k=a%3B%20path%3D%2Fevil%20%3Dx; path=/; max-age=60");
    expect(raw?.split(";")).toHaveLength(3);
  });

  it("有效期是显式给的（不给 = 会话级、关窗即忘，所以这一件必须出现在串里）", () => {
    const [raw] = captureCookieWrite(() => writeCookieItem("k", "v", 0));
    expect(raw).toContain("max-age=0");
  });

  it("jsdom 真存得下来（证明写出的是一条合法 cookie，而不是只能自测的字符串）", () => {
    expect(writeCookieItem("comfyapp:saved", "yes", 120)).toBe(true);
    expect(document.cookie).toContain("comfyapp:saved=yes");
  });

  it("没有 document（SSR）→ false 且不抛", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "document");
    Reflect.deleteProperty(globalThis, "document");
    try {
      expect(writeCookieItem("k", "v", 10)).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, "document", original);
    }
  });

  it("写入被拒（setter 抛）→ 静默 false，与 localStorage 那档同口径", () => {
    const original = Object.getOwnPropertyDescriptor(document, "cookie");
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set() {
        throw new DOMException("NotAllowedError");
      },
    });
    try {
      expect(writeCookieItem("k", "v", 10)).toBe(false);
    } finally {
      if (original) Object.defineProperty(document, "cookie", original);
    }
  });
});
