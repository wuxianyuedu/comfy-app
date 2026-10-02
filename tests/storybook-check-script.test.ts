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
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

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
  symlinkSync(
    path.join(ROOT, "node_modules"),
    path.join(root, "node_modules"),
    "dir",
  );
  mkdirSync(path.join(root, "src", "components", "ui"), { recursive: true });
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
      story: GOOD_STORY.replace('[ "default", "danger"]', '["default"]').replace(
        '["default", "danger"]',
        '["default"]',
      ),
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
});
