import { expect, test, type Page } from "@playwright/test";

import { settle, unstableChromeMasks } from "./support/page-baseline";

/**
 * 画布（`ProjectCanvas`）像素基线 —— §11.8 的「xyflow 画布」那一档。
 *
 * ## 为什么它要单独立一份、不能照首页那种写法抄
 *
 * 画布是仓库里**唯一一张由 React Flow 渲染出来的像素面**，比别的屏多两个自由度：
 *
 *   ① **视口** —— 缩放 / 平移落在 `.react-flow__viewport` 的 CSS `transform`
 *      上，由 `fitView` 异步算出（组件里是双 rAF）。视口不钉住，同一份节点数据
 *      能画出无数张不同的图；
 *   ② **落点** —— 节点写的是**画布坐标**，到屏幕上要过一遍视口矩阵。
 *
 * 所以这一档不是「把画布截下来」，而是**先把这两件事钉死再截**：节点坐标由本文件
 * 写死，视口在截图前断言成**固定值**。断言放在截图之前是刻意的 —— 视口漂了该红在
 * 那一句上，而不是红成一张要人看图才知道原因的 diff。
 *
 * ## 数据从哪来（以及为什么视图那一半不能靠预置存储）
 *
 * 项目数据直接写 `canvas-store` 的 localStorage 两个键，值与真形状的
 * `CanvasProject` 同形。这与 `models.visual.spec.ts` 桩 `model.list` 同源：
 * **基线不能随「跑它的这台机器上有什么」变**。
 *
 * ⚠️ 但**视图**不能这么写（本轮实测过）：把 `canvas` 页签预置进 `sessionStorage`
 * 的 `comfyapp:workspace-tabs-v2` 是不成立的 —— `useWorkspaceTabs` 的「恢复」与
 * 「落盘」是两个 effect，落盘那次会抢在恢复的重渲染之前用**初始态**（只有首页一页）
 * 把预置值覆盖掉，于是画布根本打不开。所以视图走**用户真会走的那条路**：
 * 页签条的「＋」→「画布」。
 *
 * ## 这份节点图是按**真端口几何**配的
 *
 * 边能不能画出来，取决于 `sourceHandle` / `targetHandle` 在**源/目标节点上真的
 * 存在**。实测本画布的端口只有两种：
 *
 *   · 每个节点右侧 `output`（内容载体 text / movie 与资产 picture 都有）；
 *   · **只有 `picture`** 左侧有 `inputImage`。
 *
 * 所以「A → B」只在 **B 是 `picture`** 时成立。写成 `text → movie` 这类组合时
 * React Flow 静默不渲染那条边（**不报错**），画布上只是少一根线 —— 那正是这一档
 * 要防的「看着有内容、其实没验到」。因此本文件的边**逐条**都是
 * `output → picture.inputImage`，并用一条断言把边数钉住。
 *
 * ## `project.list` 必须桩成空
 *
 * `hydrateFromServer()` 会用**服务端更新**的那一份覆盖本地
 *（`serverTime >= local.updatedAt` 就换）。不桩的话，「本机 DB 里恰好有个更新的
 * 同名项目」就能改掉这张图 —— 那不是像素退化。
 */

/** 画布存储的两个键（`canvas-store` 的 `INDEX_KEY` / `ACTIVE_KEY`，逐字同源）。 */
const INDEX_KEY = "comfyapp.canvas.projects.v1";
const ACTIVE_KEY = "comfyapp.canvas.active.v1";

/** 项目 id —— 存储里的两份数据（索引 / active）必须指向同一个，否则画布会另建草稿。 */
const PROJECT_ID = "e2e-visual-canvas";

/** 项目名（侧栏与页签都显示它 —— 取一个真实业务里会长成这样的名字）。 */
const PROJECT_NAME = "像素基线 · 城市夜景逐镜";

