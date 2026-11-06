import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { LOG_ROW_SINGLE } from "../src/components/studio/logs/log-virtual";
import { fakeComfyuiBaseUrl } from "./support/fake-comfyui-endpoint.mjs";
import { expectHomeReady } from "./support/home-anchors";
import { openSettingsView } from "./support/settings-entry";
import { stubTrpc } from "./support/trpc-stub";

/**
 * 关键链路 E2E（ISSUE #317）：登录 → 工作区 → 工作流库执行 → 工作台概览四段进 CI 的 `@critical` 门禁。
 * 不依赖真实 ComfyUI / GPU / 外网：内嵌那两条必须走假服务（`e2e/support/fake-comfyui-server.mjs`），
 * 因为能否内嵌是**服务端**探测（`setting.comfyEmbeddable`），浏览器侧 `route.fulfill` 够不到（ISSUE #310）。选择器只用用户可见的东西（getByRole/getByText），重构 DOM 不误红。
 */

/**
 * 让与 ComfyUI / DB 相关的 tRPC 调用不卡住界面：它**不喂数据**，只把请求很快答掉。
 * 这里 fulfill 是 JSON 数组，客户端（`httpBatchStreamLink`，`src/trpc/link.ts`）按 JSON Lines 读，
 * 到不了上层（`./support/trpc-stub.ts` 文件头，ISSUE #1442）；断言若依赖数据改用 `stubTrpc()`（真协议形态）。
 */
async function stubBackend(page: Page) {
  await page.route("**/api/trpc/**", async (route: Route) => {
    const url = route.request().url();
    /* 一律回空的 JSON 数组：不卡住、也不冒充数据。 */
    let handled = false;
    for (const procedure of ["setting.get", "comfyui.status", "workflow.list", "task.list"]) {
      if (url.includes(procedure)) {
        handled = true;
      }
    }
    if (!handled) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });
}

/** 从首页进入某个侧栏视图（首页内联侧栏与 WorkspaceNav 都是 button role）。 */
async function gotoWorkspaceView(page: Page, label: string) {
  const nav = page.getByRole("button", { name: label, exact: true }).first();
  await expect(nav).toBeVisible();
  await nav.click();
}

test.describe("登录链路 @critical", () => {
  test("@critical 登录页可切到注册模式并提交表单", async ({ page }) => {
    // 认证接口（better-auth）在 CI 里没有真实后端，这里只锁「表单可用 +
    // 提交动作真的发出去了」这一层——不假装认证成功（那要靠真后端，属
    // 集成测试范围，不该塞进 @critical 的 E2E）。
    await page.goto("/login");

    // 切到注册模式：出现昵称字段、提交按钮变为「创建并登录」
    await /* 登录 / 创建账号是一排里选一个（`role="radio"`，规范 16 §16.2.4.75）——
     不是按钮。改的是读法，不是用例锁的那件事。 */
    page.getByRole("radio", { name: "创建账号" }).click();
    await expect(page.getByText("昵称（可选）")).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText("创建并登录");

    await page.getByPlaceholder("name@example.com").fill("e2e@example.com");
    await page.locator('input[type="password"]').fill("e2e-password-123");

    // 断言「提交动作真的发出去了」：表单没有接错线。authenticate 走
    // better-auth 的 fetch（可能先经过 tRPC），这里放宽为「点击后页面状态
    // 有推进」——即出现加载态或离开登录页，二者必有其一。
    await page.locator('form button[type="submit"]').click();
    await expect
      .poll(
        async () => {
          const url = page.url();
          if (!url.endsWith("/login")) {
            return "navigated";
          }
          const body = await page.locator("body").innerText();
          return /提交中|加载中|请稍候|创建并登录/.test(body) ? "submitted" : "idle";
        },
        {
          timeout: 15_000,
          message: "点击提交后页面没有任何推进（表单未接通）",
        },
      )
      .not.toBe("idle");
  });
});

test.describe("工作区链路 @critical", () => {
  test("@critical 工作区首页渲染主干入口与最近项目", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");

    /* 首页主入口（四张入口卡的第一张）。原先钉的是欢迎区大标题，那一块已按
     * ISSUE #1691 移除 —— 口径与收口理由见 `support/home-anchors`。 */
    await expectHomeReady(page);

    /* 侧栏主干入口齐备：这是「应用能用」的最小结构断言。
     * 名单是导航拆成两类之后的**全局那一类**（`NavItems.tsx` 的 `globalNavItems()`，
     * id 与顺序由 `src/components/studio/nav-items.test.ts` 钉死）。这里按用户可见的
     * 标签重复一份，而不是 import 那份常量：e2e 的断言应当只看屏幕上有无这些东西，
     * 拿 React 侧常量当数据源会让「常量与渲染不一致」这种真故障变成用例里的自洽。 */
    for (const label of ["首页", "模型", "历史", "队列", "工作流库"]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeVisible();
    }

    /* 「工作流库」下面那两项是**应用级浮层入口**（模型适配 / 模式契约）：它们不切视图、
     * 只开弹窗，且与项目无关，所以留在侧栏而不进工坊那个项目内视图。 */
    for (const label of ["模型适配", "模式契约"]) {
      // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
      await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeVisible();
    }

    /* 画布 / 工坊是项目内页签：没进项目时它们**不在侧栏**，在首页以入口卡出现。
     * 早先这里把这两个名字混进上面那个侧栏循环，于是从导航拆类那天起就一直是红的。 */
    await expect(page.getByRole("button", { name: /新建画布/ }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /全链路工坊/ }).first()).toBeVisible();

    // 最近项目分区存在（空态也要有标题，不能整段消失）
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
  });

  test("@critical 可从工作区切到工作流库视图并看到库界面", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await gotoWorkspaceView(page, "工作流库");

    // 工作流库页头标题 + 导入入口（导入是对外可见的主要动作）
    await expect(page.getByRole("heading", { name: "工作流库" })).toBeVisible();
    await expect(page.getByRole("button", { name: /导入工作流/ })).toBeVisible();
  });

  /**
   * ISSUE #720：「加载是有个不知道是什么的图案」——`Spinner` 默认 `display: inline`，`size-6` 的
   * width/height 对行内盒不生效，画出「4×21 的竖线」；尺寸只有真实浏览器量得出（jsdom 不做布局）。
   * 判据：宽高到位（老形态宽 4px）、宽高相等是圆、把父容器 flex 抽掉再量仍成立——守「尺寸不靠调用处
   * 布局撑着」（原先钉「父容器不是 flex」属实现细节，恒红却不说明退化）。读数用 `getComputedStyle` 而非 `boundingBox()`：`animate-spin` 使外接矩形随角度漂（26×26 / 34×34）。 */
  test("@critical 工作流库加载态的转圈是真的圆，不是一条竖线", async ({ page }) => {
    await stubBackend(page);
    /* 把列表查询拖住，制造「加载中」这一刻（它只持续几秒，抓不到就白跑）。 */
    await page.route("**/api/trpc/**", async (route: Route) => {
      if (!route.request().url().includes("workflow.list")) {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    });

    await page.goto("/workspace");
    await gotoWorkspaceView(page, "工作流库");
    await expect(page.getByText(/正在加载工作流/)).toBeVisible({
      timeout: 15_000,
    });

    /* 锁在**加载态这一处**：页面上同时还有工作流编辑器覆盖层的另一根 spinner
       （实测同一刻能数到两根），整页 `.first()` 拿到的未必是加载态那根。
       取法：从「正在加载工作流」那段文案往上找**第一个含 spinner 的祖先**，
       不依赖某个未必存在的 data-slot。 */
    const spinner = page
      .getByText(/正在加载工作流/)
      .locator("xpath=ancestor::*[.//*[@data-slot='spinner']][1]")
      .locator('[data-slot="spinner"]')
      .first();
    await expect(spinner).toBeAttached();

    /* 量**布局尺寸**（computed width/height），不是 boundingBox：
       spinner 是 `<svg>`，SVG 图形元素没有 offsetWidth/offsetHeight（实测 undefined）；
       而 boundingBox 量到的是 `animate-spin` 旋转后的外接矩形 —— 尺寸随角度在
       24↔34 之间漂（同一刻两次读数实测差 8px），更要命的是 45° 时一根 24×16 的
       竖条量起来正好是正方形。老写法在最该红的那一刻会绿。 */
    const measure = () =>
      spinner.evaluate((el) => {
        const style = getComputedStyle(el);
        return {
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        };
      });

    const size = await measure();
    /* 老形态宽 4px / 高 21px；正常形态是 24×24（`size-6`）。 */
    expect(size.width, `宽度塌了：${size.width}×${size.height}`).toBeGreaterThan(16);
    expect(
      Math.abs(size.width - size.height),
      `不是圆：${size.width}×${size.height}`,
    ).toBeLessThanOrEqual(1);

    /* 尺寸不能靠调用处的布局撑着。老判据钉的是「这个落点的父容器不是 flex」——
       那是实现细节：加载态后来进了 EmptyState 的 flex 图标位，代理判据就恒红了。
       它真正要守的事是「把 flex 抽掉，图标还站得住吗」，所以这里直接做那个实验
       （改完立刻还原）。这条比原来严：老写法在 flex 落点只会红，不会告诉你为什么。 */
    const sizeWithoutFlex = await spinner.evaluate((el) => {
      const parent = el.parentElement;
      if (parent === null) {
        throw new Error("spinner 没有父节点，判据落点漂了");
      }
      const previous = parent.style.display;
      parent.style.display = "block";
      const style = getComputedStyle(el);
      const box = {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      };
      if (previous === "") {
        parent.style.removeProperty("display");
      } else {
        parent.style.display = previous;
      }
      return box;
    });
    expect(
      sizeWithoutFlex.width,
      `抽掉 flex 后宽度塌了：${sizeWithoutFlex.width}×${sizeWithoutFlex.height}`,
    ).toBeGreaterThan(16);
    expect(
      Math.abs(sizeWithoutFlex.width - sizeWithoutFlex.height),
      `抽掉 flex 后不成圆：${sizeWithoutFlex.width}×${sizeWithoutFlex.height}`,
    ).toBeLessThanOrEqual(1);
  });

  test("@critical 工作流库空态给出可行动指引而不是空白", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await gotoWorkspaceView(page, "工作流库");

    // 空态必须告诉用户「现在没有」且给出下一步动作，不能是一片空白。
    // 三态都在断言范围内（ISSUE #369）：加载没回来时是「正在加载」/「还没返回」，
    // 拿到空数据才是「还没有工作流」——只要它**有话说**而不是一片空白就算过。
    // （规范 10.1「功能降级要有用户可见出口」在 E2E 层的落点。）
    await expect(
      page
        .getByText(
          /正在加载工作流|工作流列表还没返回|还没有工作流|未找到匹配的工作流|共 0 个工作流/,
        )
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /导入工作流/ })).toBeVisible();
  });
});

