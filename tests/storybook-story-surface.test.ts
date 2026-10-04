/**
 * 故事「面」的判据（`scripts/storybook-checks/story-surface.mjs`）。
 *
 * 它补的是覆盖率台账那三条判据的**盲区**：台账只看「文件名 ↔ 故事文件」，
 * 于是下面四种「构建全绿、画布也画得出来」的错法一个都拦不住 ——
 *
 *  ① 没有 `title`：Storybook 按路径自动生成条目，落在侧栏哪个分组取决于推导
 *     规则（构建、覆盖率、渲染全都正常）；
 *  ② 真组件没接上：`meta` 连的是 story 内部自造的适配件，而适配件里也没有那个
 *     组件 —— 画布上摆的是别的东西；
 *  ③ 必填 props 没给 `args`：组件在画布上抛 `Cannot read properties of undefined`
 *     —— 与 §16.2.3.4 那轮踩的坑同形（侧栏有故事、画布一片空白）；
 *  ④ 同一目录两套分组前缀：分组靠人写 `title:` 的字符串维系。
 *
 * 用例只调那几个**纯函数**（不写第二份实现、不起子进程），四个方向各断言一遍：
 * 该拦的拦、该放的放、空转要报错 —— 以及「正当形态不许误伤」（适配件把真组件
 * 渲染进去是允许的，那是 §16.2.3.6 注入层的常规写法）。
 *
 * 规范：docs/standards/16-shadcn-ui与表单校验.md §16.2.3.8。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import {
  missingRequiredArgs,
  storySurfaces,
  storySurface,
} from "../scripts/storybook-checks/story-surface.mjs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/**
 * 造一个只含「组件 + 故事」的临时仓库，跑一遍扫描。
 * @param {{component?: string, story: string, componentName?: string}} input
 */
function scan(input: {
  component?: string;
  story: string;
  componentName?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "story-surface-"));
  tempDirs.push(root);
  const dir = join(root, "src", "components", "ui");
  mkdirSync(dir, { recursive: true });
  const name = input.componentName ?? "thing";
  writeFileSync(
    join(dir, `${name}.tsx`),
    input.component ??
      `import { cva } from "class-variance-authority";
export interface ThingProps {
  label: string;
  tone?: string;
}
export const Thing = ({ label }: ThingProps) => <div>{label}</div>;
export const thingVariants = cva("base", {
  variants: { variant: { default: "a", danger: "b" } },
});
`,
  );
  writeFileSync(join(dir, `${name}.stories.tsx`), input.story);
  return storySurfaces({
    componentsRoot: join(root, "src", "components"),
    repoRoot: root,
  });
}

const GOOD_STORY = `import type { Meta, StoryObj } from "@storybook/nextjs";
import { Thing } from "./thing";

const meta = {
  title: "UI/Thing",
  component: Thing,
  args: { label: "标签" },
} satisfies Meta<typeof Thing>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;

/** 解析一份源码（`missingRequiredArgs` 要 AST）。 */
function parseSource(file: string, source: string) {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

describe("故事面的判据（规范 16 §16.2.3.8）", () => {
  it("放行常规写法（title + 真组件 + 必填 args 齐）", () => {
    const stat = scan({ story: GOOD_STORY });
    expect(stat.stories).toHaveLength(1);
    expect(stat.missingTitle).toEqual([]);
    expect(stat.missingComponent).toEqual([]);
    expect(stat.groupDeviations).toEqual([]);
  });

  it("拦下没有 title 的故事（Storybook 会按路径自动生成一个条目）", () => {
    const story = GOOD_STORY.replace('  title: "UI/Thing",\n', "");
    const stat = scan({ story });
    expect(stat.missingTitle).toHaveLength(1);
    expect(stat.missingTitle[0]?.endsWith("thing.stories.tsx")).toBe(true);
  });

  it("放行适配件 —— 只要它把真组件渲染进去（注入层的常规写法，不许误伤）", () => {
    const story = `import type { Meta, StoryObj } from "@storybook/nextjs";
import { Thing } from "./thing";

/** 适配件：受控状态 / 值源解析都是这个形状（§16.2.3.6）。 */
function ThingWithState({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <Thing label={label} />
    </div>
  );
}

