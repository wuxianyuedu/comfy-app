// @vitest-environment jsdom
// 外观偏好的推导与持久化形状。核心判据不是"能不能存"，而是两条：
//   · 默认档必须与引入本功能之前**逐像素相同**（否则升级后老用户第一眼看到的就是变化）；
//   · 任何不认识的取值整份回落，不许"认哪个用哪个"（半份生效会让界面出现
//     圆角是新的、字号是旧的这种无法解释的组合）。
//
// 纯函数与存储往返写在同一份文件里：`src/lib` 根目录只认 `<name>.test.ts` 这一种
// 测试命名，点号命名的 `appearance.storage.test.ts` 会被判成裸模块。
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  DEFAULT_CODE_FONT,
  DEFAULT_INTERFACE_FONT,
  DEFAULT_TERMINAL_FONT,
  FONT_SCALE_STEPS,
  RADIUS_STEPS,
  appearanceVars,
  applyAppearance,
  fontStackForFamily,
  parseAppearance,
  primaryFontOf,
  readAppearance,
  registerUserFont,
  restoreUserFonts,
  saveAppearance,
  serializeAppearance,
  stackForPrimaryFont,
} from "./appearance";

/** 一个够用的假元素：只记录被设过的属性。 */
function fakeElement() {
  const store = new Map<string, string>();
  return {
    style: {
      setProperty: (name: string, value: string) => {
        store.set(name, value);
      },
    },
    store,
  };
}

describe("默认档 = 引入前的原值", () => {
  it("默认圆角就是 globals.css 里那个 1rem（卡片 16px）", () => {
    expect(appearanceVars(DEFAULT_APPEARANCE)["--radius"]).toBe("1rem");
  });

  it("默认字阶倍率是 1（不设置时与从前完全相同）", () => {
    expect(appearanceVars(DEFAULT_APPEARANCE)["--font-scale"]).toBe("1");
  });

  it("「中」与「标准 100%」就是各自档位表里的默认项", () => {
    expect(RADIUS_STEPS.find((s) => s.id === DEFAULT_APPEARANCE.radius)).toBeTruthy();
    expect(FONT_SCALE_STEPS.find((s) => s.id === DEFAULT_APPEARANCE.fontScale)?.value).toBe("1");
  });

  it("默认三档字体就是 globals.css 的原字体栈（与引入前逐字相同）", () => {
    const vars = appearanceVars(DEFAULT_APPEARANCE);
    expect(vars["--font-sans"]).toBe(DEFAULT_INTERFACE_FONT);
    expect(vars["--font-code"]).toBe(DEFAULT_CODE_FONT);
    expect(vars["--font-mono"]).toBe(DEFAULT_TERMINAL_FONT);
  });
});

describe("parseAppearance：字体档缺省/非法只回落该档", () => {
  it("字体字段缺失时用默认值、不连坐圆角与字阶", () => {
    const raw = JSON.stringify({ radius: "lg", fontScale: "110" });
    expect(parseAppearance(raw)).toEqual({
      radius: "lg",
      fontScale: "110",
      interfaceFont: DEFAULT_INTERFACE_FONT,
      codeFont: DEFAULT_CODE_FONT,
      terminalFont: DEFAULT_TERMINAL_FONT,
    });
  });

  it("字体字段为空串/null 时用默认值", () => {
    const raw = JSON.stringify({
      radius: "md",
      fontScale: "100",
      interfaceFont: "",
      codeFont: "  ",
      terminalFont: null,
    });
    const parsed = parseAppearance(raw);
    expect(parsed.interfaceFont).toBe(DEFAULT_INTERFACE_FONT);
    expect(parsed.codeFont).toBe(DEFAULT_CODE_FONT);
    expect(parsed.terminalFont).toBe(DEFAULT_TERMINAL_FONT);
  });

  it("字体字段合法时原样保留（自由字符串，不校验是否认得）", () => {
    const raw = JSON.stringify({
      radius: "md",
      fontScale: "100",
      interfaceFont: "Inter",
      codeFont: "IBM Plex Mono",
      terminalFont: "JetBrains Mono",
    });
    const parsed = parseAppearance(raw);
    expect(parsed.interfaceFont).toBe("Inter");
    expect(parsed.codeFont).toBe("IBM Plex Mono");
    expect(parsed.terminalFont).toBe("JetBrains Mono");
  });
});

describe("parseAppearance：不认就整份回落", () => {
  it.for([
    ["空值", null],
    ["undefined", undefined],
    ["坏 JSON", "{oops"],
    ["不是对象", "42"],
    ["缺字段", JSON.stringify({ radius: "lg" })],
    ["未知圆角", JSON.stringify({ radius: "huge", fontScale: "100" })],
    ["未知字阶", JSON.stringify({ radius: "md", fontScale: "999" })],
    ["字段类型不对", JSON.stringify({ radius: 8, fontScale: 1 })],
  ])("%s ⇒ 回落默认", (_row) => {
    const [, raw] = _row;
    expect(parseAppearance(raw)).toEqual(DEFAULT_APPEARANCE);
  });

  it("一半合法一半非法也整份回落（不许圆角新的、字号旧的）", () => {
    expect(parseAppearance(JSON.stringify({ radius: "xl", fontScale: "nope" }))).toEqual(
      DEFAULT_APPEARANCE,
    );
  });

  it("合法值原样读回", () => {
    const prefs = {
      radius: "lg",
      fontScale: "110",
      interfaceFont: DEFAULT_INTERFACE_FONT,
      codeFont: DEFAULT_CODE_FONT,
      terminalFont: DEFAULT_TERMINAL_FONT,
    };
    expect(parseAppearance(serializeAppearance(prefs))).toEqual(prefs);
  });
});

