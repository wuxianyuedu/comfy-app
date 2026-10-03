/**
 * 故事枚举来源门禁（`scripts/storybook-check.mjs`）的自测契约。
 *
 * 为什么要有这一层：门禁的价值全在**判定口径**上，而这条判据的两种错法都
 * 不报错 ——
 *  · 口径太松（只认文件内 `const X = cva(…)`）：漏掉「import 组件的变体表再点
 *    `.variants`」这一族，而那正是首轮踩坑的**原形态**；
 *  · 口径太紧（把注释里出现 `xxxVariants.variants` 也当违规）：会误伤解释这条
 *    规则本身的注释（`button.stories.tsx` 头部就是那么写的），成员会直接删掉
 *    误报的门禁，等于没有。
 *
 * 这里用「临时仓库 + 只放被测文件」跑**真脚本**（与 `check-import-alias.test.ts`
 * 同一套路），四个方向都断言一遍：该拦的拦、该放的放、空转要报错。
 *
 * 规范：docs/standards/16-shadcn-ui与表单校验.md §16.2.3.2、§9.5。
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { symlinkDir } from "./helpers/symlink-dir";

const ROOT = path.resolve(__dirname, "..");
const SCRIPT_REL = "scripts/storybook-check.mjs";
const CHECK_DIR_REL = "scripts/storybook-checks";
const tempDirs: string[] = [];

const COMPONENT = `import { cva } from "class-variance-authority";

export const thingVariants = cva("base", {
  variants: {
    variant: { default: "a", danger: "b" },
    size: { sm: "c", lg: "d" },
  },
  defaultVariants: { variant: "default", size: "sm" },
});
`;

/**
 * 造一个只含被测文件的临时仓库，跑真门禁。
 * @param {{component?: string, story: string}} input
 */
/**
 * 组一个只含被测文件的临时仓库：把门禁入口与它的判据模块原样搬过去，
 * 并把仓库的 `node_modules` 链过去（门禁 `import ts from "typescript"`，
 * 临时目录里没有依赖树 —— 这是这层自测**唯一**不能靠真仓库提供的东西）。
 */
function makeRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "storybook-check-"));
  tempDirs.push(root);
  cpSync(path.join(ROOT, SCRIPT_REL), path.join(root, SCRIPT_REL));
  cpSync(path.join(ROOT, CHECK_DIR_REL), path.join(root, CHECK_DIR_REL), {
    recursive: true,
  });
  /* 目录链接必须走免特权的形态，否则 Windows 上七条用例全死在夹具里。
   * 理由与「为什么收成一处」写在 `./helpers/symlink-dir`。 */
  symlinkDir(path.join(ROOT, "node_modules"), path.join(root, "node_modules"));
  mkdirSync(path.join(root, "src", "components", "ui"), { recursive: true });
  /* 覆盖率那一段要两样东西：基线文件，与一张**指向本仓库文件的**理由表。
     临时仓库里自己造一份，值按 `scanner()` 会写下的那份「组件 + 故事」算
     （分母 1、已覆盖 1）。不这么做的话，**每一条故事枚举用例都会顺带红在
     「理由表里的文件在这不存在」上**，那就不再是「枚举来源」的判据了。 */
  writeFileSync(
    path.join(root, "scripts", ".storybook-coverage-baseline.json"),
    JSON.stringify({ uiSurfaces: 1, covered: 1 }),
  );
  /* 占位理由指向的文件要**真的存在**，否则「理由表与磁盘对得上」那条会红 ——
     而这一组用例判的是枚举来源。/ `thing.test.ts` 是临时仓库里唯一一个
     命中「分母之外」的文件，它必须存在才说得通。 */
  writeFileSync(
    path.join(root, "src", "components", "ui", "thing.test.ts"),
    "",
  );
  const ledger = path.join(root, CHECK_DIR_REL, "coverage-ledger.mjs");
  writeFileSync(
    ledger,
    readFileSync(ledger, "utf8").replace(
      /export const NO_STORY_REASON = new Map\(\[[\s\S]*?\n\]\);/,
      'export const NO_STORY_REASON = new Map([\n  ["thing.test.ts", "临时仓库里的占位理由（判据要求非空表）"],\n]);',
    ),
  );
  return root;
}