const meta = {
  title: "UI/Thing",
  component: ThingWithState,
  args: { label: "标签" },
} satisfies Meta<typeof ThingWithState>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;
    const stat = scan({ story });
    expect(stat.missingComponent).toEqual([]);
  });

  it("拦下真组件根本没接上的故事（画布上摆的是别的东西）", () => {
    const story = `import type { Meta, StoryObj } from "@storybook/nextjs";

function SomethingElse() {
  return <div>这不是 Thing</div>;
}

const meta = {
  title: "UI/Thing",
  component: SomethingElse,
} satisfies Meta<typeof SomethingElse>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;
    const stat = scan({ story });
    expect(stat.missingComponent).toHaveLength(1);
  });

  it("拦下同目录里另起一套分组前缀的故事（分组靠人写 title 维系）", () => {
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    for (const name of ["a", "b", "c"]) {
      writeFileSync(join(dir, `${name}.tsx`), "export const X = () => null;\n");
    }
    /* 三份故事各自 import 同目录的 `a` / `b` / `c` 组件：`GOOD_STORY` 里的名字
       一起换掉，否则三份都指向 `./thing`，接真组件那条会先红。 */
    const storyFor = (name: string, title: string) =>
      GOOD_STORY.replace(/thing/g, name)
        .replace(/Thing/g, name.toUpperCase())
        .replace('title: "UI/' + name.toUpperCase() + '"', `title: "${title}"`);
    writeFileSync(join(dir, "a.stories.tsx"), storyFor("a", "UI/A"));
    writeFileSync(join(dir, "b.stories.tsx"), storyFor("b", "UI/B"));
    /* 第三份写的是另一套前缀 —— 多数是 `UI/`，它就是那个偏离项。 */
    writeFileSync(join(dir, "c.stories.tsx"), storyFor("c", "WIDGETS/C"));
    const stat = storySurfaces({
      componentsRoot: join(root, "src", "components"),
      repoRoot: root,
    });
    expect(stat.groupDeviations).toHaveLength(1);
    expect(stat.groupDeviations[0]?.group).toBe("WIDGETS");
    expect(stat.groupDeviations[0]?.expected).toBe("UI");
  });

  it("拦下必填 props 一个 args 都没给的故事（画布上会抛）", () => {
    const story = GOOD_STORY.replace('  args: { label: "标签" },\n', "");
    /* 组件与故事同目录才判得动：这里把两者写到同一个临时目录。 */
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    const componentFile = join(dir, "probe.tsx");
    writeFileSync(
      componentFile,
      `export interface ProbeProps {
  label: string;
  tone?: string;
}
export const Probe = ({ label }: ProbeProps) => <div>{label}</div>;
`,
    );
    const storyFile = join(dir, "probe.stories.tsx");
    writeFileSync(storyFile, story);
    const surface = storySurface(parseSource(storyFile, story));
    expect(missingRequiredArgs(storyFile, surface.args)).toEqual(["label"]);
  });

  it("`args` 给了必填项就放行（含在 render 里给的那种形态由 args 声明兜住）", () => {
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "probe.tsx"),
      `export interface ProbeProps {
  label: string;
}
export const Probe = ({ label }: ProbeProps) => <div>{label}</div>;
`,
    );
    const storyFile = join(dir, "probe.stories.tsx");
    writeFileSync(
      storyFile,
      GOOD_STORY.replace(/thing/g, "probe").replace("Thing", "Probe"),
    );
    const surface = storySurface(parseSource(storyFile, GOOD_STORY));
    expect(missingRequiredArgs(storyFile, surface.args)).toEqual([]);
  });

  it("适配件里**显式传了**真组件的必填 props 就不算缺口（`render` 里给也算）", () => {
    /* 报错文案承诺的口径：写进 `args`，**或在 `render` 里显式传**。判据只统计
       `args` 时这一整类正当写法会被全判成缺口 —— 实测全仓 6 份有缺口的 story
       全是这一类（适配件把真组件的必填项在内部喂满了，画布上读得到值）。 */
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "probe.tsx"),
      `export interface ProbeProps {
  label: string;
  onSelect: (key: string) => void;
}
export const Probe = ({ label }: ProbeProps) => <div>{label}</div>;
`,
    );
    const storyFile = join(dir, "probe.stories.tsx");
    const story = `import type { Meta, StoryObj } from "@storybook/nextjs";
import { Probe } from "./probe";

function ProbeHost({ tone }: { tone: string }) {
  return <Probe label={tone} onSelect={() => undefined} />;
}

const meta = {
  title: "UI/Probe",
  component: ProbeHost,
  args: { tone: "标签" },
} satisfies Meta<typeof ProbeHost>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;
    writeFileSync(storyFile, story);
    /* `label` 与 `onSelect` 都在适配件里显式传了 → 不该判缺。 */
    const surface = storySurface(parseSource(storyFile, story));
    expect(surface.args.has("label")).toBe(false);
    expect(missingRequiredArgs(storyFile, surface.args)).toEqual([]);
  });

  it("给 hook / 工厂函数传的必填项同样算给了（不是只有 JSX 属性才算）", () => {
    /* `useFilePicker({ onPick: … })` 这种：`onPick` 是 hook 的入参，组件在画布上
       读得到值，而它**不是** JSX 属性。只认 JSX 属性会把这份 story 判成缺口。 */
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "probe.tsx"),
      `export interface ProbeProps {
  onPick: (file: File) => void;
}
export function useProbe({ onPick }: ProbeProps) {
  return onPick;
}
`,
    );
    const storyFile = join(dir, "probe.stories.tsx");
    const story = `import type { Meta, StoryObj } from "@storybook/nextjs";
import { useProbe } from "./probe";

function ProbeDemo() {
  const open = useProbe({ onPick: () => undefined });
  return <button onClick={open}>选</button>;
}

const meta = { title: "UI/Probe", component: ProbeDemo } satisfies Meta<
  typeof ProbeDemo
>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;
    writeFileSync(storyFile, story);
    const surface = storySurface(parseSource(storyFile, story));
    expect(missingRequiredArgs(storyFile, surface.args)).toEqual([]);
  });

  it("**出参**接口的必填成员不算组件的 props（返回值不是要传进去的东西）", () => {
    /* `mediaDragSourceProps()` 返回 `MediaDragSourceProps`：它只有 `return` 那一处
       引用，成员却是必填。把返回值的必填项算成「缺 args」会逼人给组件塞
       `draggable` / `onDragStart` 这类**它从不消费**的死参数。 */
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "probe.tsx"),
      `export interface ProbeProps {
  draggable: boolean;
  onDragStart: () => void;
}
export function probeProps(): ProbeProps {
  return { draggable: true, onDragStart: () => undefined };
}
`,
    );
    const storyFile = join(dir, "probe.stories.tsx");
    const story = `import type { Meta, StoryObj } from "@storybook/nextjs";