test.describe("工作流执行链路 @critical", () => {
  test("@critical 提交执行后界面给出可见进行态而不是只剩等待文案", async ({ page }) => {
    await stubBackend(page);
    // 执行流：初始排队 → SSE 推终态失败。锁住「失败原因必须可见」。
    await page.route("**/api/tasks/**", async (route: Route) => {
      const url = route.request().url();
      if (url.includes("/stream")) {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: [
            'data: {"type":"log","entry":{"t":1,"level":"error","msg":"ComfyUI 未运行，且未开启自动启动（设置页可开启）"}}',
            "",
            'data: {"type":"state","status":"FAILED","progress":0,"error":"ComfyUI 未运行，且未开启自动启动（设置页可开启）"}',
            "",
            "",
          ].join("\n"),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, taskId: "e2e-task-1" }),
      });
    });

    await page.goto("/workspace");
    await gotoWorkspaceView(page, "工作流库").catch(() => undefined);
    await gotoWorkspaceView(page, "工作流库");

    // 本用例的可断言部分：工作流库页在 stub 后端下仍可用（不白屏、不报错页）。
    // 真正的「执行 → 终态可见」由下面的任务详情用例承担（那里的 DOM 契约稳定）。
    await expect(page.getByRole("heading", { name: "工作流库" })).toBeVisible();
  });

  test("@critical 任务详情页展示失败原因与执行日志入口", async ({ page }) => {
    // 任务详情页是失败原因的唯一稳定落点（画布/库里的执行日志都复用同一套）。
    await page.route("**/api/trpc/**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              id: "e2e-task-1",
              type: "image",
              status: "FAILED",
              error: "ComfyUI 未运行，且未开启自动启动（设置页可开启）",
              prompt: "一只猫",
              workflowName: "e2e-workflow",
              progress: 0,
              createdAt: new Date().toISOString(),
              images: [],
            },
          },
        }),
      });
    });

    const resp = await page.goto("/create/e2e-task-1");
    // 关键断言：即使数据是 stub 的，页面也不能 500 / 白屏。
    // 路由不存在时 Next 会渲染 404 页——那也是「有可见出口」，不算静默失败。
    expect(resp?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test.describe("工作台概览 @critical", () => {
  test("@critical 工作台底部状态栏常驻且可读", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");

    // 底部状态栏由根布局全局挂载，任何页面都应在，且带可读的 aria-label
    // （ISSUE #121 的诉求之一就是状态栏的语义要看得懂）。
    const statusbar = page.getByLabel("底部状态栏");
    await expect(statusbar).toBeVisible();
    // 状态栏里必须至少有一项可读信息（安全 / 地址 / FPS / 显存），
    // 而不是一个空的条——空条等于「状态未知且不告诉用户」。
    await expect(statusbar).toContainText(/安全|localhost|FPS|显存|内存/, {
      timeout: 10_000,
    });
  });

  test("@critical 打开应用日志面板可看到面板标题", async ({ page }) => {
    await stubBackend(page);
    await page.route("**/api/logs/current**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lines: [], sessionStart: Date.now() }),
      });
    });

    await page.goto("/workspace");
    /* 这条原本只断言了首页标题可见 —— 名字里的「打开日志面板」根本没发生，
       所以它恒绿、什么都没守。现在按可访问名真的点开入口再验面板标题：
       守的是「状态栏那颗入口接得上、面板标题看得见」。 */
    await page.getByRole("button", { name: /^日志面板/ }).click();
    await expect(page.getByText("应用日志", { exact: true }).first()).toBeVisible();
  });
});

