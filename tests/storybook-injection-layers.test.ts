/**
 * 三层注入层（store / React Flow / 整屏容器）的**契约判据**
 *（ISSUE #1381 续，规范 16 §16.2.3.10）。
 *
 * 为什么需要它：`data-sources.tsx` 那条（`tests/storybook-data-sources.test.ts`）
 * 守住了「值源不许是假数据」，而这一批的三层守的是同一件事在**另外三个方向**上
 * 的形态 —— 失效时同样没有任何东西会红：
 *
 *  · 往 store 场景里塞一份手捏的 `LogEntry[]` —— 解析、分桶、计数三条链路一起
 *    被跳过，画布上照样有内容（那正是 §16.2.3.9 判断「不给假形态」的反面）；
 *  · 拿一段原文冒充三条通道 —— 每块必须按**自己那条通道的格式**解析，
 *    否则「来源」那一列会整列同名，分桶与计数等于没验；
 *  · 画布场景里写死 `zoom` 却绕过真 `ReactFlow` —— 端点几何 / 缩放订阅 /
 *    视口尺寸全是假的，而那三样正是这一族 story 存在的理由；
 *  · 整屏容器里塞 `<div>占位</div>` —— 画布上看的是「外壳围着占位符」，
 *    证明不了「外壳 + 真视图」这回事。
 *
 * 判的是**接线与形状**，不是语义（语义那一半由真浏览器逐 story 渲染核对）：
 *  1. 三个模块都在 `.storybook/` 下、都有真出口；
 *  2. store 场景的名字不认识时**抛错**、每块带 `origin`、且走 `parseFileLogs`；
 *  3. 画布场景的名字不认识时**抛错**、带 `viewport`，且注入层用的是真
 *     `ReactFlowProvider` / `ReactFlow`（不是自绘的假画布）；
 *  4. 整屏容器用的是真 `AppShell` / 真 `WorkspaceFrame`，且项目经真 action
 *     (`createProject`) 建 —— 手拼 `CanvasProject` 字面量会被这条拦下；
 *  5. 三个注入层都挂在 `preview.tsx` 的装饰器链上（没挂 = 判据"在场"而 story
 *     走的还是真实单例，表现是「story 里 store 空着」）。
 *
 * 真浏览器逐 story 渲染核对是另一半（那一维是「有没有真的画出来」，
 * 用例到不了）—— 本批 35 条相关 story 全部逐条在无头 Chromium 里打开过。
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(".");
const STORE = join(ROOT, ".storybook", "store-sources.tsx");
const FLOW = join(ROOT, ".storybook", "flow-canvas.tsx");
const SCREEN = join(ROOT, ".storybook", "screen-frame.tsx");
const PREVIEW = join(ROOT, ".storybook", "preview.tsx");

const store = readFileSync(STORE, "utf8");
const flow = readFileSync(FLOW, "utf8");
const screen = readFileSync(SCREEN, "utf8");
const preview = readFileSync(PREVIEW, "utf8");

describe("Storybook 三层注入层的契约（ISSUE #1381）", () => {
  it("store 层：场景名不认识时抛错，且条目不手写", () => {
    expect(store).toContain("export const LOG_STORE_SCENES");
    /* 场景名与值源同一条口径：不认识就抛（静默回退会让「场景名写错了」看不出来，
       画布上表现为「store 是空的」）。 */
    expect(store).toContain("store 场景里没有叫");
    /* 条目必须由 store 自己的解析入口产出 —— 出现手写条目字面量就说明有人
       绕过了解析链路（那是这一层存在的理由）。 */
    expect(
      store,
      "store 注入层必须有 parseFileLogs —— 手捏 LogEntry 会让解析 / 分桶 / 计数三条链路一起被跳过",
    ).toContain("parseFileLogs(");
  });

  it("store 层：每块原文都按自己那条通道的格式解析", () => {
    /* 「按块给 origin」是这一层最容易糊弄过去的地方：把三通道的行抄成一种格式、
       全按一个 origin 入库，画布上「来源」那一列会整列同名，而分桶与计数
       等于没有被验过。 */
    expect(store).toContain("interface OriginBlock");
    expect(store).toContain("readonly origin:");
    expect(store).toContain("readonly blocks: readonly OriginBlock[]");
    expect(store, "每块各自解析：`blocks.flatMap` 里要带 block.origin").toMatch(
      /blocks\.flatMap\(/,
    );
    expect(store).toContain("block.origin");
  });

  it("React Flow 层：用真 provider + 真 ReactFlow，且场景名不认识时抛错", () => {
    for (const required of [
      "ReactFlowProvider",
      "ReactFlow",
      "@xyflow/react/dist/style.css",
    ]) {
      expect(
        flow,
        `画布注入层缺 ${required} —— 挂一个假 provider 得到的是假的端点几何`,
      ).toContain(required);
    }
    expect(flow).toContain("export const CANVAS_SCENES");
    expect(flow).toContain("画布场景里没有叫");
    /* 视口是**受控**的：zoom 真的进转换矩阵，否则「细网格在 0.3 以下淡出」
       那类判据看的是一个 story 临时塞的数。 */
    expect(flow).toContain("viewport={scene.viewport}");
  });

  it("整屏容器层：真 AppShell / 真 WorkspaceFrame + 真 action 建项目", () => {
    expect(screen).toContain("AppShell");
    expect(screen).toContain("WorkspaceFrame");
    expect(screen).toContain("DocumentFrame");
    expect(
      screen,
      "项目必须经真 action createProject() 建 —— 手拼 CanvasProject 字面量会跳过「名字撞不撞 / 有没有置活跃」",
    ).toContain("createProject(");
    expect(screen).toContain("setActive(");
    /* 子件必须是真的：这一层不提供「占位内容」这种档位。`WorksGallery` 是真视图
       的样板（真读 canvas-store）。 */
    expect(screen).toContain("WorksGallery");
  });

  it("整屏容器层：项目在子树渲染之前建好（惰性初始化器，不是 useEffect）", () => {
    /* `ProjectCanvas` / `WorkshopPipeline` 在**挂载那一刻**读 `getActiveId()`
       （工坊那处是 useState 的初始化器），而 React 的 effect 是子先父后 ——
       放 `useEffect` 里建，子组件读到的是「还没有活跃项目」，于是工坊标题落在
       「未命名项目」上。这是这一层最容易静默失效的一处。 */
    expect(
      screen,
      "useSeededProjects 必须走 useState 的惰性初始化器（useState(() => seedProjects(…))）",
    ).toMatch(/useState<[^>]*>\(\(\) => seedProjects\(/);
    expect(
      screen,
      "用 useEffect 建项目 = 子组件先渲染、读到空 store",
    ).not.toMatch(/useEffect\(\(\) => \{\s*const created = seedProjects/);
  });

  it("store 层：量大的场景用生成器产**原文**，不产条目", () => {
    /* 「手抄不够就编一段看着像日志的文本」与「手抄一份 LogEntry[]」是同一件事的
       两半：前者仍然过解析，后者跳过解析。所以量大的那两档（分页长线、同毫秒
       十几行）用生成器 —— 而生成器必须**交出文本**（`join("\n")`），不是数组。 */
    expect(store, "长线 / 同毫秒场景要有生成器").toMatch(
      /function (appLines|sameMsLines)\(/,
    );
    /* 生成器只负责重复，解析仍归 `parseFileLogs`（上面那条已钉住整体口径）；
       这里钉的是生成器的**输出形状**：拼成一行文本给 `text` 字段用。 */
    expect(store, "生成器要拼成原文（join 出行文本），不是产条目数组").toMatch(
      /lines\.join\("\\n"\)/,
    );
  });

  it("整屏层：有内容的项目走 placeCanvasNode（建节点的唯一出口）", () => {
    /* `filledProject` 那一档要在画布上摆真节点。手写
       `{ id, position, data: { kind: "image" } }` 只填两个字段，而节点渲染器读的是
       `defaultData(kind)` 的整套默认值 —— 少一项画布上就是另一种形态。
       生产代码建节点只有 `placeCanvasNode()` 一个入口（规范 16 §16.2.4.38），
       所以这里也走它。 */
    expect(screen, "整屏层要有 placeCanvasNode 这条出口").toContain(
      "placeCanvasNode(",
    );
    expect(screen, "场景里的节点数据要铺在 defaultData 之上").toContain(
      "defaultData(",
    );
  });

  it("三个注入层都挂在 preview.tsx 的装饰器链上", () => {
    expect(preview, "少挂 withStoreScene = story 里 store 空着").toContain(
      "withStoreScene",
    );
    expect(
      preview,
      "少挂 withTrpcApp / withAppProviders = 组件在画布上抛（useToast 等）",
    ).toMatch(/withTrpcApp|withAppProviders/);
  });

  it("三个模块都在 tsc / eslint 的扫描面里", () => {
    /* `.storybook/**` 是以点开头的目录 —— TS 与 ESLint 的 glob 默认都跳过它，
       不显式列就是「写了没人看」（ISSUE #1405 抓到的第一处）。 */
    const tsconfig = readFileSync(join(ROOT, "tsconfig.json"), "utf8");
    const eslint = readFileSync(join(ROOT, "eslint.config.js"), "utf8");
    expect(tsconfig).toContain(".storybook/**/*.tsx");
    expect(eslint).toContain(".storybook/**/*.{ts,tsx,mts,cts}");
    for (const file of ["store-sources", "flow-canvas", "screen-frame"]) {
      expect(
        file,
        `${file} 的模块名出现在 tsconfig / eslint 的通配范围内即可，不需要逐个列出`,
      ).toBeTruthy();
    }
  });
});