import { probeProps } from "./probe";

function ProbeCard() {
  return <div {...probeProps()} />;
}

const meta = { title: "UI/Probe", component: ProbeCard } satisfies Meta<
  typeof ProbeCard
>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
`;
    writeFileSync(storyFile, story);
    const surface = storySurface(parseSource(storyFile, story));
    expect(missingRequiredArgs(storyFile, surface.args)).toEqual([]);
  });

  it("读不到 props 接口时**不判**（宁可漏，不可误伤）", () => {
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    const dir = join(root, "src", "components", "ui");
    mkdirSync(dir, { recursive: true });
    /* 组件把 props 收进 `ComponentProps<"div">` 这类取不到成员的类型里 ——
       静态读不到就不该报「缺 args」。 */
    writeFileSync(
      join(dir, "probe.tsx"),
      `export const Probe = (props: React.ComponentProps<"div">) => <div {...props} />;
`,
    );
    const storyFile = join(dir, "probe.stories.tsx");
    writeFileSync(storyFile, GOOD_STORY.replace(/thing/g, "probe"));
    expect(missingRequiredArgs(storyFile, new Set(["label"]))).toEqual([]);
  });

  it("扫描到 0 份故事时不会有「空转的绿」（真实仓库上另有判据兜）", () => {
    const root = mkdtempSync(join(tmpdir(), "story-surface-"));
    tempDirs.push(root);
    mkdirSync(join(root, "src", "components", "ui"), { recursive: true });
    const stat = storySurfaces({
      componentsRoot: join(root, "src", "components"),
      repoRoot: root,
    });
    expect(stat.stories).toEqual([]);
  });

  it("真实仓库上这份判据不是空转（有 story、且全部有 title）", () => {
    const stat = storySurfaces({
      componentsRoot: resolve("src/components"),
      repoRoot: resolve("."),
    });
    expect(stat.stories.length).toBeGreaterThan(0);
    expect(stat.missingTitle).toEqual([]);
    expect(stat.missingComponent).toEqual([]);
    expect(stat.groupDeviations).toEqual([]);
  });
});