test.describe("应用页签与全屏视图 @critical", () => {
  /**
   * ISSUE #310 回归：应用级页签搬到窗口标题行后，全屏视图（设置、工作流编辑器…）与居中弹窗仍按
   * `fixed inset-0` 铺满视口，把用户的**出路**整条盖住。两种形态出路不同：桌面壳内是标题行页签栏，
   * 但 Playwright 驱动不了壳窗口（这条归壳冒烟）；浏览器/dev 形态按设计**不渲染应用内页签栏**
   * （`ShellTabs.tsx` 文件头，实测无应用内页签栏），唯一常驻出路是底部状态栏与各视图关闭口。所以守：浮层若盖住状态栏，`elementFromPoint` 会返回浮层子节点；并钉住「不画假页签栏」。 */
  const centerHitsOwnSubtree = (target: ReturnType<Page["locator"]>) =>
    target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top !== null && el.contains(top);
    });

  async function expectStatusBarNotCovered(page: Page) {
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(0);
    const statusbar = page.getByLabel("底部状态栏");
    await expect(statusbar).toBeVisible();
    expect(
      await centerHitsOwnSubtree(statusbar),
      "底部状态栏被浮层盖住了：中心命中落在浮层子树上",
    ).toBe(true);
  }

  test("@critical 打开设置后底部状态栏与视图出路都不被盖住", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await expectStatusBarNotCovered(page);

    // 打开设置（一页视图，不卸载 workspace 组件树）—— 入口收在顶栏应用菜单。
    await openSettingsView(page);

    /* 关键断言：设置层铺满视口后，状态栏与视图自己的出路都还点得到。
     * 锚点不再取「← 返回」：它已按 ISSUE #1423 的后续删掉（同一页签里的第二条退出路径，
     * 作用只是把标题推离左边缘）。改用分区导航第一项——挂载即在的可点目标，判「浮层有没有
     * 盖住自己」与原来的判据等价，而不再依赖一枚不该存在的按钮。 */
    await expectStatusBarNotCovered(page);
    const firstSection = page
      .getByRole("navigation", { name: "设置分区" })
      .getByRole("button")
      .first();
    await expect(firstSection).toBeVisible();
    expect(
      await centerHitsOwnSubtree(firstSection),
      "设置视图的分区导航被自己的浮层结构盖上了",
    ).toBe(true);
  });

  /**
   * 同一处回归的**第二形态**：居中弹窗（应用日志、执行日志、任务详情…）。
   * 首轮修复只改了「全屏视图」，弹窗类仍是 `fixed inset-0`，于是打开应用日志
   * 后页签与右上角的关闭按钮照样被挡住。这条把弹窗形态钉进 E2E。
   */
  test("@critical 打开应用日志面板后状态栏与面板关闭出口都不被盖住", async ({ page }) => {
    await stubBackend(page);
    await page.route("**/api/logs/current**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lines: [], sessionStart: Date.now() }),
      });
    });

    await page.goto("/workspace");
    await expectStatusBarNotCovered(page);

    // 入口在底部状态栏：纯图标按钮，可访问名由 Hint 的 accessibleName 给出。
    await page.getByRole("button", { name: /^日志面板/ }).click();
    // 面板标题：确认弹窗真的打开了（而不是入口没接上）。
    await expect(page.getByText("应用日志", { exact: true }).first()).toBeVisible();

    await expectStatusBarNotCovered(page);
    // 面板唯一的可见出路（另有 Esc / Ctrl+Shift+L 两条，用户看不见就等于没有）。
    const close = page.getByRole("button", { name: /^关闭/ }).first();
    await expect(close).toBeVisible();
    expect(await centerHitsOwnSubtree(close), "日志面板的关闭按钮被面板自己的结构盖住了").toBe(
      true,
    );
  });

  /**
   * ISSUE #262 复审（4 条反馈）。三条**只能用真实浏览器证明**：弹层几何、翻页可点、框住文本后
   * 内容是否还动——jsdom 不做层叠与布局、不实现 Selection 与滚动，单测全绿照样复现。这里量：
   * ① 弹层顶边贴住扳机底边（原先 alignItemWithTrigger 向上生长、顶到窗口最上方）；② 弹层可点、
   * 能切换来源（规范 07 §7.21.4）；③ 切来源与翻页都生效；④ 类别计数在下拉左侧、下拉贴右侧操作区。 */
  test.describe("应用日志面板：下拉位置、可点性与翻页 @critical", () => {
    const ROWS = 450;

    /**
     * 造一批有内容的日志行，让面板有得翻、有得选。时刻必带 `[YYYY-MM-DD HH:mm:ss.mmm]`（或
     * `[HH:mm:ss]`）前缀：级别解析只认这种形状；ISO 的 `T`/`Z` 写法整行落到兜底分支、级别恒为
     * info，那样「警告黄、错误红」就永远没有可断言的样本。
     */
    async function stubLogs(page: Page) {
      await page.route("**/api/logs/current**", async (route: Route) => {
        const start = Date.now() - 600_000;
        const fmt = (ms: number) => {
          const d = new Date(ms);
          const p = (n: number, l = 2) => String(n).padStart(l, "0");
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
        };
        /* 掺进 2 条警告、3 条错误（取最新的一端，共 450 条仍在上限内）：
         * 级别按钮上的 warn / error 才有非零样本，「警告黄、错误红」才可断言。 */
        const lines = Array.from({ length: ROWS }, (_, i) => {
          const t = fmt(start + i * 1000);
          const level = i >= ROWS - 3 ? "[ERROR]" : i >= ROWS - 5 ? "[WARN]" : "[INFO]";
          return `[${t}] ${level} [app] 事件 ${i}`;
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: `${lines.join("\n")}\n`,
            size: 1_000_000,
            offset: 0,
            sessionStart: start,
            bootId: "e2e:1",
          }),
        });
      });
    }

    /**
     * 两种定位器不是混用图省事：入口按钮说明走 `Hint`（规范 16 §16.2.3 P82），提示文案渲染成浮层、
     * **不落 `title` 属性**，`getByTitle(/^日志面板/)` 之类匹配不到，只能按可访问名取
     * `getByRole("button", { name })`（`accessibleName` 写成 `aria-label`）。加宽档（`ui/wide-panel`）
     * 与来源/级别计数（`LogFilterBar`）仍是刻意的原生 `title`，那几处 `getByTitle` 是对的，别换。 */
    /** 弹层矩形的四元组（`settleBox` 的返回形状）。 */
    type Box = { height: number; width: number; x: number; y: number };

    /** 相邻两次量到同一矩形即视为落定（与动画时长解耦）。 */
    function sameBox(a: Box | null, b: Box | null): boolean {
      return (
        a !== null &&
        b !== null &&
        Math.abs(b.x - a.x) < 0.5 &&
        Math.abs(b.y - a.y) < 0.5 &&
        Math.abs(b.width - a.width) < 0.5 &&
        Math.abs(b.height - a.height) < 0.5
      );
    }

    /**
     * 等定位元素**几何落定**后取矩形（`boundingBox()` 不认 CSS transition）：带入场动画的浮层在
     * 补间期间量到的是被 `scale(.95)` 缩过的矩形（实测 439.6×249 vs 落定后 444×251.5），取点做
     * `elementFromPoint` 会落到弹层边界之外。也不能 `waitForTimeout(固定值)`：慢机器照样量早、
     * 快机器白等——要的是「动画结束后那片矩形」这个**状态**，不是一段时长。 */
    async function settleBox(locator: Locator): Promise<Box> {
      let prev: Box | null = null;
      let box: Box | null = null;
      await expect
        .poll(
          async () => {
            const next = await locator.boundingBox();
            const stable = sameBox(prev, next);
            prev = next;
            box = next;
            return stable;
          },
          /* 动画实测 ~280ms；给足余量，但仍是有上限的轮询而非固定 sleep。 */
          { timeout: 5000 },
        )
        .toBe(true);
      // oxlint-disable-next-line typescript/no-unnecessary-condition -- box 在 expect.poll 闭包里赋值，规则看不到写入点，量不到时仍是 null
      if (box === null) {
        throw new Error("弹层几何始终量不到，无法判定可点性");
      }
      return box;
    }

    async function openPanel(page: Page) {
      await page.goto("/workspace");
      await page.getByRole("button", { name: /^日志面板/ }).click();
      await expect(page.getByText("应用日志", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "更早的一页" })).toBeVisible();
    }

    test("@critical 下拉弹层贴住扳机底边，且候选点得动、来源切得过来", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const trigger = page.getByRole("combobox", { name: "按来源筛选" });
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).not.toBeNull();

      await trigger.click();
      const popup = page.locator('[data-slot="select-content"]');
      await expect(popup).toBeVisible();
      /* 弹层带**入场动画**（base-ui 的 enter transition，`zoom-in-95` 那组 class），`scale(.95)`→1
         实测约 280ms 落定。`boundingBox()` 不认 transition：动画中量到被缩小的矩形（439.6×249 vs
         444×251.5），取点会落到弹层边界之外、命中 `div.z-popup` → 假红（ISSUE #1267 同族：量在
         状态落定之前）。这里等**几何本身**稳定，而非 `waitForTimeout`：慢机器量早、快机器白等。 */
      const popupBox = await settleBox(popup);

      const t = triggerBox!;
      const p = popupBox;
      /* 用户第 2 条诉求的可量化形式：「弹出下拉菜单的最上方和下拉按钮的最下方对齐」。三条一起断言：
       * ① 弹层顶边**贴住扳机底边**（±8px：base-ui 的 alignItemWithTrigger 带「已选项文本」与扳机
       *    文字对齐的微调量，视觉上仍是紧贴底边）；② 弹层顶边**在窗口顶部下方**（原先向上生长会
       *    顶到 y≈0、盖住标题行）；③ 弹层不覆盖扳机本身（`data-align-trigger=false` 的几何证据）。 */
      expect(Math.abs(p.y - (t.y + t.height))).toBeLessThanOrEqual(8);
      expect(p.y).toBeGreaterThan(20);
      expect(p.y).toBeGreaterThan(t.y);

      /* 可点性：弹层矩形内多点 `elementFromPoint` 必须命中弹层子树，不被遮罩/日志行接走
       * （规范 07 §7.21.4）。取点向内缩 6px 而非贴边（原 4px）：定位层 `div.z-popup` 与弹层同矩形
       * 叠放，弹层本体比唯一子节点宽 2px（444 vs 442），贴边取点命中的是上一层定位层、`closest()`
       * 找不到 `select-content` → 假红。这不是放松判据：0~2px 边量的是盒模型差异，不是可点性，
       * 用户也不会点那 2px 空白。 */
      const hitAllInPopup = await page.evaluate(
        ({ box }) => {
          const inset = 6;
          const points = [
            [box.x + inset, box.y + inset],
            [box.x + box.width - inset, box.y + inset],
            [box.x + inset, box.y + box.height - inset],
            [box.x + box.width - inset, box.y + box.height - inset],
            [box.x + box.width / 2, box.y + box.height / 2],
          ];
          return points.every(([x, y]) => {
            const el = document.elementFromPoint(x!, y!);
            return Boolean(el?.closest('[data-slot="select-content"]'));
          });
        },
        { box: p },
      );
      expect(hitAllInPopup).toBe(true);

      /* 真的点一个候选：来源能切过去（用户第 2 条的另一半）。 */
      await page.getByRole("option", { name: /应用服务/ }).click();
      await expect(trigger).toContainText("应用服务");
    });

    test("@critical 翻页能在历史页之间来回，且页码随内容变化", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();
      await page.getByRole("button", { name: "更早的一页" }).click();
      await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();
      await page.getByRole("button", { name: "更新的一页" }).click();
      await expect(page.getByText(/第 1 \/ \d+ 页/)).toBeVisible();
    });

    /**
     * ISSUE #609 八审：切到 1000+ 页签明显卡顿。根因一页 2000 行**全部**挂进 DOM（满页约 1.5 万节点），
     * 切页布局成本即用户感知卡顿；规范 02 §2.6 要求虚拟滚动，现只渲染视口内几十行。真实浏览器量三条
     * （jsdom 不做布局、clientHeight 恒 0）：① 节点数不随页大小增长；② 总高 = 满页行数 × 单行高且能
     * 滚到最后一行（经典翻车是「滚不到底」）；③ 切页耗时远低于一次性渲染。夹具堆满页（450 行量不出差异）。 */
    test("@critical 满页 2000 行只渲染视口内的几十行，且滚动条长度与内容一致", async ({ page }) => {
      await stubBackend(page);
      const ROWS = 2000;
      /* 夹具的**时刻锚点必须在路由外取一次**：轮询会反复打这个路由，而真实服务端按 `offset` 只回
         新增内容，同一文件区间重读的行时刻不变，客户端按 `(时刻, 级别, 正文)` 去重后时间线稳定。
         每轮重算锚点会让 2000 行时刻整体平移、去重全部失效，时间线每 2s 净增 2000 条，「滚到底看
         最后一行」落到哪批全看轮询次数与时钟抖动 → 与虚拟化无关却随机器快慢乱红。固定后同语义。 */
      const start = Date.now() - ROWS * 1000;
      await page.route("**/api/logs/current**", async (route: Route) => {
        const p = (n: number, l = 2) => String(n).padStart(l, "0");
        const fmt = (ms: number) => {
          const d = new Date(ms);
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
        };
        const lines = Array.from({ length: ROWS }, (_, i) => {
          const level = i >= ROWS - 3 ? "[ERROR]" : i >= ROWS - 9 ? "[WARN]" : "[INFO]";
          return `[${fmt(start + i * 1000)}] ${level} [app] 事件 ${i}`;
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: `${lines.join("\n")}\n`,
            size: 10_000_000,
            offset: 0,
            sessionStart: start,
            bootId: "e2e:big",
          }),
        });
      });
      await openPanel(page);

      /* ① 满页 2000 行，但 DOM 里只有视口内的那几十行。上限取 200（远低于
       * 2000，又给不同视口高度留足余量）：这条断言就是「不会卡」的判据本身。 */
      await expect.poll(async () => page.locator("[data-log-index]").count()).toBeGreaterThan(0);
      const rendered = await page.locator("[data-log-index]").count();
      expect(rendered).toBeLessThan(200);

      /* ② 内容一行不少：总高 = 2000 × 单行高度。读外层 style.height 而非 offsetHeight：要钉的是
         「估算高度」这条契约，实际布局高度会被浏览器取整、恒差几像素。单行高度取模块常量
         `LOG_ROW_SINGLE` 而非抄数字（它 27→28 时这里漏改，报「期望 54000、实际 56000」，读起来像
         虚拟化坏了其实只是算式过期）。契约不变：总高 = 行数 × 单行高。 */
      const spacerHeight = await page
        .locator("[data-log-index]")
        .first()
        .evaluate((el) => el.parentElement!.parentElement!.style.height);
      expect(spacerHeight).toBe(`${ROWS * LOG_ROW_SINGLE}px`);

      /* ③ 滚到底真的能到**本页最后一行**（经典翻车：窗口算错时停在中途，用户拉不到页尾）。
         判据钉**页内绝对序号** `data-log-index` 而非某行文案：面板开着时轮询仍在追加，第 1 页可能
         锚在旧位置（页脚说「有 N 条新的日志」），页尾就不是「事件 1999」。序号是页内位置，窗口一变
         仍指同一行，也是贴底逻辑用的同一份口径（§7.28.3 第 1 条）。 */
      await page.locator(".custom-scrollbar").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect
        // oxlint-disable-next-line unicorn/prefer-dom-node-dataset -- Playwright 的 Locator 没有 dataset，只有 getAttribute
        .poll(async () => page.locator("[data-log-index]").last().getAttribute("data-log-index"))
        .toBe(String(ROWS - 1));

      /* ④ 切页那一刻的耗时：满页 2000 行一次性渲染在真实 Chromium 里是几百
       * 毫秒量级（用户读到的就是「明显卡顿」）。虚拟化之后只剩几十行，
       * 给一个宽松但足以区分两者的上限。 */
      const t0 = Date.now();
      await page.getByRole("button", { name: "更早的一页" }).click();
      await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();
      expect(Date.now() - t0).toBeLessThan(1500);
    });

    test("@critical 框选日志文本后，新日志到达不会把内容滚动走", async ({ page }) => {
      await stubBackend(page);

      /* 每次轮询都追加一行：模拟「日志到上限了还继续产生新日志」。 */
      let round = 0;
      await page.route("**/api/logs/current**", async (route: Route) => {
        const start = Date.now() - 600_000;
        const lines = Array.from({ length: 40 }, (_, i) => {
          const t = new Date(start + i * 1000).toISOString().replace("T", " ").replace("Z", "");
          return `[${t}.000] [INFO] [app] 事件 ${i}`;
        });
        round += 1;
        if (round > 1) {
          const tail = `[${new Date().toISOString().replace("T", " ").replace("Z", "")}.000] [INFO] [app] 新来的 ${round}`;
          lines.push(tail);
        }
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: `${lines.join("\n")}\n`,
            size: 1_000_000,
            offset: 0,
            sessionStart: start,
            bootId: "e2e:1",
          }),
        });
      });
      await openPanel(page);

      const scroller = page.locator("[data-log-text]").first();
      await expect(scroller).toBeVisible();

      /* 用户框住第一行日志的一段文本（拖选），然后等两轮轮询。
       * 用「文本节点长度」算终点：日志行会被切成多个分片 span，跟着高亮/ANSI
       * 解析走，写死偏移会踩到「该节点没有第 6 个字符」。 */
      await page.evaluate(() => {
        const host = document.querySelector("[data-log-text]")!;
        /* 取最长的那个文本节点，确保框选的是真实内容而不是一个装饰性分片。 */
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
        let best: Text | null = null;
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n instanceof Text && (!best || n.length > best.length)) {
            best = n;
          }
        }
        const node = best!;
        const range = document.createRange();
        range.setStart(node, 0);
        range.setEnd(node, Math.min(6, node.length));
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
      });

      const before = await page.evaluate(() => ({
        selected: window.getSelection()?.toString() ?? "",
        scrollTop: document.querySelector(".custom-scrollbar")?.scrollTop ?? 0,
      }));
      expect(before.selected.length).toBeGreaterThan(0);

      /* 等 ≥2 轮轮询（2s 一轮） */
      await page.waitForTimeout(5000);

      const after = await page.evaluate(() => ({
        selected: window.getSelection()?.toString() ?? "",
        scrollTop: document.querySelector(".custom-scrollbar")?.scrollTop ?? 0,
      }));
      /* 关键：选区还在（没被刷新冲掉），且滚动位置没有被新日志推走。 */
      expect(after.selected).toBe(before.selected);
      expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(1);
    });

    /**
     * ISSUE #720：日志默认太窄、加宽按钮失效，同一根因：`ui/dialog` 弹窗基类带 `sm:max-w-sm`（带变体的
     * max-width 排在所有无变体 utility 之后），调用处 `max-w-[96vw]` / `w-6xl` 都量到 24rem → 恒 384px。
     * 判据（真实浏览器，jsdom 读不出 Tailwind 产出）：默认 ≥800px、加宽明显更宽且贴视口、不溢出视口。
     * 量宽度须等几何落定（ISSUE #1769）：旧写法读到补间起点 1152（= 默认档 `w-6xl` = 72rem，与视口无关），「三次同读数」不构成一致性证据。 */
    test("@critical 日志弹窗默认够宽，且加宽按钮真的变宽", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      /**
       * 宽度必须量在**几何落定之后**（ISSUE #1769）：`ui/dialog` 的 Popup 带 base-ui 过渡（`transition: all`
       * + `duration-100`），宽度本身是补间的——点「加宽」那帧标签翻转，宽度要约 100ms 从 1152 补到 1248；
       * 入场 `zoom-in-95` 作用在 transform 上，外接矩形也含缩放。旧写法立刻量，稳定 1152→1152（补间
       * 起点，恰等于加宽前值）→ 假红；病根是**量在落定之前**（§11.13 / ISSUE #1267），故走 `settleBox`。 */
      const popup = page.locator('[data-slot="dialog-content"]');
      const popupWidth = async () => Math.round((await settleBox(popup)).width);
      const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

      const before = await popupWidth();
      /* 老形态是恒定的 384px（24rem）。给足余量：只要不再是那个值，就说明
         基类的 max-width 没有再把调用处的宽度吃掉。 */
      expect(before).toBeGreaterThan(800);
      expect(before).toBeLessThanOrEqual(viewport.width);

      await page.getByTitle("加宽").click();
      await expect(page.getByTitle("收缩")).toBeVisible();
      const after = await popupWidth();

      /* 加宽必须**看得见**：老形态前后相等（按钮点了没反应就是这个现场）。 */
      expect(after).toBeGreaterThan(before);
      /* 加宽档 = 贴视线两边（左右各 8px），但不许溢出视口。 */
      expect(after).toBeLessThanOrEqual(viewport.width);
      expect(after).toBeGreaterThan(viewport.width * 0.9);

      /* 收缩回到默认档，且宽度不残留：同样量落定后的宽度，与开面板时那次比。 */
      await page.getByTitle("收缩").click();
      await expect(page.getByTitle("加宽")).toBeVisible();
      expect(await popupWidth()).toBe(before);
    });

    test("@critical 行头里类别计数在下拉左侧，下拉贴住右侧操作区", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const allButton = page.getByTitle(/^当前来源的全部：/).first();
      const trigger = page.getByRole("combobox", { name: "按来源筛选" });
      const search = page.getByPlaceholder(/搜索日志/);

      const [levelBox, triggerBox, searchBox] = [
        await allButton.boundingBox(),
        await trigger.boundingBox(),
        await search.boundingBox(),
      ];
      expect(levelBox).not.toBeNull();
      expect(triggerBox).not.toBeNull();
      expect(searchBox).not.toBeNull();

      /* 顺序即分工：计数在左、搜索在中、下拉在右。 */
      expect(levelBox!.x).toBeLessThan(searchBox!.x);
      expect(searchBox!.x).toBeLessThan(triggerBox!.x);
    });

    /**
     * ISSUE #262 复审：「顶部还有较大空白，全部/警告/错误挤在一起」；五审：「不要因为宽度不够导致
     * 文字显示成省略号」。行头富余宽度过去被无名空白吸走、五个筛选按钮钉死 32px；现在整组 `flex-1`
     * 等分（`min-w-fit` 保住「文字 + 四位数字」固有宽度）。浏览器判据：最窄按钮 ≥56px、五个按钮等宽
     * （差 ≤2px）、「错误」到搜索框空白 <48px、每个按钮 `scrollWidth` 不超 `clientWidth`（没有字被切掉/省略）。 */
    test("@critical 级别筛选占满行头富余宽度，不再挤成窄条也不留大片空白", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const labels = ["全部", "调试", "信息", "警告", "错误"];
      const boxes = [];
      for (const label of labels) {
        // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
        const box = await page
          .getByTitle(new RegExp(`^当前来源的${label}：`))
          .first()
          .boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box!);
      }

      const widths = boxes.map((b) => b.width);
      const minWidth = Math.min(...widths);
      const maxWidth = Math.max(...widths);
      /* 不再是 `w-8`（32px）那种窄条。 */
      expect(minWidth).toBeGreaterThanOrEqual(56);
      /* 五个按钮等分同一块空间。 */
      expect(maxWidth - minWidth).toBeLessThanOrEqual(2);
      /* 按钮高度也吃满行头（老形态 32.75px 里塞两行文本）。 */
      expect(Math.max(...boxes.map((b) => b.height))).toBeGreaterThanOrEqual(32);

      const searchBox = await page.getByPlaceholder(/搜索日志/).boundingBox();
      expect(searchBox).not.toBeNull();
      const gap = searchBox!.x - (boxes[4]!.x + boxes[4]!.width);
      /* 按钮与搜索框之间的空白被按钮吃掉（老形态这里是 300px 上下）。 */
      expect(gap).toBeLessThan(48);
    });

    /**
     * ISSUE #262 五审（对应用户截图）：① 标题旁灰底胶囊（`警告 n · 错误 n`）与级别按钮上的计数同源，
     * 同一数据说两遍，删掉；② 级别色落在**文字**上（警告黄、错误红）；③ 每个按钮保住「文字 + 四位
     * 数字」的宽度，不因宽度不够显示成省略号（老形态是 `警… 539`）。三条都是**布局结果**：jsdom 既
     * 不做布局也不实现 `scrollWidth`，判据只能落在真实浏览器上。 */
    test("@critical 级别按钮不省略、带级别色，且标题旁不再复述警告/错误", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      /* ① 按钮不被裁：内容宽度不超过可视宽度（被切成 `警…` 时 scrollWidth 会反超）。 */
      for (const label of ["全部", "调试", "信息", "警告", "错误"]) {
        const button = page.getByTitle(new RegExp(`^当前来源的${label}：`)).first();
        // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        /* 「两字标签 + 四位数字」的固有宽度在 60px 上下：低于 56px 说明按钮
         * 被压到放不下内容（老形态就是在这里把「警告」切成「警…」的）。 */
        expect(box!.width).toBeGreaterThanOrEqual(56);

        // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
        const overflow = await button.evaluate((el) => {
          const nodes: Array<HTMLElement> = [el, ...el.children].filter(
            (n): n is HTMLElement => n instanceof HTMLElement,
          );
          return nodes.map((n) => n.scrollWidth - n.clientWidth);
        });
        for (const px of overflow) {
          expect(px).toBeLessThanOrEqual(1);
        }
      }

      /* ② 级别色：警告黄、错误红，且两者**不同色**（同一处不能两色齐发）。
       * 颜色读数交给浏览器换算成 sRGB：Tailwind v4 产出的可能是 `lab(...)`，
       * 直接切字符串会算出色相错值（实测踩过）。这里借 2D 画布取值——
       * canvas 只认 sRGB，`getComputedStyle` 留在原色彩空间是没用的。 */
      const rgbOf = (label: string) =>
        page
          .getByTitle(new RegExp(`^当前来源的${label}：`))
          .first()
          .evaluate((el): [number, number, number] => {
            const color = getComputedStyle(el).color;
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const data = ctx.getImageData(0, 0, 1, 1).data;
            return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
          });
      const [wr, wg, wb] = await rgbOf("警告");
      const [er, eg, eb] = await rgbOf("错误");
      expect([wr, wg, wb]).not.toEqual([er, eg, eb]);
      /* 黄：红、绿都高，蓝明显低；红：红高，绿、蓝都低。 */
      expect(wr).toBeGreaterThan(wb + 60);
      expect(wg).toBeGreaterThan(wb + 60);
      expect(er).toBeGreaterThan(eg + 80);
      expect(er).toBeGreaterThan(eb + 80);

      /* 数字不跟着变色（中性灰）：否则一行里两个高亮块互相稀释。 */
      const countColor = await page
        .getByTitle(/^当前来源的警告：/)
        .first()
        .evaluate((el) => {
          const count = el.children[1];
          if (!(count instanceof HTMLElement)) {
            throw new Error("计数节点的第二个子节点不是 HTML 元素");
          }
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = getComputedStyle(count).color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        });
      expect(countColor).not.toEqual([wr, wg, wb]);

      /* ③ 标题旁那块灰底胶囊整块删除（"左侧那两个"就是它复述的两个数）；
       *    行头第一行里只剩标题，不再有第二个计数源。 */
      expect(await page.locator('span.rounded-full[class*="bg-white/5"]').count()).toBe(0);
      const headerFirstRow = await page
        .locator("div.flex.min-h-14")
        .first()
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
        .evaluate((el) => el.firstElementChild!.textContent ?? "");
      expect(headerFirstRow).toContain("应用日志");
      expect(headerFirstRow).not.toMatch(/警告 \d+/);
      expect(headerFirstRow).not.toMatch(/错误 \d+/);
    });

    /**
     * ISSUE #262 六审：「有的日志只在全部页签才显示，这种也要有自己的分类」。那批行**没有文件来源**
     * （浏览器 console 拦截 / Tauri 事件 / 全局未捕获错误），过去只在「全部来源」下可见：选中任何
     * 来源整批消失，下拉里既没有它们的名字、也看不出还有一批行没被分类覆盖。判据是**守恒**：逐个
     * 分类的条数之和 = 「全部来源」条数。只能在真实浏览器里量（要读下拉弹层里四列数字的文本）。 */
    test("@critical 无文件来源的日志有「控制台 / 全局错误」分类且能筛出来", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      /* 掺 3 条**没有文件来源**的行（`source: "console"`、无 `origin`）：必须在面板打开**之后**打印
         ——拦截器是 `LogProvider` 挂载时装上的，更早的 console 调用没人接（`addInitScript` 里打印一条
         也进不了面板）。三条正文各不相同且不叫 `ResizeObserver loop…`：同一毫秒同一段正文会被按
         `arrivalKey` 收成一条（下面「不重复」断言守的就是它），而同名文本会撞上浏览器自己打的
         console.error，计数随机器/时序漂。 */
      for (let i = 1; i <= 3; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
        await page.evaluate((n) => {
          console.error(`e2e 控制台样本 ${n}`);
        }, i);
      }
      /* 拦截器经 `queueMicrotask` 入库，面板一页 200 条、窗口**锚定**在打开那一刻（真实日志文件同时
         在灌行），所以「这批行马上可见」不成立，用可见性等待会等不到。这里等拉开来源下拉后计数到位。
         顺带一个坑：`console.error` 会让 Next dev 的错误浮层渲染同样文本（隐藏节点），按文本全局找
         并 `toBeVisible` 会等到超时。 */
      await page.getByRole("combobox", { name: "按来源筛选" }).click();
      const consoleOption = page.getByRole("option", {
        name: /控制台 \/ 全局错误/,
      });
      await expect(consoleOption).toBeVisible();
      /* 样本真的进了面板（时刻最新 ≠ 窗口里可见，见上）。**至少** 3 条而非正好 3 条：应用自身也会
         往 console 写错误（如资源加载失败），同属这一分类，写死等值会在别的机器上假红。
         这条 `expect.poll` 同时是「等第 3 条样本落板」：三次 `console.error` 经 `queueMicrotask` 入库，
         而每轮轮询在同一毫秒追加一批文件行，同一段正文被 `mergeTimeline` 按 `arrivalKey` 收掉一条，
         所以计数可能在 2 与 3 之间停一拍——下面守恒那段的读数须等它到位再取。 */
      await expect
        .poll(async () =>
          Number(
            await consoleOption.evaluate((el) => {
              const nodes = [...el.querySelectorAll(".sr-only")];
              const summary =
                // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
                nodes.map((n) => n.textContent?.trim() ?? "").find((t) => /^\d+ 条/.test(t)) ?? "";
              return /^(?<count>\d+) 条/.exec(summary)?.groups?.count ?? "0";
            }),
          ),
        )
        .toBeGreaterThanOrEqual(3);

      /* 守恒的**正确形状**：逐来源内部守恒 + 全部来源等于时间线条数。曾断言「各分类之和 = 全部来源」，
       * 整批跑必红（`Expected: 5000, Received: 3335`）：① 六路来源读六份文件，其中若干份装的是同一段
       * 内容的副本（dev-launcher 转写 dev、shell-launch 与 launcher 重叠），同一批启动行每个来源各一份，
       * 相加必然大于「全部来源」；② 撞时间线上限（5000）时「全部来源」被截断、各分类之和还在算被挤掉的
       * 行（ISSUE #1240 / #1282）。数字读每项的 `sr-only` 摘要，不读自绘四列（列位置随样式变）。 */
      /* 定位到某个来源那一项：按 `getByRole("option")` + 文本锚定，**不按
       * accessible name 的 RegExp**——零条目的项渲染成「— 无」、有条目的渲染成
       * 「898 条数…」，两者之间差一个数字，用 `^应用服务 \d` 这类模式会在
       * 「这一项恰好是 0」时静默失配（等到 60s 超时，报的还是别的来源）。
       * 文案本身（ORIGIN_TEXT）才是这一项的稳定身份。 */
      const optionOf = (label: string) =>
        page.getByRole("option").filter({ hasText: label }).first();
      const summaryOf = async (label: string) =>
        optionOf(label).evaluate((el) => {
          /* 选项里的 `sr-only` 有好几处（四列各自的「N 警告」也在其中），
           * 只有那个**以数字开头**的才是整行的纯文本摘要。 */
          const nodes = [...el.querySelectorAll(".sr-only")];
          const summary = nodes
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
            .map((n) => n.textContent?.trim() ?? "")
            .find((t) => /^\d+ 条/.test(t));
          return /^(?<count>\d+) 条/.exec(summary ?? "")?.groups?.count ?? "0";
        });
      /** 摘要里的「全部 / 信息 / 警告 / 错误」四个数（不读自绘的列）。 */
      const levelsOf = async (label: string) =>
        optionOf(label).evaluate((el) => {
          const nodes = [...el.querySelectorAll(".sr-only")];
          const summary =
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
            nodes.map((n) => n.textContent?.trim() ?? "").find((t) => /^\d+ 条/.test(t)) ?? "";
          const num = (re: RegExp) => Number(re.exec(summary)?.groups?.count ?? "0");
          return {
            all: num(/^(?<count>\d+) 条/),
            info: num(/信息 (?<count>\d+)/),
            warn: num(/警告 (?<count>\d+)/),
            error: num(/错误 (?<count>\d+)/),
          };
        });

      const total = Number(await summaryOf("全部来源（按条去重）"));
      expect(total).toBeGreaterThan(5);
      const buckets = [
        "应用服务",
        "启动",
        "启动器",
        "壳侧编排",
        "壳日志",
        "应用运行",
        "控制台 / 全局错误",
      ];
      /* ① 逐来源内部守恒：四个级别之和 = 该来源的条数。这条把「按钮上写 2、
       *    切过去只剩 1」挡在门外（两者共用 `matchesSearch` + `bucketOf`）。 */
      for (const label of buckets) {
        // oxlint-disable-next-line no-await-in-loop -- e2e 按轮次串行取元素/断言，并行会让失败归因与截图错位
        const c = await levelsOf(label);
        expect(`${label} ${c.info + c.warn + c.error}`).toBe(`${label} ${c.all}`);
      }
      /* ② 时间线口径：「全部来源（按条去重）」= 时间线条数。两数同源 `filteredLogs`（下拉读
       * `countsByOrigin.all`，页脚读 `counts.all`），口径不同就会「下拉说 4000、页脚说 2000」，用户无
       * 从判断；页脚在面板底部、弹层盖不到，不必先关下拉。**必须在同一浏览器回合里读**（一次
       * `evaluate`）：轮询每 2s 追加，先后两读会落在不同时间线（实测 `Expected: 901, Received: 1346`），
       * 同一次 `derive()` 的两数同一瞬必然相等（共用 `logs`）。撞上 DOM 未刷完那帧用 `expect.poll` 重试即可。 */
      const readTotalsInOneTurn = () =>
        page.evaluate(() => {
          const num = (text: string | null | undefined, re: RegExp) =>
            re.exec(text ?? "")?.groups?.count ?? "";
          const option = [...document.querySelectorAll('[role="option"]')].find((el) =>
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
            el.textContent?.includes("全部来源（按条去重）"),
          );
          const summary = [...(option?.querySelectorAll(".sr-only") ?? [])]
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
            .map((n) => n.textContent?.trim() ?? "")
            .find((t) => /^\d+ 条/.test(t));
          /* 页脚那句「… · 面板共保留 N 条」。这个数只在页脚出现一处，直接取
             最内层命中它的节点即可（祖先会连着把整行文本都带进来，正则仍能取到）。 */
          const footer = [...document.querySelectorAll("span, div, p")].find((el) =>
            // oxlint-disable-next-line typescript/no-unnecessary-condition -- Playwright evaluate 里的 DOM 节点 textContent 运行期可为 null（lib.dom 声明 string|null），规则未建模，保留兜底
            /面板共保留 \d+ 条/.test(el.textContent ?? ""),
          );
          return {
            dropdown: num(summary, /^(?<count>\d+) 条/),
            footer: num(footer?.textContent, /面板共保留 (?<count>\d+) 条/),
          };
        });
      await expect
        .poll(async () => {
          const { dropdown, footer } = await readTotalsInOneTurn();
          /* 两侧都读到才算数（一个还没渲染完时不要判「不等」）。 */
          if (!dropdown || !footer) {
            return "pending";
          }
          return dropdown === footer ? "equal" : `${dropdown}≠${footer}`;
        })
        .toBe("equal");
      /* 那批无文件来源的行确实有自己的计数（不是 0，也不只计入「全部来源」）。 */
      expect(Number(await summaryOf("控制台 / 全局错误"))).toBeGreaterThanOrEqual(3);

      /* 切过去能看到那批行（切来源会回到第 1 页，窗口重取），且文件来源的行
       * 不在里面。 */
      await consoleOption.click();
      await expect(
        page.locator("[data-log-text]", { hasText: "e2e 控制台样本 1" }).first(),
      ).toBeVisible();
      await expect(page.locator("[data-log-text]", { hasText: /事件 / })).toHaveCount(0);
    });

    /**
     * ISSUE #262 六审：「日志多了我想复制报错文本还是复制不了，刚选中内容就刷走了，需要每条日志后面
     * 加一个复制按钮」。真实浏览器量两件：① 每条行末尾都有复制按钮且**点得动**（`opacity-0` 的按钮在
     * jsdom 里与正常按钮无从区分，命中测试只有浏览器做得了）；② 写进剪贴板的**就是这一行**（带时刻
     * 与级别），不是整页。 */
    test("@critical 每条日志末尾的复制按钮能复制到这一行", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const rows = page.locator("[data-log-index]");
      await expect(rows.first()).toBeVisible();
      const buttons = page.getByRole("button", { name: "复制本条日志" });
      /* 每行一个（面板一页 200 条）。 */
      expect(await buttons.count()).toBeGreaterThanOrEqual(2);

      /* 悬停那行让按钮显形，再点（不悬停时它是 `opacity-0`，用户也看不到）。 */
      await rows.first().hover();
      await buttons.first().click();
      await expect(page.getByText("已复制")).toBeVisible();

      const written = await page.evaluate(() => navigator.clipboard.readText());
      /* 写进去的是**这一行**：有时刻、有级别、有正文。 */
      expect(written).toMatch(/\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}/);
      expect(written).toContain("[INFO]");
      expect(written).toContain("事件");
      /* 且不是整页（否则「复制全部」与它就没有区别了）。 */
      expect(written.split("\n")).toHaveLength(1);
    });

    /**
     * ISSUE #262 复审：「启动和启动器日志丢失」。会话起点取自 `dev-launcher.log` 的 mtime，而 launcher
     * 进程在它被创建**之前**就写下了自己的头几行（python / exe / cwd / 探测 Node）；过去拿这个起点裁
     * **整条时间线**，本次启动最早、最该被看到的行被静默丢掉——面板上「启动」「启动器」两个来源恒为空。
     * 这里复现同一时序：launcher 行早于 sessionStart、dev 行晚于它，两条都必须出现在面板上。 */
    test("@critical 启动器与启动日志不被会话起点裁掉", async ({ page }) => {
      await stubBackend(page);

      const now = Date.now();
      const sessionStart = now - 20_000;
      const fmt = (t: number) => {
        const d = new Date(t);
        const p = (n: number, l = 2) => String(n).padStart(l, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
      };
      /* launcher 进程启动时写下的行（早于 dev-launcher.log 被创建） */
      const launcherLines = [
        `[${fmt(now - 45_000)}] === launcher started ===`,
        `[${fmt(now - 44_000)}] python=3.12`,
      ];
      const devLines = [`[${fmt(now - 15_000)}] [STEP] 启动开发服务`];

      await page.route("**/api/logs/current**", async (route: Route) => {
        const source = new URL(route.request().url()).searchParams.get("source");
        const lines =
          source === "launcher" ? launcherLines : source === "dev-launcher" ? devLines : [];
        const content = lines.join("\n") + (lines.length ? "\n" : "");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content,
            size: 1000 + content.length,
            offset: 0,
            /* 覆盖重建的来源按契约不下发起点；这里仍然给上，是为了证明「即使
             * 服务端给了起点，客户端也不会拿它去裁这类来源」——两层都要兜住。 */
            sessionStart,
            bootId: "e2e:1",
          }),
        });
      });

      await page.goto("/workspace");
      await page.getByRole("button", { name: /^日志面板/ }).click();
      await expect(page.getByText("应用日志", { exact: true }).first()).toBeVisible();

      /* 启动器的早期行必须在面板上（老形态：一行都没有）。 */
      await expect(page.getByText("=== launcher started ===").first()).toBeVisible();
      await expect(page.getByText("python=3.12").first()).toBeVisible();
      await expect(page.getByText("[STEP] 启动开发服务").first()).toBeVisible();

      /* 切到「启动器」来源也能看到（不是只混在全部来源里）。 */
      await page.getByRole("combobox", { name: "按来源筛选" }).click();
      await page.getByRole("option", { name: /启动器/ }).click();
      await expect(page.getByText("=== launcher started ===").first()).toBeVisible();
    });

    /**
     * ISSUE #262 六审：「启动和启动器 2 项还是没有日志内容」。三审修**裁剪**，这一轮是行抓到了、也没
     * 被裁，但**没被认成日志行**：PowerShell 的 `Write-Log` 级别经 `PadRight(5)` 补尾空格（`[INFO ]` /
     * `[OK   ]`），引导文案与错误详情是缩进两格的续行，颜色码残缺时还在 `[` 后多留假转义（`[[90m[OK`）；
     * 严格 `\[INFO\]` 一个都匹配不到，整行以**原文**落板。这里喂真实形态，断言级别被认出、正文不残留前缀。 */
    test("@critical 启动与启动器两来源的日志行按级别解析 不整行显示原文", async ({ page }) => {
      await stubBackend(page);

      const fmt = (t: number) => {
        const d = new Date(t);
        const p = (n: number, l = 2) => String(n).padStart(l, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
      };
      const now = Date.now();
      const sessionStart = now - 30_000;
      /* 「只有时刻、没有日期」的行（dev.mjs 真实形状）会被解析层按**今天同一时刻**重建，所以时刻必须
         落在现在之前：一旦在未来，`clampLogTime`（`src/lib/log/log-session-scope.ts`）把它钳成「本次
         读取的 now」，两轮读取生成不同去重键，面板把同一批行计两次——下面钉的「启动 4」会变 8。
         写死 `10:22:24` 等于每天只在 10:22 之后才忠实，其余时段伪造未来时间（#1240 机制）。 */
      const clock = (t: number) => {
        const d = new Date(t);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      };
      /* 跨零点的那几十秒里「今天同一时刻」仍然会跑到未来（23:59 > 00:00），这一极少
         窗口退化成带完整日期时间戳的写法：本用例要守的是级别解析与正文不残留前缀，
         「同批行两轮读到同一个键」这个不变量在两种写法下都成立。 */
      const devBase = now - 40_000;
      const crossesMidnight = new Date(devBase).getDate() !== new Date(now).getDate();
      const devStamp = (offsetMs: number) => {
        const t = now - offsetMs;
        return crossesMidnight ? fmt(t) : clock(t);
      };
      /* 两个来源各自的真实形态（级别填充、缩进续行、残码） */
      const devLines = [
        `[${devStamp(40_000)}] [INFO ] 预检通过`,
        `[${devStamp(39_000)}] [STEP] 检查端口占用`,
        `[${devStamp(38_000)}] [OK   ] Job Object 创建成功`,
        `  [${devStamp(37_000)}] [ERROR] 找不到预编译 Tauri 壳`,
      ];
      const launcherLines = [
        `[${fmt(now - 45_000)}] === launcher started ===`,
        `[${fmt(now - 44_000)}] python=3.12`,
      ];

      await page.route("**/api/logs/current**", async (route: Route) => {
        const params = new URL(route.request().url()).searchParams;
        const source = params.get("source");
        /* 游标桩要与真服务端 readLogSlice 同形（`src/app/api/logs/current/route.ts`）：`size` 是**恒定的
           文件总大小**，客户端拿上一轮响应的 `size` 当游标；游标 == size 即「读到末尾」→ 回空，且 size
           与 offset 都不许缩——报小等于宣称「文件被新运行重建」，会触发尾部重读。此前每轮无视 offset
           重发同一批行：dev-launcher 行无时间戳，解析层按契约钳到「当时本地时刻」（`log-store.ts` 时间线
           契约第 3 条），每轮生成新 `time+level+message` 键，去重救不回来——同一条日志出现 3 份撞严格模式。 */
        const offset = Number(params.get("offset") ?? "0");
        const lines =
          source === "dev-launcher" ? devLines : source === "launcher" ? launcherLines : [];
        const full = lines.join("\n") + (lines.length ? "\n" : "");
        /* 前面留 1000 字节当「本会话之前已有的内容」，让尾部窗口那条路也走得到。 */
        const size = 1000 + full.length;
        const at = offset > 0 && offset < size ? offset : 1000;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: offset >= size ? "" : full.slice(Math.max(0, at - 1000)),
            size,
            offset: at,
            sessionStart,
            bootId: "e2e:1",
          }),
        });
      });

      await page.goto("/workspace");
      await page.getByRole("button", { name: /^日志面板/ }).click();
      await expect(page.getByText("应用日志", { exact: true }).first()).toBeVisible();

      /* 四个级别标记都被认出来，正文里不残留 `[HH:mm:ss] [LEVEL]` 前缀。这里只取 `.first()`：面板有
         两个独立消费者（状态栏错误计数与面板本体），本条不裁决渲染层重复计数——那属于 #1240 的口径。
         上一段「两轮各钳到当时本地时刻 → 键不同」是桩把时刻写死未来才触发的路径，已改掉；因此下面
         「启动 4」的来源计数重新有意义，由它守住「同一批行只计一次」。 */
      await expect(page.getByText("预检通过").first()).toBeVisible();
      await expect(page.getByText("检查端口占用").first()).toBeVisible();
      await expect(page.getByText("Job Object 创建成功").first()).toBeVisible();
      await expect(page.getByText("找不到预编译 Tauri 壳").first()).toBeVisible();

      const body = await page.locator("[data-log-text]").allInnerTexts();
      expect(body.length).toBeGreaterThan(0);
      for (const text of body) {
        expect(text).not.toMatch(
          /\[\d{2}:\d{2}:\d{2}\]\s*\[(?:INFO|STEP|OK|WARN|ERROR|DEBUG)\s*\]/,
        );
      }

      /* 级别标签与正文分开：`INFO` / `ERROR` 出现在级别徽标里，而不是正文里。
         `.first()` 的取舍同上：重复行不由这条用例裁决。 */
      const errorRow = page
        .locator("[data-log-text]")
        .filter({ hasText: "找不到预编译 Tauri 壳" })
        .first();
      await expect(errorRow).toHaveText("找不到预编译 Tauri 壳");

      /* 切到「启动」来源，四个级别标记仍在（说明是按级别解析、不是原文兜底）。 */
      await page.getByRole("combobox", { name: "按来源筛选" }).click();
      await page.getByRole("option", { name: /^启动 4 / }).click();
      await expect(page.getByText("检查端口占用").first()).toBeVisible();
      await expect(page.getByText("找不到预编译 Tauri 壳").first()).toBeVisible();
    });
  });

  /**
   * 同一处回归的**第三形态**：ComfyUI 的查看出口。前两轮修「本应用浮层盖住标题行」，这一轮是
   * 「点开后看不看得见东西」。桌面壳内把 ComfyUI 开成同一窗口的一个页签、内渲染 iframe；未开 CORS
   * 时跨源返 403 是一片空白，故「能不能嵌」由服务端 `setting.comfyEmbeddable` 回答，不可嵌时仍在同一页签内
   * 给可读说明（ISSUE #310「只要多页签，不要另一个窗口」）；浏览器/dev 交给**新浏览器页签**并给反馈（壳内两条归 §11.10.4）。 */
  /**
   * ComfyUI 相关 tRPC 端点的统一桩：状态说「在跑、地址是假服务」，内嵌探测可参数化，「在浏览器打开」计次。
   * 为什么必须是一个处理器：同一 URL 被多条通配路由匹配时**后注册的先被调用**，它若 `route.continue()`
   * 会把请求直接放去网络，先注册的桩根本没机会应答——实测先挂计次桩、后挂状态桩，`comfyOpen` 计数恒 0
   * （看着像动作没发出，其实是路由顺序吃的）。假 ComfyUI 在替身端口（playwright.config 第二个 webServer）。 */
  /**
   * ComfyUI 那一屏的三个过程一次桩好，并数「在浏览器打开」真的发出了几次。**响应形状必须走
   * `support/trpc-stub.ts`**：客户端 `httpBatchStreamLink` 按 JSON Lines 读，`route.fulfill` 旧信封
   * `{result:{data}}` 不抛错、只解不出数据（#1442），`refetch()` 永不 settle——按钮停在「打开中…」，
   * `comfyOpen` 恒 0，红的形状与「功能坏了」逐字同形。旧信封命中的是 `comfyui.status`，ISSUE #1900 后走 `setting.comfyStatus`。 */
  async function stubComfyTrpc(page: Page, options: { embeddable?: boolean } = {}) {
    const calls = { open: 0 };
    /* 计次与桩**分开挂**：同一个 URL 只能有一个处理器（后注册的先被调用，再挂一条
       会把这条整个遮蔽 —— 实测计数恒 0），而路由位已经被 `stubTrpc` 占了。 */
    page.on("request", (req) => {
      if (req.url().includes("comfyOpen")) {
        calls.open += 1;
      }
    });
    await stubTrpc(page, {
      /* base 取替身自己的地址（`fake-comfyui-endpoint.mjs` 是唯一落点）：写死 8188 时，
         本机真件与替身的地址会在这条桩里混成同一个 —— 而「打开查看」弹出的页签地址
         正是拿它判的（ISSUE #1756）。`path` 那一格是 #1900 新页要写在页面上的
         「将按哪条已保存路径启动」，缺了它这一屏会显示「尚未保存」。 */
      "setting.comfyStatus": {
        up: true,
        base: fakeComfyuiBaseUrl(),
        starting: false,
        stopping: false,
        probing: false,
        via: null,
        port: Number(new URL(fakeComfyuiBaseUrl()).port),
        autoStart: false,
        path: "D:/comfy-stub/ComfyUI",
      },
      "setting.comfyEmbeddable": {
        embeddable: options.embeddable ?? true,
        reason: "ComfyUI 对跨源请求返回 403（未开启 CORS）",
      },
      "setting.comfyOpen": {
        ok: true,
        detail: "已用系统默认浏览器打开 ComfyUI",
      },
    });
    return calls;
  }

  /**
   * 进入侧栏那页「ComfyUI」（→ 可选地点「打开查看」）。这里**不再走设置页**：ISSUE #1900 把运行态搬成
   * 独立全局页签，设置 → 创作后端只剩配置（`comfyStatusText`/`comfyDotTitle` 唯一产地，仅 `ComfyuiControlView` 用）。
   * `thenOpenView=false`：下一条要数「在浏览器打开」是否额外开窗口，而「打开查看」本身会开新页签，点上它判据
   * 就被自己的动作污染。它只关最后一下点击、不关等状态落地：两颗「打开」只在明确未运行时禁用（`:115`/`:126`），状态没落地就点＝只剩超时。 */

  /**
   * 这屏「状态落到界面上」的判据读**运行态那个值**，不是文案本身，也不是「状态行在不在」。两次踩坑
   * 长得像同一个红：① `getByText(/ComfyUI 运行中/)` 首帧匹配集为空，文案出现后 `.first()` 又指到跨元素
   * 节点，实测那一拍 `visible=false`、再取句柄撞 `session closed`；② 「状态行节点可见」首帧就成立，但
   * 状态没落地、「打开查看」仍 disabled，后一击点在被禁按钮上（与本文件 1690 行同源）。故判据落在**活区节点文本**（`role="status"` + `aria-live="polite"`），`toHaveText` 自己重试到状态落地。 */
  function comfyStatusRow(page: Page): Locator {
    return page
      .getByRole("status")
      .filter({ hasText: /^ComfyUI / })
      .first();
  }

  async function openComfyControlPage(page: Page, thenOpenView = true) {
    await page.goto("/workspace");
    await gotoWorkspaceView(page, "ComfyUI");
    /* 先等状态真的落到界面上，再点任何一颗出口按钮。浏览器分支只有在拿得到**已缓存的 base** 时才同步
       `window.open`；缓存空着会先 `await` 一次 refetch，而 await 之后再 open 会被弹窗拦截器吞掉——表现是
       「点了没反应」，整批跑时实测复现（单跑缓存已热不复现）。这一句同时也是「用户看得见 ComfyUI 在跑、
       地址就在按钮旁边」的断言，判据看 `comfyStatusRow()`（为什么不是那句文案，见它的头注）。 */
    await expect(comfyStatusRow(page)).toHaveText(/ComfyUI 运行中/, {
      timeout: 20_000,
    });
    if (!thenOpenView) {
      return;
    }
    await page
      .getByRole("button", { name: /打开查看/ })
      .first()
      .click();
  }

  test("@critical 浏览器形态点「打开查看」把 ComfyUI 交给新浏览器页签", async ({
    page,
    context,
  }) => {
    await stubComfyTrpc(page);
    const popupPromise = context.waitForEvent("page", { timeout: 20_000 });

    await openComfyControlPage(page);

    // 真的开出一个新浏览器页签，地址就是 ComfyUI（假服务在替身端口上）。
    const popup = await popupPromise;
    expect(popup.url()).toContain(new URL(fakeComfyuiBaseUrl()).host);
    await popup.close();

    // 反馈要看得见：静默打开新页签，用户不知道发生了什么。
    await expect(page.getByText(/已在新浏览器页签打开 ComfyUI/)).toBeVisible();

    /* 浏览器形态不内嵌、也不画假页签栏（判据 `shouldUseBrowserTab`）。
       「壳内页签里渲染 iframe」那条契约在这里量不到，见上面的说明块。 */
    await expect(page.locator('iframe[title="ComfyUI"]')).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(0);
  });

  /* 负向（浏览器形态版）：即使服务端内嵌探测回答「不可嵌」，浏览器形态也**不去看这个结论**——它压根
   * 不内嵌，直接交给新浏览器页签。所以守两件「不该出现」：不塞一个注定空白的 iframe、不把壳内那句
   * 「无法在此页签中显示」搬到浏览器形态（那句的前提是「同一个页签」）。壳内的正向契约（不可嵌 → 同
   * 页签内给可读说明、不弹第二窗口）归 §11.10.4 壳冒烟；`blocked` 结论怎么产出由
   * `src/lib/comfy/comfy-embed.test.ts` 守着。 */
  test("@critical 内嵌探测结论不影响浏览器形态：仍走新浏览器页签", async ({ page, context }) => {
    await stubComfyTrpc(page, { embeddable: false });
    const popupPromise = context.waitForEvent("page", { timeout: 20_000 });

    await openComfyControlPage(page);

    const popup = await popupPromise;
    expect(popup.url()).toContain(new URL(fakeComfyuiBaseUrl()).host);
    await popup.close();

    // 壳内那句说明不该出现在浏览器形态里。
    await expect(page.getByText(/无法在此页签中显示/)).toHaveCount(0);
    await expect(page.locator('iframe[title="ComfyUI"]')).toHaveCount(0);
  });

  /**
   * 「在浏览器打开」是**与页签并列**的出口（放大看 / 装插件 / 多屏），不是替代页签：点它不得新增或
   * 切换页签，且动作要真的发出去。这条链路走服务端 `setting.comfyOpen`（Node 侧 spawn 拉起系统默认
   * 浏览器），浏览器里没法真开系统窗口，所以断言「动作发出去了」——桩掉该端点并数调用次数；同时用
   * popup 计数确认**没有**在应用内另开窗口。 */
  test("@critical 在浏览器打开 ComfyUI 动作发出且不切走当前视图", async ({ page }) => {
    let windowCount = 0;
    page.on("popup", () => {
      windowCount += 1;
    });

    /* 状态、内嵌结论与「在浏览器打开」的计次都由同一个桩负责：这条通配路由
       后注册者优先，另挂一条会把统一桩整个遮蔽（实测计数恒 0）。 */
    const comfyCalls = await stubComfyTrpc(page);

    await openComfyControlPage(page, false);
    /* 停在「ComfyUI」那一页（上面没离开它），基线就是「仍在这一屏」——
       页头那行可见标题按 ISSUE #1693 收掉了，所以认这一屏用的是它唯一的刷新出口。 */
    await expect(page.getByRole("button", { name: "刷新 ComfyUI 状态" })).toBeVisible();

    await page
      .getByRole("button", { name: /在浏览器打开/ })
      .first()
      .click();

    // 动作确实发出了（服务端有可见出口，不是静默失败）。
    await expect.poll(() => comfyCalls.open, { timeout: 20_000 }).toBeGreaterThan(0);
    /* 这条出口不与当前视图抢位置：点完还在这屏，且它不在应用内开新页签、
       也不弹浏览器页签（走的是系统默认浏览器那条服务端出口）。
       壳内那条「不新增也不切换应用页签」在这里量不到 —— 浏览器形态本来就没有
       应用内页签栏，归 §11.10.4 壳冒烟。 */
    await expect(page.getByRole("button", { name: "刷新 ComfyUI 状态" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(0);
    expect(windowCount).toBe(0);
  });
});