/**
 * 四张节点：文 → 首帧图 →（成片 / 放大）。
 *
 * `type` 必须是 React Flow 的注册名 `"canvasNode"`（`ProjectCanvas` 的
 * `nodeTypes` 只有 `canvasNode` 与 `workflowArdot`）—— 写成业务 kind 名
 * （`"text"` / `"image"`）时 React Flow 会拿内置 default 节点渲染，
 * 端口与内容区全都不在，画布上是四个空盒子。
 *
 * `data.kind` 才是业务类型（`~/lib/project-canvas/canvas-types` 的 `NodeKind`）。
 * 只写 `kind` 不写其余字段是**够的**：渲染器读的整套默认值由 `defaultData(kind)`
 * 在 `placeCanvasNode()` 里补 —— 但那是**建节点**那条路，而这里直接写持久化形状，
 * 所以只给渲染真正读到的几个字段（`kind` / `label` / `status`）。
 */
const NODES = [
  {
    id: "1",
    type: "canvasNode",
    position: { x: 0, y: 0 },
    data: { kind: "text", label: "逐镜提示词", status: "idle" },
  },
  {
    id: "2",
    type: "canvasNode",
    position: { x: 320, y: -20 },
    data: { kind: "picture", label: "首帧", status: "idle" },
  },
  {
    id: "3",
    type: "canvasNode",
    position: { x: 640, y: 120 },
    data: { kind: "movie", label: "成片", status: "idle" },
  },
  {
    id: "4",
    type: "canvasNode",
    position: { x: 320, y: 320 },
    data: { kind: "picture", label: "放大 2×", status: "idle" },
  },
];

/** 三条连线，逐条满足 `output → picture.inputImage`（见文件头的端口几何说明）。 */
const EDGES = [
  { id: "e1-2", source: "1", target: "2", sourceHandle: "output", targetHandle: "inputImage" },
  { id: "e2-4", source: "2", target: "4", sourceHandle: "output", targetHandle: "inputImage" },
  { id: "e3-4", source: "3", target: "4", sourceHandle: "output", targetHandle: "inputImage" },
];

/**
 * 一份真形状的项目（`CanvasProject` 的字段：`id` / `name` / `updatedAt` /
 * `nodes` / `edges`）。`updatedAt` 写死是为了**不让「谁更新」影响这一档**。
 */
function projectFixture(overrides: Partial<{
  nodes: unknown[];
  edges: unknown[];
  name: string;
}> = {}) {
  return {
    id: PROJECT_ID,
    name: overrides.name ?? PROJECT_NAME,
    updatedAt: 1_700_000_000_000,
    nodes: overrides.nodes ?? NODES,
    edges: overrides.edges ?? EDGES,
  };
}

/**
 * 备好项目（写存储 + 桩 `project.list`），然后 `goto`。
 *
 * 两件都必须在 `goto` 之前：存储要在 `ProjectCanvas` 挂载读取之前就位；
 * `project.list` 的桩要在 `hydrateFromServer()` 发出请求之前生效（那个函数带
 * `hydrated` 一次性标志 —— 第一次查到什么就定下了）。
 */
async function openWorkspaceWithProject(
  page: Page,
  project: ReturnType<typeof projectFixture>,
) {
  await page.addInitScript(
    ([indexKey, activeKey, json, id]) => {
      /* 索引存的是**数组**（`readIndex()` 按数组解析），写成单个对象会被判成坏数据
       * 回落成空表 —— 于是画布找不到活跃项目、另建一个空草稿，画布上什么都没有。 */
      localStorage.setItem(indexKey, json);
      localStorage.setItem(activeKey, id);
    },
    [
      INDEX_KEY,
      ACTIVE_KEY,
      JSON.stringify([project]),
      project.id,
    ] as const,
  );

  /* 只桩 `project.list`，其余照旧打到真服务端：本档的判据与别的过程无关，
   * 全桩成空会让画布上那些真形态（工具条、小地图、设置抽屉）一起消失。 */
  await page.route("**/api/trpc/**", async (route) => {
    if (!route.request().url().includes("project.list")) {
      await route.continue();
      return;
    }
    /* 走真协议形态（JSON Lines）—— `route.fulfill` 一个 JSON 数组喂不进
     * `httpBatchStreamLink`（根因见 `../support/trpc-stub` 的文件头）。 */
    const { trpcJsonlBody } = await import("../support/trpc-stub");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: trpcJsonlBody([[]]),
    });
  });

  await page.goto("/workspace");
  await expect(
    page.getByRole("heading", { name: "灵感从这里开始" }),
  ).toBeVisible();
}

