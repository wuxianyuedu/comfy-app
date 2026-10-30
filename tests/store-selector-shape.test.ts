/**
 * 「视图层 store selector 不许现拼对象 / 现造新数组」这条判据自身的用例
 * （ISSUE #1780）。
 *
 * 与 `tests/router-error-envelope.test.ts` 同构：三层各管一件事，缺任何一层
 * 都会静默失效。
 *
 *   ① **存量为零** —— 真扫 `src/**`，按名字匹配真实的 store 订阅 hook 调用点，
 *      断言没有「selector 里写对象字面量 / 用 .map·.filter 造新数组」的形状。
 *      同时断言**扫描面非空** —— 路径写错时「零命中」看起来就像「全都修好了」，
 *      这是这一类清单最典型的死法。
 *   ② **清单与仓库同步** —— `eslint.config.js` 的 `STORE_SELECTOR_HOOKS` 必须
 *      覆盖仓库里**全部** `create<...>()` 出来的 zustand store（漏登记 = 新 store
 *      不受判据保护，而 lint 那边一点反应都没有）。
 *   ③ **selector 真的会响** —— 拿 eslint 自带 `Linter` 在最小片段上验一次：
 *      反模式必须报、合法写法必须不报。少了这一层，② 就只是一句「配置里有个
 *      字符串」—— 本仓库已经付过学费：**「有配置 ≠ 配置在跑」**（§11.7）。
 *
 * 为什么 selector 必须按**名字**限定（而不是 `/^use[A-Z]/` 泛匹配）：见
 * `eslint.config.js` 那段注释 —— `useMemo(() => rows.slice(0, 8), [])` 与
 * `useState(() => ({ ... }))` 都是合法且常见的写法，泛匹配会全报出来。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";

import { stripComments } from "./helpers/strip-comments";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const CONFIG = path.join(ROOT, "eslint.config.js");

/** 递归收集 `src/**` 下的全部 `.ts` / `.tsx`（跳过用例与 story）。 */
function sourceFiles(dir = SRC): Array<string> {
  const out: Array<string> = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) {
      continue;
    }
    if (/\.(test|stories)\.tsx?$/.test(entry.name)) {
      continue;
    }
    out.push(full);
  }
  return out;
}

