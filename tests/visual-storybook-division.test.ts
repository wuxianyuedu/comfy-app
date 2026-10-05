/**
 * 「组件级视觉归 Storybook、页面级视觉与业务流程归 Playwright」这条分工的机器判据。
 *
 * ## 为什么这条分工需要判据
 *
 * 两侧都各自有判据（Storybook 侧覆盖率 / 故事面 / 枚举来源，Playwright 侧基线成套），
 * 但**没有一条盯着「哪件事该由谁做」**。而这条边界恰恰是两块基建各自的成本前提：
 * §11.8 明确「不引入 Chromatic / 第二套截图工具」，理由就是「两套基线维护成本」。
 * 边界一旦被越过去，表现不是红，是**两套基线各自缓慢腐坏**：
 *
 *  ① 有人给 story 加 `toHaveScreenshot` —— 于是组件级形态有了第二套像素基线，
 *     它跑在 Storybook 的 webServer 上、与 `e2e/visual` 那套的判定口径完全不同，
 *     而 §11.8 的「唯一视觉基线方案」成了文档里的一句空话；
 *  ② 有人把 Chromatic（或同类云端像素服务）接进来 —— 同上，且多一笔云服务依赖；
 *  ③ `e2e/visual/` 被清空或只剩一页 —— 页面级视觉的**唯一**出口没有了，
 *     而「组件级有 story」会让这一步看起来像是覆盖到了（两者判的不是同一件事）。
 *
 * ③ 是这里最要紧的一条：它是**减法型**失效（删掉东西比加东西更容易通过 review）。
 * 所以它不仅判「目录非空」，还判「§11.8 声明的基线范围真的有人管」——
 * 深浅两态、响应式断点、空态这三档各自要在 spec 里找得到落点。
 *
 * ## 为什么不判「页面覆盖率是一个数字」
 *
 * §11.8 明说基线范围「**只锁定关键 UI**，不追求全组件覆盖」。所以这里判的是
 * 「声明的每一档都有落点」，不是「e2e/visual 里有多少个 spec」——后者会逼着人
 * 为凑数录一堆脆基线，而那正是本节要避免的成本。
 *
 * 清点内核复用 `scripts/visual-baselines.mjs`（§12.12：不另抄一份扫描规则）。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VISUAL_DIR, declaredShotNames } from "../scripts/visual-baselines.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const STORYBOOK_DIR = path.join(ROOT, ".storybook");

/** `.storybook/**` 与 `src/**‌/*.stories.tsx` —— 「组件级视觉」那一侧的全部落点。 */
function storybookSideFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(abs);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        files.push(abs);
      }
    }
  };
  walk(STORYBOOK_DIR);
  walk(path.join(ROOT, "src"));
  return files.filter(
    (f) => f.startsWith(STORYBOOK_DIR) || f.endsWith(".stories.tsx"),
  );
}

/** `e2e/visual/*.visual.spec.ts` 的绝对路径 + 文本。 */
function visualSpecs(): Array<{ file: string; text: string; names: string[] }> {
  const dir = path.join(ROOT, VISUAL_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".visual.spec.ts"))
    .map((f) => {
      const text = readFileSync(path.join(dir, f), "utf8").replace(/\r\n/g, "\n");
      return { file: `${VISUAL_DIR}/${f}`, text, names: declaredShotNames(text) };
    });
}

describe("组件级视觉 ⇄ 页面级视觉的分工（§11.8 / #1381）", () => {
  const pkg = JSON.parse(
    readFileSync(path.join(ROOT, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("Storybook 那一侧不许出现像素截图断言（那是 Playwright 的事）", () => {
    const offenders: string[] = [];
    for (const file of storybookSideFiles()) {
      const text = readFileSync(file, "utf8");
      if (/toHaveScreenshot\s*\(/.test(text)) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(
      offenders,
      "组件级形态归 Storybook（画布上直接看），像素基线归 e2e/visual 的 Playwright" +
        "（§11.8「唯一视觉基线方案」）。把截图断言放进 story 就给同一件事造了第二套基线。",
    ).toEqual([]);
  });

  it("不引入第二套像素基线工具（Storybook 不接 Chromatic，见 §11.8）", () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const banned = Object.keys(all).filter((name) =>
      /^(chromatic|@chromatic-com\/.*|jest-image-snapshot|reg-cli|resemblejs|pixelmatch)$/.test(
        name,
      ),
    );
    expect(
      banned,
      "像素基线的唯一方案是 Playwright `toHaveScreenshot`；第二套工具意味着" +
        "两套基线的维护成本（§11.8 的方案选择一节）。",
    ).toEqual([]);
  });

  it("页面级视觉有且只有 e2e/visual 这一个出口，且真的存在", () => {
    const specs = visualSpecs();
    expect(specs.length).toBeGreaterThan(0);
    for (const { file, names } of specs) {
      expect(names.length, `${file} 里没有 toHaveScreenshot 声明`).toBeGreaterThan(
        0,
      );
    }
  });

  it("§11.8 声明的基线范围档档有落点（深浅两态 / 断点 / 空态）", () => {
    /* 判的是「这一档有没有人管」，不是「录了 == 这一档就对」——后者只有人看基线时判得了。
     * 三档各自的最小落点形状：
     *   · 深浅两态：同一个截图名要有 light 与默认（dark）两份，或 spec 里显式切两档；
     *   · 响应式断点：一处用移动端设备描述符开上下文；
     *   · 空态：一路把某个空列表 / 空集合钉住的桩（或「空态」字样出现在用例名里）。 */
    const specs = visualSpecs();
    const allText = specs.map((s) => s.text).join("\n");
    const allNames = specs.flatMap((s) => s.names);

    expect(
      allNames.some((n) => n.includes("light")),
      "深浅两态对比：`e2e/visual` 里没有任何浅色档截图（§11.8 基线范围点名了这一档）",
    ).toBe(true);

    expect(
      /devices\[\s*["']iPhone/.test(allText),
      "Tailwind 响应式断点：`e2e/visual` 里没有移动端断点用例",
    ).toBe(true);

    expect(
      allNames.some((n) => n.includes("empty")),
      "空态/空画布提示：`e2e/visual` 里没有任何空态基线（§11.8 基线范围点名了这一档）",
    ).toBe(true);
  });

  it("判据不是空转：两侧的扫描面都收得到东西", () => {
    // 扫描面为空 = 上面几条恒绿。Storybook 侧的扫描面是 `.storybook` + stories。
    const side = storybookSideFiles();
    expect(side.length).toBeGreaterThan(0);
    expect(
      side.some((f) => f.includes(".storybook")),
      "`.storybook/**` 没被扫到",
    ).toBe(true);
    expect(
      side.some((f) => f.endsWith(".stories.tsx")),
      "故事文件没被扫到",
    ).toBe(true);
    // 反向自证：判据真的认得那种写法（构造一段带截图断言的文本能命中）。
    expect(/toHaveScreenshot\s*\(/.test('await expect(p).toHaveScreenshot("x.png")')).toBe(
      true,
    );
    expect(/^(chromatic)$/.test("chromatic")).toBe(true);
    expect(visualSpecs().length).toBeGreaterThan(0);
  });
});