function runIn(root: string): { ok: boolean; output: string } {
  try {
    return {
      ok: true,
      output: execFileSync(process.execPath, [path.join(root, SCRIPT_REL)], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** 造一个「组件 + 故事」齐全的临时仓库。 */
function scanner(input: { component?: string; story: string }) {
  const root = makeRepo();
  const uiDir = path.join(root, "src", "components", "ui");
  writeFileSync(path.join(uiDir, "thing.tsx"), input.component ?? COMPONENT);
  writeFileSync(path.join(uiDir, "thing.stories.tsx"), input.story);
  return { run: () => runIn(root) };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const GOOD_STORY = `import type { Meta, StoryObj } from "@storybook/nextjs";
import { Thing } from "./thing";

type ThingVariant = NonNullable<React.ComponentProps<typeof Thing>["variant"]>;
type ThingSize = NonNullable<React.ComponentProps<typeof Thing>["size"]>;
const VARIANTS: ThingVariant[] = ["default", "danger"];
const SIZES: ThingSize[] = ["sm", "lg"];

const meta = {
  title: "UI/Thing",
  component: Thing,
  argTypes: {
    variant: { control: "select", options: VARIANTS },
    size: { control: "select", options: SIZES },
  },
} satisfies Meta<typeof Thing>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;

describe("storybook-check（故事枚举来源门禁）", () => {
  it("放行「从 props 派生 + 字面量清单覆盖每一档」的写法", () => {
    const { run } = scanner({ story: GOOD_STORY });
    const { ok, output } = run();
    expect(output).toContain("[storybook] 故事枚举来源 OK");
    expect(ok).toBe(true);
  });

  it("拦下 import 组件的变体表再点 `.variants`（首轮踩坑的原形态）", () => {
    const { ok, output } = scanner({
      story: GOOD_STORY.replace(
        'import { Thing } from "./thing";',
        'import { Thing, thingVariants } from "./thing";',
      ).replace(
        "const VARIANTS: ThingVariant[] =",
        "const LEAK = Object.keys(thingVariants.variants.variant);\nconst VARIANTS: ThingVariant[] =",
      ),
    }).run();
    expect(ok).toBe(false);
    expect(output).toContain("thingVariants.variants");
  });

  it("拦下手写清单漏档（cva 里加了一档、故事没跟上）", () => {
    const { ok, output } = scanner({
      story: GOOD_STORY.replace(
        '[ "default", "danger"]',
        '["default"]',
      ).replace('["default", "danger"]', '["default"]'),
    }).run();
    expect(ok).toBe(false);
    expect(output).toContain("danger");
  });

  it("拦下整条轴被漏掉（那一档没人验）", () => {
    const { ok, output } = scanner({
      story: GOOD_STORY.replace(
        '    size: { control: "select", options: SIZES },\n',
        "",
      ),
    }).run();
    expect(ok).toBe(false);
    expect(output).toContain("少了轴");
  });

  it("拦下手写字面量类型（不从 props 派生 = 加一档不会报错）", () => {
    const { ok, output } = scanner({
      story: GOOD_STORY.replace(
        'type ThingSize = NonNullable<React.ComponentProps<typeof Thing>["size"]>;',
        'type ThingSize = "sm" | "lg";',
      ),
    }).run();
    expect(ok).toBe(false);
    expect(output).toContain("从 props 派生的类型");
  });

  it("不误伤注释里提到 `xxxVariants.variants` 的说明（那条注释正是规则的来由）", () => {
    const { ok, output } = scanner({
      story: `// 不能写 thingVariants.variants.variant：cva() 的返回值是函数。\n${GOOD_STORY}`,
    }).run();
    expect(ok).toBe(true);
    expect(output).toContain("OK");
  });

  it("一份 story 都没有时报错（判据在空转，不许静默通过）", () => {
    const root = makeRepo();
    const { ok, output } = runIn(root);
    expect(ok).toBe(false);
    expect(output).toContain("空转");
  });

  /**
   * 覆盖率那一段的四个方向。为什么要有这一组：棘轮的两种错法都不报错 ——
   * 判据写松了（阈值取不到），或者基线被人往下改一格（覆盖率的分子少一个时
   * 没人拦）—— 而它们的后果都是「这条账重新变成一句写在文档里的话」。
   */
  it("覆盖率方向 ①：story 被删（内容空了但文件还在）→ 覆盖率下降拦下", () => {
    const root = makeRepo();
    const uiDir = path.join(root, "src", "components", "ui");
    writeFileSync(path.join(uiDir, "thing.tsx"), COMPONENT);
    /* 文件还在、但**不再 import 任何组件**（清空成一句说明）—— 这正是
       「删 story 时留下一个空壳」的现实形态：glob 还扫得到它，所以不会命中
       「一份 story 都没有」那条空转保护，覆盖率却掉到 0。 */
    writeFileSync(
      path.join(uiDir, "thing.stories.tsx"),
      "export default {};\n",
    );
    const { ok, output } = runIn(root);
    expect(ok).toBe(false);
    expect(output).toContain("组件覆盖率下降");
  });

  it("覆盖率方向 ②：新增 ui/ 组件却没 story → 拦下（要求同批回答问题）", () => {
    const root = makeRepo();
    const uiDir = path.join(root, "src", "components", "ui");
    writeFileSync(path.join(uiDir, "thing.tsx"), COMPONENT);
    writeFileSync(path.join(uiDir, "thing.stories.tsx"), GOOD_STORY);
    // 多一个只有实现、没有 story 的组件
    writeFileSync(
      path.join(uiDir, "another.tsx"),
      "export const Another = () => null;\n",
    );
    const { ok, output } = runIn(root);
    expect(ok).toBe(false);
    expect(output).toContain("可预览文件数");
  });

  it("覆盖率方向 ③：分子不低于基线时棘轮不误伤（判据只挡「往下掉」）", () => {
    const root = makeRepo();
    const uiDir = path.join(root, "src", "components", "ui");
    writeFileSync(path.join(uiDir, "thing.tsx"), COMPONENT);
    writeFileSync(path.join(uiDir, "thing.stories.tsx"), GOOD_STORY);
    writeFileSync(
      path.join(root, "scripts", ".storybook-coverage-baseline.json"),
      JSON.stringify({ uiSurfaces: 2, covered: 1 }),
    );
    const { ok, output } = runIn(root);
    /* 这里把分母也一起改大：目的是让「分子不低于基线」这件事单独被观察到。
       断言分两句 —— 覆盖率那一行照常打出来（1/1，基线 1/2），而唯一的一处违规
       必须是**分母对不上**那条，绝不能是「组件覆盖率下降」：棘轮只管「本次低于
       基线」，分母漂移是另一条判据的事。 */
    expect(output).toContain("组件覆盖率 1/1（基线 1/2");
    expect(output).toContain("可预览文件数");
    expect(output).not.toContain("组件覆盖率下降");
    expect(ok).toBe(false);
  });

  it("覆盖率方向 ④：理由表指向不存在的文件 / 已有 story 还留着 → 拦下", () => {
    const root = makeRepo();
    const uiDir = path.join(root, "src", "components", "ui");
    writeFileSync(path.join(uiDir, "thing.tsx"), COMPONENT);
    writeFileSync(path.join(uiDir, "thing.stories.tsx"), GOOD_STORY);
    const ledger = path.join(root, CHECK_DIR_REL, "coverage-ledger.mjs");
    /* 变异：把理由表换成一条指向**磁盘上不存在**的文件。
       正则锚在「导出行」上而不是某一种字面量形状 —— 表本身可以是
       `new Map([...])` 也可以是空的 `new Map()`（这一批就到了空表），
       锚形状的写法会在表一变空时**静默失去匹配**、变异不生效、这条判据
       在空转（正是它要拦的那族失效）。 */
    const src = readFileSync(ledger, "utf8");
    const mutated = src.replace(
      /export const NO_STORY_REASON = new Map\([^;]*\);/,
      'export const NO_STORY_REASON = new Map([\n  ["not-a-real-file.ts", "临时变异：磁盘上没有这个文件"],\n]);',
    );
    expect(
      mutated,
      "变异没生效 —— 理由表的导出行形状变了，这条判据会在空转",
    ).not.toBe(src);
    writeFileSync(ledger, mutated);
    const { ok, output } = runIn(root);
    expect(ok).toBe(false);
    expect(output).toContain("not-a-real-file.ts");
  });
});