describe("applyAppearance", () => {
  it("一次写入五个变量（圆角 / 字阶 / 三档字体）", () => {
    const el = fakeElement();
    applyAppearance(
      {
        radius: "lg",
        fontScale: "125",
        interfaceFont: "Inter",
        codeFont: "IBM Plex Mono",
        terminalFont: "JetBrains Mono",
      },
      el,
    );
    expect(el.store.get("--radius")).toBe("1.25rem");
    expect(el.store.get("--font-scale")).toBe("1.25");
    expect(el.store.get("--font-sans")).toBe("Inter");
    expect(el.store.get("--font-code")).toBe("IBM Plex Mono");
    expect(el.store.get("--font-mono")).toBe("JetBrains Mono");
  });

  it("没有元素时是空操作（SSR 不炸）", () => {
    expect(() => {
      applyAppearance(DEFAULT_APPEARANCE, null);
    }).not.toThrow();
  });
});

describe("档位表本身", () => {
  it("每档都有非空标签与可直接写进 CSS 的值", () => {
    for (const step of [...RADIUS_STEPS, ...FONT_SCALE_STEPS]) {
      expect(step.label.trim().length).toBeGreaterThan(0);
      expect(step.value.trim().length).toBeGreaterThan(0);
      expect(step.id.trim().length).toBeGreaterThan(0);
    }
  });

  it("id 不重复（重复会让选中态指代不明）", () => {
    const radiusIds = RADIUS_STEPS.map((s) => s.id);
    const scaleIds = FONT_SCALE_STEPS.map((s) => s.id);
    expect(new Set(radiusIds).size).toBe(radiusIds.length);
    expect(new Set(scaleIds).size).toBe(scaleIds.length);
  });
});

/* ── 读写这一对走 ~/lib/browser-storage（localStorage 的唯一出口）──
   与上面的纯函数判据同属一个模块，合成一份文件：`src/lib` 根目录只认
   `<name>.test.ts` 这一种测试命名，点号命名的测试文件会被判成裸模块。 */
afterEach(() => {
  window.localStorage.clear();
});

describe("readAppearance / saveAppearance", () => {
  it("没有存过时给默认值", () => {
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("存进去能原样读回", () => {
    const prefs = {
      radius: "xl",
      fontScale: "90",
      interfaceFont: DEFAULT_INTERFACE_FONT,
      codeFont: DEFAULT_CODE_FONT,
      terminalFont: DEFAULT_TERMINAL_FONT,
    };
    expect(saveAppearance(prefs)).toBe(true);
    expect(readAppearance()).toEqual(prefs);
    expect(JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)!)).toEqual(prefs);
  });

  it("保存时同步写到 <html> 上（离开设置页也必须成立）", () => {
    saveAppearance({
      radius: "lg",
      fontScale: "110",
      interfaceFont: "Inter",
      codeFont: "IBM Plex Mono",
      terminalFont: "JetBrains Mono",
    });
    expect(document.documentElement.style.getPropertyValue("--radius")).toBe("1.25rem");
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.1");
    expect(document.documentElement.style.getPropertyValue("--font-sans")).toBe("Inter");
    expect(document.documentElement.style.getPropertyValue("--font-code")).toBe("IBM Plex Mono");
    expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe("JetBrains Mono");
  });

  it("存的是坏值时读回默认，且不抛", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "not-json");
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE);
  });
});

describe("fontStackForFamily", () => {
  it("界面档回退 sans-serif，代码 / 终端档回退 monospace", () => {
    expect(fontStackForFamily("Inter", "interface")).toBe("Inter, sans-serif");
    expect(fontStackForFamily("IBM Plex Mono", "code")).toBe('"IBM Plex Mono", monospace');
    expect(fontStackForFamily("JetBrains Mono", "terminal")).toBe('"JetBrains Mono", monospace');
  });

  it("含空格的 family 必须加引号（否则 CSS 把空格当分隔符）", () => {
    expect(fontStackForFamily("Sarasa UI SC", "interface")).toBe('"Sarasa UI SC", sans-serif');
    expect(fontStackForFamily("Fira Code", "code")).toBe('"Fira Code", monospace');
  });

  it("纯 ASCII 无空格的 family 不加引号", () => {
    expect(fontStackForFamily("Inter", "interface")).toBe("Inter, sans-serif");
    expect(fontStackForFamily("JetBrainsMono", "terminal")).toBe("JetBrainsMono, monospace");
  });
});

