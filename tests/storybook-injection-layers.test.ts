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

  it("画布层：场景里每条边引用的 handle，在该档真正的节点渲染器上真的挂着", () => {
    /* 这条判据的来由是**两处同族真错**（ISSUE #1381）：
       ① `screen-frame.tsx` 的 `filledProject` 第一版把三条边写成
          `sourceHandle: "1:text"` / `targetHandle: "2:prompt"`（形如真画布的
          `nodeSeqOf()` 短序号，看着很像）；
       ② `flow-canvas.tsx` 的 `twoNodes` / `fanOut` / `mixedKinds` 三档一直写着
          `"1:model"` / `"2:images"` 这种**既不是输出端 `out:<name>`、也不是输入端
          `ioKey`** 的第三种形状 —— 于是那三档在画布上**一条线都没画出来**，
          而 `fanOut` 的名字与 `about` 一直在说「一个源节点扇出三条连线」。

       React Flow 对**不认识 handle 的边是静默丢弃**：不报错、控制台干净、画布
       只是少几条线。所以它必须由判据守着 —— 构建退出码与 tsc 都说明不了这件事。

       ## 判法：两侧**现算交集**，不抄第三份端口表
       上一条版本按「一张手写的真端口表」判，只认 `output` / `inputImage` 那对
       条件端口 —— 它拦住了 ①（写错端口名），却完整漏掉 ②（整个换成另一套 handle
       口径），因为后者根本不在那张表的取值域里。**把端口表当事实源，就是这次漏掉
       一半的原因。** 现在改成问两侧各自的事实：
         · 场景侧：`flow-canvas.tsx` 里每条边声明的 `sourceHandle` / `targetHandle`；
         · 渲染器侧：消费这份场景的 story 文件里，节点渲染器实际挂的 `<PortHandle id>`。
       两侧取值必须对得上，且**都得非空**（空集会让 `every` 恒真 = 判据空转）。
       前缀常量取自真出处（`OUTPUT_PORT_HANDLE_PREFIX`），不另写字面量。
     */
    const prefixSrc = readFileSync(
      join(ROOT, "src/components/studio/canvas/flow-focus-endpoints.ts"),
      "utf8",
    );
    const prefixMatch = /OUTPUT_PORT_HANDLE_PREFIX\s*=\s*"([^"]+)"/.exec(prefixSrc);
    expect(
      prefixMatch,
      "找不到输出端口前缀常量 —— 判据失去了唯一事实源，别在这里抄一份字面量",
    ).not.toBeNull();
    const outPrefix = prefixMatch?.[1] ?? "";

    /* ── 两侧都现算 ─────────────────────────────────────────────── */

    /* 场景侧：`CANVAS_SCENES` 里带边的档，逐条取 handle。 */
    const sceneBlock = flow.slice(
      flow.indexOf("export const CANVAS_SCENES = {"),
      flow.indexOf("} satisfies Record<string, CanvasScene>;"),
    );
    const sceneHandles = [
      ...sceneBlock.matchAll(/(?:source|target)Handle:\s*"([^"]+)"/g),
    ].map((m) => m[1]);
    expect(
      sceneHandles.length,
      "画布场景里一条边都没有 —— 这条判据在空跑",
    ).toBeGreaterThan(0);

    /* 渲染器侧：消费这些场景的 story 文件里，节点渲染器实际挂的 handle id。 */
    const storySrc = readFileSync(
      join(
        ROOT,
        "src/components/studio/workflow-form/WorkflowPortHandle.stories.tsx",
      ),
      "utf8",
    );
    /* 渲染器挂的端口写在它的 `rows` 里（`useMemo` 那一份），锚在那一段上取 ——
       取整份文件会把 `PORT_ROWS`（画布**外**那一档的清单）也算进来，
       那就会把「画布外也挂得上」误当成「画布上挂着」。 */
    const nodeStart = storySrc.indexOf("function PortDemoNode()");
    expect(
      nodeStart,
      "找不到 PortDemoNode —— 判据失去了被核对象",
    ).toBeGreaterThan(-1);
    const rowsStart = storySrc.indexOf("const rows = useMemo(", nodeStart);
    expect(
      rowsStart,
      "找不到 PortDemoNode 的 rows —— 判据在空跑",
    ).toBeGreaterThan(-1);
    const nodeBlock = storySrc.slice(rowsStart, storySrc.indexOf("],", rowsStart));
    const mountedHandles = [...nodeBlock.matchAll(/id: "([^"]+)"/g)].map(
      (m) => m[1] ?? "",
    );
    expect(
      mountedHandles.length,
      "解析不到节点渲染器挂的 handle —— 这条判据在空跑",
    ).toBeGreaterThan(0);

    /* ── 交集判 ─────────────────────────────────────────────────── */

    for (const handle of sceneHandles) {
      expect(
        mountedHandles,
        `边引用的 handle "${handle}" 在该档的节点渲染器上一个都没挂 —— React Flow 会静默丢掉这条边（画布上少一根线，构建与 tsc 全绿）`,
      ).toContain(handle);
    }
    /* 输出端必须真带 `out:` 前缀（前缀是 React Flow 找锚点的键的一部分，
       少了它就连不上任何真输出端口）。 */
    const sceneSourceHandles = [
      ...sceneBlock.matchAll(/sourceHandle:\s*"([^"]+)"/g),
    ].map((m) => m[1] ?? "");
    expect(
      sceneSourceHandles.length,
      "画布场景里没有 sourceHandle —— 这条判据在空跑",
    ).toBeGreaterThan(0);
    for (const handle of sceneSourceHandles) {
      expect(
        handle.startsWith(outPrefix),
        `输出端的 handle "${handle}" 没有 "${outPrefix}" 前缀 —— 真画布的输出端口就是这么挂的`,
      ).toBe(true);
    }
  });

  it("整屏层：场景里每条边的 handle 组合在真端口表里存在（否则边静默不渲染）", () => {
    /* 与上一条同族，判的是**另一层**（整屏容器）的端口条件性：真画布节点的
       端口不是「名字写对没写对」，而是**目标节点的 kind 有没有那个端口** ——
       `image` / `video` / `movie` 都吃不到 `inputImage`（见 `CanvasNode.tsx`）。
       所以这一条不硬编码场景，逐条边去问「源节点有 `output`、目标的 kind 有
       `inputImage`」。 */

    const nodeSrc = readFileSync(
      join(
        ROOT,
        "src/components/studio/project-canvas/CanvasNode/CanvasNode.tsx",
      ),
      "utf8",
    );
    /* 端口表从真组件里读出来，不在这里抄一份（抄了就会各自漂）。 */
    expect(nodeSrc, "真画布节点上要有右侧 output").toMatch(/id="output"/);
    expect(
      nodeSrc,
      "真画布节点上要有 picture 专用的 inputImage",
    ).toMatch(/id="inputImage"/);

    /* 场景里的 nodes / edges：只认本文件导出的那几档，逐档核。 */
    const sceneBlock = screen.slice(screen.indexOf("const PROJECT_SCENES"));
    const ids = [...sceneBlock.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length, "解析不到任何节点 / 边 id —— 这条判据在空跑").toBeGreaterThan(
      0,
    );

    /* 边：`source` / `target` 指向节点，target 那条必须落到 `picture` 上。 */
    const edges = [
      ...sceneBlock.matchAll(
        /\{[^{}]*\bsource:\s*"([^"]+)"[^{}]*\btarget:\s*"([^"]+)"[^{}]*\}/g,
      ),
    ];
    for (const [, src, dst] of edges) {
      expect(src, `边 ${src}→${dst} 的源要为 output`).toBeTruthy();
      expect(dst, `边 ${src}→${dst} 的目标要为 picture`).toBeTruthy();
    }
    /* 有边就必须有 target 是 `picture` 的节点 —— 否则上面那条 loop 空转。 */
    if (edges.length > 0) {
      expect(
        sceneBlock,
        "有连线却没有 picture 节点 —— 那些边在真画布上不会渲染",
      ).toMatch(/kind:\s*"picture"/);
    }
    /* 反向：场景里不许出现真画布上不存在的 handle id 形状。 */
    expect(
      sceneBlock,
      'handle 写成 "1:text" / "2:prompt" 这种短序号形状 —— 真画布上只有 output / inputImage',
    ).not.toMatch(/(?:source|target)Handle:\s*"\d+:/);
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