/** 仓库里真实的 zustand store hook 名（`export const useXxx = create<...>()`）。 */
function realStoreHooks(): Array<string> {
  const names = new Set<string>();
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, "utf8"));
    for (const m of code.matchAll(
      /export\s+const\s+(use[A-Za-z0-9_]+)\s*=\s*create(?:Store)?\s*[<(]/g,
    )) {
      const name = m[1];
      if (name) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

/** `STORES` 里没有、但语义上同样是「订阅 store state」的取数 hook。 */
const EXTRA_SUBSCRIBERS = [
  // 面板订阅句柄：LogProvider 用 `useStore(createStore<...>())` 造出来再导出，
  // 不是 `create<...>()` 直接产出的单例，所以上面那个正则扫不到它。
  "useLogPanel",
];

/** 从 `eslint.config.js` 源码取 `STORE_SELECTOR_HOOKS` 清单（不在此重抄一份）。 */
function configuredHooks(): Array<string> {
  const src = readFileSync(CONFIG, "utf8");
  const block = /const STORE_SELECTOR_HOOKS = \[([\s\S]*?)\];/.exec(src)?.[1];
  if (!block) {
    return [];
  }
  return [...block.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1] ?? "")
    .filter((n) => n.length > 0)
    .sort();
}

describe("① 存量为零：视图层没有现拼对象 / 现造新数组的 store selector", () => {
  it("扫描面非空（路径写错时「零命中」是假绿）", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(200);
    for (const f of files.slice(0, 5)) {
      expect(statSync(f).isFile()).toBe(true);
    }
  });

  it("没有 store selector 造新引用的调用点", () => {
    const hooks = configuredHooks();
    expect(hooks.length).toBeGreaterThan(3);
    const names = hooks.join("|");
    // ⚠️ 判据必须容忍**换行**：真实代码里 `useMessageCenterStore((s) =>\n
    // s.messages.filter(...))` 是常见写法，只按单行匹配会整片漏掉
    // （实测：单行版对注入的反模式毫无反应）。所以先把源码压成单行再匹配。
    const oneLine = (code: string) => code.replace(/\s+/g, " ");
    const objLiteral = new RegExp(
      `\\b(?:${names})\\s*\\(\\s*\\(?[A-Za-z_$][\\w$]*\\)?\\s*=>\\s*[({[]`,
    );
    const newArray = new RegExp(
      `\\b(?:${names})\\s*\\(\\s*\\(?[A-Za-z_$][\\w$]*\\)?\\s*=>\\s*[^)]*?\\.(?:map|filter|slice|concat|sort)\\(`,
    );
    const hits: Array<string> = [];
    for (const file of sourceFiles()) {
      const flat = oneLine(stripComments(readFileSync(file, "utf8")));
      for (const re of [objLiteral, newArray]) {
        const m = re.exec(flat);
        if (m) {
          hits.push(`${path.relative(ROOT, file)}  ~${m[0].trim()}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("② 清单与仓库同步：漏登记新 store 会红", () => {
  it("每个真实 zustand store 都在 STORE_SELECTOR_HOOKS 里", () => {
    const configured = configuredHooks();
    const missing = realStoreHooks().filter((h) => !configured.includes(h));
    expect(missing).toEqual([]);
  });

  it("清单里每一项都对应仓库里真实存在的 hook", () => {
    const real = new Set([...realStoreHooks(), ...EXTRA_SUBSCRIBERS]);
    const phantom = configuredHooks().filter((h) => !real.has(h));
    expect(phantom).toEqual([]);
  });

  it("清单有多条（扫描面不是空的）", () => {
    expect(configuredHooks().length).toBeGreaterThan(3);
  });
});

describe("③ selector 真的会响", () => {
  const src = readFileSync(CONFIG, "utf8");

  /** 从配置里取出两条真实 selector（模板变量换成清单内容），不在此重抄定义。 */
  function realSelectors(): Array<string> {
    const hooks = configuredHooks().join("|");
    return src
      .split("\n")
      .filter((line) => line.includes("CallExpression[callee.name"))
      .map((line) => {
        const body = /selector:\s*`([^`]*)`/.exec(line)?.[1] ?? "";
        return body.replace('${STORE_SELECTOR_HOOKS.join("|")}', hooks);
      })
      .filter((s) => s.length > 0);
  }

  it("配置里确实声明了两条带箭头函数体的 selector", () => {
    expect(src).toContain("STORE_SELECTOR_HOOKS");
    expect(realSelectors().length).toBe(2);
    expect(realSelectors()[0]).toContain('body.type="ObjectExpression"');
    expect(realSelectors()[1]).toContain("callee.property.name");
  });

  it("反模式报、合法写法不报", () => {
    const selectors = realSelectors();
    expect(selectors.length).toBe(2);
    const linter = new Linter();
    const verify = (code: string) =>
      linter.verify(code, {
        languageOptions: { ecmaVersion: 2022, sourceType: "module" },
        rules: {
          "no-restricted-syntax": [
            "error",
            ...selectors.map((selector) => ({ selector, message: "x" })),
          ],
        },
      });
    const flagged = (code: string) => verify(code).some((m) => m.ruleId === "no-restricted-syntax");

    // 反模式：对象字面量 / 造新数组
    expect(
      flagged(`const a = useShellTabs((s) => ({ tabs: s.tabs, active: s.activeTabId }));`),
    ).toBe(true);
    expect(
      flagged(`const b = useMessageCenterStore((s) => s.messages.filter((m) => !m.read));`),
    ).toBe(true);

    // 合法：原始值 / store 里已固化的引用 / reduce 成原始值
    expect(flagged(`const c = useShellTabs((s) => s.activeTabId);`)).toBe(false);
    expect(flagged(`const d = useLogCategoryStore((s) => s.enabled);`)).toBe(false);
    expect(
      flagged(
        `const e = useMessageCenterStore((s) => s.messages.reduce((n, m) => n + (m.read ? 0 : 1), 0));`,
      ),
    ).toBe(false);

    // 普通 React hook 造对象**不在拦的范围**（泛匹配 `use[A-Z]` 会误报一片）
    expect(flagged(`const f = useMemo(() => ({ n: 1 }), []);`)).toBe(false);
    expect(flagged(`const g = useState(() => rows.slice(0, 8));`)).toBe(false);
  });
});