describe("primaryFontOf / stackForPrimaryFont（ISSUE #3784：每类只配一种字体）", () => {
  it("默认栈 → 首项为空串（输入框留空 = 未自定义）", () => {
    expect(primaryFontOf(DEFAULT_INTERFACE_FONT, "interface")).toBe("");
    expect(primaryFontOf(DEFAULT_CODE_FONT, "code")).toBe("");
    expect(primaryFontOf(DEFAULT_TERMINAL_FONT, "terminal")).toBe("");
  });

  it("自定义栈 → 首项就是用户配的那一种字体", () => {
    expect(primaryFontOf("Inter, sans-serif", "interface")).toBe("Inter");
    expect(primaryFontOf('"Sarasa UI SC", sans-serif', "interface")).toBe("Sarasa UI SC");
  });

  it("拼栈 = 用户字体在前，默认栈的其余回退原样跟在后面", () => {
    expect(stackForPrimaryFont("Inter", "interface")).toBe(
      'Inter, "Sarasa UI SC", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, -apple-system, sans-serif',
    );
    expect(stackForPrimaryFont("JetBrains Mono", "terminal")).toBe(
      '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", Consolas, "Sarasa Mono SC", monospace',
    );
  });

  it("拼栈与回读互逆：stackForPrimaryFont 的产物回读出同一种字体", () => {
    const stack = stackForPrimaryFont("IBM Plex Mono", "code");
    expect(primaryFontOf(stack, "code")).toBe("IBM Plex Mono");
  });
});

/** 一个够用的内存版 IndexedDB 桩：只实现本模块用到的 `open / transaction / put / getAll`。 */
function makeFakeIDB(store: Map<string, unknown>) {
  function open() {
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({}),
      transaction: () => {
        const tx: {
          objectStore: () => unknown;
          oncomplete: null | (() => void);
          onerror: null | (() => void);
        } = {
          objectStore: () => ({
            put: (record: { family: string }) => {
              store.set(record.family, record);
              queueMicrotask(() => {
                if (tx.oncomplete) {
                  tx.oncomplete();
                }
              });
            },
            getAll: () => {
              const request: { onsuccess: null | (() => void); result: unknown } = {
                onsuccess: null,
                result: [],
              };
              queueMicrotask(() => {
                request.result = [...store.values()];
                if (request.onsuccess) {
                  request.onsuccess();
                }
              });
              return request;
            },
          }),
          oncomplete: null,
          onerror: null,
        };
        return tx;
      },
    };
    const request: {
      onsuccess: null | (() => void);
      onupgradeneeded: null | (() => void);
      result: unknown;
    } = {
      onsuccess: null,
      onupgradeneeded: null,
      result: db,
    };
    queueMicrotask(() => {
      if (request.onsuccess) {
        request.onsuccess();
      }
    });
    return request;
  }
  return { open };
}

describe("registerUserFont / restoreUserFonts（IndexedDB + FontFace 桩）", () => {
  let registered: Array<string>;
  let fontDb: Map<string, unknown>;

  beforeEach(() => {
    registered = [];
    fontDb = new Map();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        add: (face: { family: string }) => {
          registered.push(face.family);
        },
        check: () => true,
        load: () => Promise.resolve([]),
        ready: Promise.resolve(),
      },
    });
    class StubFontFace {
      family: string;
      constructor(family: string) {
        this.family = family;
      }
      load() {
        return Promise.resolve(this);
      }
    }
    /* 测试桩：jsdom 没有 IndexedDB / FontFace，手动塞进全局。 */
    // @ts-expect-error 测试桩
    globalThis.FontFace = StubFontFace;
    // @ts-expect-error 测试桩
    globalThis.indexedDB = makeFakeIDB(fontDb);
  });

  afterEach(() => {
    // @ts-expect-error 还原测试桩
    delete globalThis.FontFace;
    // @ts-expect-error 还原测试桩
    delete globalThis.indexedDB;
    // @ts-expect-error 还原测试桩
    delete document.fonts;
  });

  it("registerUserFont 注册字形、落库，并返回带回退的字体栈", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "MyFont.ttf", { type: "font/ttf" });
    const { family, stack } = await registerUserFont(file, "interface");
    expect(family).toBe("MyFont");
    expect(stack).toBe("MyFont, sans-serif");
    expect(registered).toContain("MyFont");
    expect(fontDb.has("MyFont")).toBe(true);
  });

  it("同名文件重拖是幂等覆盖（按 family 主键）", async () => {
    const first = new File([new Uint8Array([1])], "Dup.ttf", { type: "font/ttf" });
    const second = new File([new Uint8Array([2])], "Dup.ttf", { type: "font/ttf" });
    await registerUserFont(first, "interface");
    await registerUserFont(second, "interface");
    expect(fontDb.size).toBe(1);
    expect(fontDb.has("Dup")).toBe(true);
  });

  it("restoreUserFonts 把库里所有 family 重新注册进 document.fonts", async () => {
    fontDb.set("SavedFont", {
      blob: new Blob([new Uint8Array([9])]),
      family: "SavedFont",
      fileName: "SavedFont.otf",
      format: "opentype",
    });
    await restoreUserFonts();
    expect(registered).toContain("SavedFont");
  });
});