/** 走用户那条路进画布：页签条的「＋」→「画布」。 */
async function openCanvasView(page: Page) {
  await page.getByRole("button", { name: "新页签", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "画布", exact: true }).click();
  await expect(page.locator(".react-flow__pane")).toBeVisible();
}

/**
 * 等画布视口**定下来**，并把它作为基线的一部分断言。
 *
 * 这一档钉的是「视口 + 节点坐标」两件事一起定下的那一张图。`fitView` 的落点由
 * **容器尺寸 + 节点包围盒**决定，两者在本用例里都是固定的（1440×900 视口、
 * 写死的节点坐标、`fullPage: false`），所以它收敛到一个确定值。
 *
 * **为什么要等两次读数一致**：`fitView` 是双 rAF 触发的，且发生在 `hydrating`
 * 翻转之后 —— 直接读第一帧拿到的是过渡态（实测第一帧 `matrix(0.99…, 12.07, 10.06)`
 * 与收敛值 `matrix(0.929…, 118, 100.13)` 差着一截）。所以稳定判据是
 * 「连续两次读数相同」，**不是**「与第一次读数相同」——后者在收敛完成前会一直
 * 判失败，而那是判据写错、不是界面有问题。
 *
 * 断言而不是「设一个值」：React Flow 没有把 `setViewport` 暴露到 DOM 上的口
 * （没有全局实例、也没有 data 属性），而从未公开的内部钩子拿会把基线绑在库的私有
 * 实现上。所以这里判的是**结果稳定** —— 视口漂了会让这句红，话术直接指出
 * 「是视口变了，不是界面变形」。
 */
async function expectPinnedViewport(page: Page): Promise<string> {
  const viewport = page.locator(".react-flow__viewport");
  const read = () => viewport.evaluate((el) => getComputedStyle(el).transform);

  /* 先等它停下：连续两次读数相同算定下来（§11.8 的「连跑两次都绿」在这句上的形状）。
   * 话术放在断言里而不是 `toPass` 的 options 上 —— 这个 vitest 的 `toPass` 只认
   * `timeout` / `intervals`（写了 `message` 是 tsc 的错误，实测 TS2353）。 */
  await expect(async () => {
    const before = await read();
    await page.waitForTimeout(150);
    expect(
      await read(),
      "画布视口还在变（`fitView` 未收敛）—— 基线要的是定下来的那一帧，不能截过渡态",
    ).toBe(before);
  }).toPass();

  return read();
}

test.describe("画布视觉基线", () => {
  test("有内容项目的画布全屏基线（xyflow 画布档）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspaceWithProject(page, projectFixture());
    await openCanvasView(page);

    /* 四张节点 + 三条连线都真的挂上了。这一句不是「顺便数一数」：
     * 端口的组合写错时 React Flow **静默**不渲染那条边（见文件头），
     * 少一根线的画布照样「有内容」、截图照样出得来。 */
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await expect(page.locator(".react-flow__edge")).toHaveCount(3);

    await expectPinnedViewport(page);
    await settle(page, "无限画布");
    await expect(page).toHaveScreenshot("canvas-filled.png", {
      fullPage: false,
      mask: await unstableChromeMasks(page),
    });
  });

  test("空项目的空画布引导（画布档的空态）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openWorkspaceWithProject(
      page,
      projectFixture({ nodes: [], edges: [] }),
    );
    await openCanvasView(page);

    /* 空画布没有节点可落，所以不判视口 —— 被钉的是那张引导卡本身
     *（它是用户建完项目后唯一能读到的「下一步」）。 */
    await expect(page.locator(".react-flow__node")).toHaveCount(0);
    await settle(page, "右键画布任意位置，开始创建节点");
    await expect(page).toHaveScreenshot("canvas-empty.png", {
      fullPage: false,
      mask: await unstableChromeMasks(page),
    });
  });
});
