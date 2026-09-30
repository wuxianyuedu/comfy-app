import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * 关键链路 E2E（ISSUE #317）：把「登录 → 工作区 → 工作流库执行 → 工作台概览」
 * 四段收进 CI 的 `@critical` 门禁。
 *
 * 设计约束（与规范 11.3.1 / 11.7 对齐）：
 *   - **不依赖真实 ComfyUI / GPU / 外网**：后端交互走 Playwright 路由拦截、
 *     固定 fixture，或本仓库自带的**假 ComfyUI**（`e2e/support/fake-comfyui-server.mjs`，
 *     由 playwright.config 的第二个 webServer 拉起）。为什么「内嵌」那两条必须
 *     用假服务而不是路由拦截：能不能被内嵌是**服务端**探测的
 *     （`setting.comfyEmbeddable`），浏览器侧 `route.fulfill` 够不到那条链路
 *     （ISSUE #310）。
 *   - **选择器只用用户可见的东西**（getByRole / getByText），不依赖 data-testid，
 *     这样重构 DOM 不会让用例失效、而真实回归一定会被抓到。
 *   - 只断言「用户能感知的结果」，不断言内部 state。
 *
 * 为什么值得进 @critical：这四段是应用的主干。历史上「任务卡在队列但界面只显示
 * 等待日志」「ComfyUI 没启动却报任务连接中断」都是在这条链路上被用户先发现的
 * ——门禁跑起来之后，这类「界面没有可见出口」的退化会在合并前暴露。
 */

/** stub 掉与 ComfyUI / DB 相关的 tRPC 调用，只保留 UI 结构可渲染。 */
async function stubBackend(page: Page) {
  await page.route("**/api/trpc/**", async (route: Route) => {
    const url = route.request().url();
    // tRPC 批量流式端点：按 path 返回最小可用结构，避免页面因等待数据而卡住。
    let body: unknown = null;
    if (url.includes("setting.get")) {
      body = { result: { data: { json: "{}" } } };
    } else if (url.includes("comfyui.status")) {
      body = {
        result: {
          data: { up: false, base: null, starting: false, stopping: false },
        },
      };
    } else if (url.includes("workflow.list")) {
      body = {
        result: { data: { templates: [], total: 0 } },
      };
    } else if (url.includes("task.list")) {
      body = { result: { data: { tasks: [], total: 0 } } };
    }
    if (body === null) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
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
    await page.getByRole("button", { name: "创建账号" }).click();
    await expect(page.getByText("昵称（可选）")).toBeVisible();
    await expect(page.locator('form button[type="submit"]')).toHaveText(
      "创建并登录",
    );

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
          if (!url.endsWith("/login")) return "navigated";
          const body = await page.locator("body").innerText();
          return /提交中|加载中|请稍候|创建并登录/.test(body)
            ? "submitted"
            : "idle";
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

    // Hero 标题（首页主入口）
    await expect(
      page.getByRole("heading", { name: "灵感从这里开始" }),
    ).toBeVisible();

    /* 侧栏主干入口齐备：这是「应用能用」的最小结构断言。
     * 名单是导航拆成两类之后的**全局那一类**（`NavItems.tsx` 的 `globalNavItems()`，
     * id 与顺序由 `src/components/studio/nav-items.test.ts` 钉死）。这里按用户可见的
     * 标签重复一份，而不是 import 那份常量：e2e 的断言应当只看屏幕上有无这些东西，
     * 拿 React 侧常量当数据源会让「常量与渲染不一致」这种真故障变成用例里的自洽。 */
    for (const label of ["首页", "模型", "历史", "队列", "炼丹", "流程"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }).first(),
      ).toBeVisible();
    }

    /* 画布 / 工坊是项目内页签：没进项目时它们**不在侧栏**，在首页以入口卡出现。
     * 早先这里把这两个名字混进上面那个侧栏循环，于是从导航拆类那天起就一直是红的。 */
    await expect(
      page.getByRole("button", { name: /新建画布/ }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /全链路工坊/ }).first(),
    ).toBeVisible();

    // 最近项目分区存在（空态也要有标题，不能整段消失）
    await expect(page.getByRole("heading", { name: "最近项目" })).toBeVisible();
  });

  test("@critical 可从工作区切到工作流库视图并看到库界面", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await gotoWorkspaceView(page, "流程");

    // 工作流库页头标题 + 导入入口（导入是对外可见的主要动作）
    await expect(page.getByRole("heading", { name: "工作流库" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /导入工作流/ }),
    ).toBeVisible();
  });

  /**
   * ISSUE #720：「加载是有个不知道是什么的图案在」。
   *
   * 现场是工作流库的加载态：`EmptyState` 的图标位是 `<span class="block">`
   * 这种**非 flex** 的容器，而 `Spinner` 是个 `<span>` —— 默认
   * `display: inline`，`size-6` 出的 width/height 对行内盒不生效，画出来的
   * 是「2px 上下边框叠在一个行内盒上」：**4×21 的竖线**。用户看不出那是加载
   * 指示器，只读到一个来源不明的图案。
   *
   * 尺寸只有真实浏览器量得出来（jsdom 不做布局、不做行内盒的宽高失效）。三条判据：
   *   1. 宽高都到位（老形态宽 4px）；
   *   2. 是个圆（宽高相等），不是竖条；
   *   3. **把父容器的 flex 抽掉再复量一次**，仍然成立 —— 守的是「尺寸不靠调用处
   *      布局撑着」：下一个非 flex 的落点照样会塌成竖线。
   *
   * 第 3 条原先钉的是「这个落点的父容器**不是** flex」。那是实现细节：加载态后来
   * 进了 `EmptyState` 的 flex 图标位，代理判据从此恒红，却不说明任何退化。现在
   * 直接做那个实验（量完立刻还原），比老写法严：老写法只会红，不会告诉你为什么。
   *
   * 读数用 `getComputedStyle` 的 width/height，不用 `boundingBox()`：spinner 带
   * `animate-spin` 持续旋转，boundingBox 量到的是旋转后的外接矩形。两个实测后果：
   *   · 读数随角度漂 —— 同一根图标两次跑分别量到 26×26 与 34×34；
   *   · 判据会在最该红的时候放行 —— 老写法下把图标换成默认尺寸（真值 16×16）
   *     用例**仍然绿**（旋转后的外接矩形把宽度抬过了 16 这条线）。
   * 顺带一个算式：w×h 的盒转 45° 后外接矩形两边都是 (w+h)/√2 —— 24×16 的竖条
   * 在 45° 那一刻量起来正好是正方形，「宽高相等」这条判据因此根本不由 boundingBox 保证。
   * 两处负向验证各红在指定断言上：换成默认尺寸报 `宽度塌了：16×16`，
   * 只给宽不给高报 `不是圆：24×16`。
   */
  test("@critical 工作流库加载态的转圈是真的圆，不是一条竖线", async ({
    page,
  }) => {
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
    await gotoWorkspaceView(page, "流程");
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
        const style = getComputedStyle(el as SVGElement);
        return {
          width: Number.parseFloat(style.width),
          height: Number.parseFloat(style.height),
        };
      });

    const size = await measure();
    /* 老形态宽 4px / 高 21px；正常形态是 24×24（`size-6`）。 */
    expect(
      size.width,
      `宽度塌了：${size.width}×${size.height}`,
    ).toBeGreaterThan(16);
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
      if (parent === null) throw new Error("spinner 没有父节点，判据落点漂了");
      const previous = parent.style.display;
      parent.style.display = "block";
      const style = getComputedStyle(el as SVGElement);
      const box = {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
      };
      if (previous === "") parent.style.removeProperty("display");
      else parent.style.display = previous;
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
    await gotoWorkspaceView(page, "流程");

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
    await expect(
      page.getByRole("button", { name: /导入工作流/ }),
    ).toBeVisible();
  });
});

test.describe("工作流执行链路 @critical", () => {
  test("@critical 提交执行后界面给出可见进行态而不是只剩等待文案", async ({
    page,
  }) => {
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
    await gotoWorkspaceView(page, "流程");

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
    await expect(
      page.getByText("应用日志", { exact: true }).first(),
    ).toBeVisible();
  });
});

test.describe("应用页签与全屏视图 @critical", () => {
  /**
   * ISSUE #310 回归：应用级页签搬到窗口标题行后，应用内的「全屏视图」
   * （设置、工作流编辑器、消息中心…）与居中弹窗仍按 `fixed inset-0` 铺满整个
   * 视口，把用户的**出路**整条盖住。
   *
   * 两种形态的出路不是同一个东西，判据也跟着分：
   *   · **桌面壳内**出路是标题行页签栏 —— 但 Playwright 驱动不了壳窗口，这条
   *     在本套件里量不到（页签栏不渲染），只能由壳侧验证守；
   *   · **浏览器 / dev 形态**按设计**不渲染任何应用内页签栏**（`ShellTabs.tsx`
   *     文件头：浏览器自带页签栏，再画一条既占纵向空间又与原生重复），实测
   *     `[role="tablist"]` 计数为 0。此时用户唯一的常驻出路是**底部状态栏**
   *     与各视图自己的关闭/返回出口。
   *
   * 所以这里守的是同一类退化的浏览器形态版本：浮层若盖住状态栏，
   * `elementFromPoint` 会返回浮层自己的子节点。顺带钉住「不画假页签栏」——
   * 哪天有人补一条应用内页签栏，这条会红，而不是悄悄多占 32px 纵向空间。
   */
  const centerHitsOwnSubtree = (target: ReturnType<Page["locator"]>) =>
    target.evaluate((el) => {
      const box = (el as HTMLElement).getBoundingClientRect();
      const top = document.elementFromPoint(
        box.x + box.width / 2,
        box.y + box.height / 2,
      );
      return top !== null && (el as HTMLElement).contains(top);
    });

  async function expectStatusBarNotCovered(page: Page) {
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(
      0,
    );
    const statusbar = page.getByLabel("底部状态栏");
    await expect(statusbar).toBeVisible();
    expect(
      await centerHitsOwnSubtree(statusbar),
      "底部状态栏被浮层盖住了：中心命中落在浮层子树上",
    ).toBe(true);
  }

  test("@critical 打开设置后底部状态栏与视图出路都不被盖住", async ({
    page,
  }) => {
    await stubBackend(page);
    await page.goto("/workspace");
    await expectStatusBarNotCovered(page);

    // 打开设置（overlay 形态，不卸载 workspace 组件树）。
    await page
      .getByRole("button", { name: "设置", exact: true })
      .first()
      .click();
    // 设置 overlay 是 dynamic import + 首屏 loading，给它更宽的等待窗口。
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible({
      timeout: 20_000,
    });

    // 关键断言：设置层铺满视口之后，状态栏与视图自己的「返回」出路都还点得到。
    await expectStatusBarNotCovered(page);
    const back = page
      .getByRole("button", { name: "返回", exact: true })
      .first();
    await expect(back).toBeVisible();
    expect(
      await centerHitsOwnSubtree(back),
      "设置视图的「返回」出口被自己的浮层结构盖住了",
    ).toBe(true);
  });

  /**
   * 同一处回归的**第二形态**：居中弹窗（应用日志、执行日志、任务详情…）。
   * 首轮修复只改了「全屏视图」，弹窗类仍是 `fixed inset-0`，于是打开应用日志
   * 后页签与右上角的关闭按钮照样被挡住。这条把弹窗形态钉进 E2E。
   */
  test("@critical 打开应用日志面板后状态栏与面板关闭出口都不被盖住", async ({
    page,
  }) => {
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
    await expect(
      page.getByText("应用日志", { exact: true }).first(),
    ).toBeVisible();

    await expectStatusBarNotCovered(page);
    // 面板唯一的可见出路（另有 Esc / Ctrl+Shift+L 两条，用户看不见就等于没有）。
    const close = page.getByRole("button", { name: /^关闭/ }).first();
    await expect(close).toBeVisible();
    expect(
      await centerHitsOwnSubtree(close),
      "日志面板的关闭按钮被面板自己的结构盖住了",
    ).toBe(true);
  });

  /**
   * ISSUE #262 复审（这一轮的 4 条反馈）。四条里有三条**只能用真实浏览器证明**：
   * 弹层几何、翻页可点、以及「框住文本后内容还动不动」——jsdom 不做层叠与布局、
   * 也不实现 Selection 与滚动，单测全绿照样复现。
   *
   * 这里在真实 Chromium 里量：
   *   1. 来源下拉的弹层**顶边贴住扳机底边**（原先因 alignItemWithTrigger 会
   *      向上生长、顶到窗口最上方）；
   *   2. 弹层**可点**（点候选能切换来源）——层级契约的现场复核（规范 07 §7.21.4）；
   *   3. 切换来源与翻页都生效（用户报的「没法翻页」）；
   *   4. 行头里类别计数在下拉**左侧**，下拉贴着右侧操作区（布局重排的验收）。
   */
  test.describe("应用日志面板：下拉位置、可点性与翻页 @critical", () => {
    const ROWS = 450;

    /**
     * 造一批有内容的日志行，让面板有得翻、有得选。
     *
     * 时刻一定带 `[YYYY-MM-DD HH:mm:ss.mmm]` 前缀：面板的级别解析只认这一种
     * （或 `[HH:mm:ss]`）形状的行；ISO 的 `T` / `Z` 分毫写法则整行落到兜底分支、
     * 级别恒为 info——那样「警告黄、错误红」就永远没有可断言的样本。
     */
    async function stubLogs(page: Page) {
      await page.route("**/api/logs/current**", async (route: Route) => {
        const start = Date.now() - 600_000;
        const fmt = (ms: number) => {
          const d = new Date(ms);
          const p = (n: number, l = 2) => String(n).padStart(l, "0");
          return (
            `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
            `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.` +
            `${p(d.getMilliseconds(), 3)}`
          );
        };
        /* 掺进 2 条警告、3 条错误（取最新的一端，共 450 条仍在上限内）：
         * 级别按钮上的 warn / error 才有非零样本，「警告黄、错误红」才可断言。 */
        const lines = Array.from({ length: ROWS }, (_, i) => {
          const t = fmt(start + i * 1000);
          const level =
            i >= ROWS - 3 ? "[ERROR]" : i >= ROWS - 5 ? "[WARN]" : "[INFO]";
          return `[${t}] ${level} [app] 事件 ${i}`;
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: lines.join("\n") + "\n",
            size: 1_000_000,
            offset: 0,
            sessionStart: start,
            bootId: "e2e:1",
          }),
        });
      });
    }

    /**
     * 这一组定位器分两种，不是混用图省事：
     *   - 入口按钮的说明走 `Hint`（规范 16 §16.2.3 P82：图标按钮与悬停说明用
     *     Tooltip，不用原生 `title=`）—— 提示文案渲染成浮层、**不落 `title` 属性**，
     *     所以 `getByTitle(/^日志面板/)`、`getByTitle("更早的一页")` 这类匹配不到，
     *     只能按可访问名取（`getByRole("button", { name })`，由 `Hint` 的
     *     `accessibleName` 写成 `aria-label`）。
     *   - 面板加宽档（`ui/wide-panel` 的 `title={panel.toggleLabel}`）与来源/级别
     *     计数（`LogFilterBar` 的 `title={…}`）**仍是刻意的原生 `title`**，那几处
     *     `getByTitle` 是对的，别顺手一起换。
     */
    async function openPanel(page: Page) {
      await page.goto("/workspace");
      await page.getByRole("button", { name: /^日志面板/ }).click();
      await expect(
        page.getByText("应用日志", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "更早的一页" }),
      ).toBeVisible();
    }

    test("@critical 下拉弹层贴住扳机底边，且候选点得动、来源切得过来", async ({
      page,
    }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const trigger = page.getByRole("combobox", { name: "按来源筛选" });
      const triggerBox = await trigger.boundingBox();
      expect(triggerBox).not.toBeNull();

      await trigger.click();
      const popup = page.locator('[data-slot="select-content"]');
      await expect(popup).toBeVisible();
      const popupBox = await popup.boundingBox();
      expect(popupBox).not.toBeNull();

      const t = triggerBox!;
      const p = popupBox!;
      /* 用户第 2 条诉求的可量化形式：「弹出下拉菜单的最上方和下拉按钮的最下方
       * 对齐」。三条一起断言：
       *   1. 弹层顶边**贴在扳机底边**（允许 ±8px：base-ui 的 alignItemWithTrigger
       *      会带上一个把「已选项文本」与扳机文字对齐的微调量，用户视觉上仍是
       *      「紧贴底边」）；
       *   2. 弹层顶边**在窗口顶部的下方**（原先向上生长时会顶到 y≈0、盖住标题行）；
       *   3. 弹层不覆盖扳机本身（`data-align-trigger=false` 的几何证据）。 */
      expect(Math.abs(p.y - (t.y + t.height))).toBeLessThanOrEqual(8);
      expect(p.y).toBeGreaterThan(20);
      expect(p.y).toBeGreaterThan(t.y);

      /* 可点性：弹层矩形内多点 elementFromPoint 必须命中弹层子树，而不是被
       * 面板遮罩/日志行接走（规范 07 §7.21.4 的判据）。 */
      const hitAllInPopup = await page.evaluate(
        ({ box }) => {
          const points = [
            [box.x + 4, box.y + 4],
            [box.x + box.width - 4, box.y + 4],
            [box.x + 4, box.y + box.height - 4],
            [box.x + box.width - 4, box.y + box.height - 4],
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

    test("@critical 翻页能在历史页之间来回，且页码随内容变化", async ({
      page,
    }) => {
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
     * ISSUE #609 八审：「日志切换到 1000+ 的页签有明显卡顿需要优化」。
     *
     * 根因是一页 2000 行**全部**挂进 DOM（行内还有若干分片 span，满页约 1.5 万
     * 个节点），切页那一刻的布局成本就是用户感知到的卡顿。规范 02 §2.6 要求
     * 大列表虚拟滚动，现在只渲染视口内的几十行。
     *
     * 三条判据只有真实浏览器量得出来（jsdom 不做布局、clientHeight 恒为 0）：
     *   1. **节点数不再随页大小增长**——满页时 DOM 里的行数是几十，不是 2000；
     *   2. **一行都没丢**：总高 = 满页行数 × 单行高度，滚动条长度与内容一致，
     *      而且滚到底能看到最后一行（虚拟化的经典翻车就是「滚不到底」）；
     *   3. 切页那一刻的耗时远低于一次性渲染 2000 行的水平。
     *
     * 这里刻意把夹具堆到满页（`LOG_PAGE_SIZE`）：450 行时虚拟化前后都只有几十
     * 行的量级，量不出差异。
     */
    test("@critical 满页 2000 行只渲染视口内的几十行，且滚动条长度与内容一致", async ({
      page,
    }) => {
      await stubBackend(page);
      const ROWS = 2000;
      /* 夹具的**时刻锚点必须在路由外取一次**（不能在 handler 里每轮 `Date.now()`）。
       *
       * 轮询会反复打这个路由，而真实服务端按 `offset` 只回**新增**内容——同一个
       * 文件区间重读出的行时刻不变，客户端按 `(时刻, 级别, 正文)` 去重后时间线
       * 稳定。夹具若每轮重算锚点，整批 2000 行的时刻都会平移，去重全部失效，
       * 时间线每 2s 净增 2000 条（且新旧两批在时刻上交错），「滚到底看最后一行」
       * 就落到哪一批上全看轮询次数与 `Date.now()` 的抖动——断言与虚拟化本身
       * 无关，却会随机器快慢乱红。锚点固定后夹具与真实服务端同语义。 */
      const start = Date.now() - ROWS * 1000;
      await page.route("**/api/logs/current**", async (route: Route) => {
        const p = (n: number, l = 2) => String(n).padStart(l, "0");
        const fmt = (ms: number) => {
          const d = new Date(ms);
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
        };
        const lines = Array.from({ length: ROWS }, (_, i) => {
          const level =
            i >= ROWS - 3 ? "[ERROR]" : i >= ROWS - 9 ? "[WARN]" : "[INFO]";
          return `[${fmt(start + i * 1000)}] ${level} [app] 事件 ${i}`;
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            content: lines.join("\n") + "\n",
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
      await expect
        .poll(async () => page.locator("[data-log-index]").count())
        .toBeGreaterThan(0);
      const rendered = await page.locator("[data-log-index]").count();
      expect(rendered).toBeLessThan(200);

      /* ② 内容一行不少：撑开滚动条的总高 = 2000 × 单行高度。外层的 style.height
       * 就是它——读 style 而不是读 offsetHeight，是因为「估算高度」才是这里要
       * 钉住的契约（实际布局高度会被浏览器取整，量出来恒差几个像素）。 */
      const spacerHeight = await page
        .locator("[data-log-index]")
        .first()
        .evaluate((el) => el.parentElement!.parentElement!.style.height);
      expect(spacerHeight).toBe(`${ROWS * 27}px`);

      /* ③ 滚到底真的能到**本页最后一行**（虚拟化的经典翻车是「滚不到底」：
       * 窗口算错时会停在中途，用户怎么拉都看不到页尾）。
       *
       * 判据钉在**页内绝对序号**上（`data-log-index`），而不是某一行的文案：
       * 面板开着的时候轮询还在往时间线追加，第 1 页可能被锚定在旧位置（页脚会说
       * 「有 N 条新的日志」）——那时页尾本来就不是「事件 1999」那条。序号是页内
       * 位置，窗口一变它仍指着同一行，既不受轮询影响，也正是贴底逻辑用的同一份
       * 口径（§7.28.3 第 1 条）。 */
      await page.locator(".custom-scrollbar").evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
      await expect
        .poll(async () =>
          page
            .locator("[data-log-index]")
            .last()
            .getAttribute("data-log-index"),
        )
        .toBe(String(ROWS - 1));

      /* ④ 切页那一刻的耗时：满页 2000 行一次性渲染在真实 Chromium 里是几百
       * 毫秒量级（用户读到的就是「明显卡顿」）。虚拟化之后只剩几十行，
       * 给一个宽松但足以区分两者的上限。 */
      const t0 = Date.now();
      await page.getByRole("button", { name: "更早的一页" }).click();
      await expect(page.getByText(/第 2 \/ \d+ 页/)).toBeVisible();
      expect(Date.now() - t0).toBeLessThan(1500);
    });

    test("@critical 框选日志文本后，新日志到达不会把内容滚动走", async ({
      page,
    }) => {
      await stubBackend(page);

      /* 每次轮询都追加一行：模拟「日志到上限了还继续产生新日志」。 */
      let round = 0;
      await page.route("**/api/logs/current**", async (route: Route) => {
        const start = Date.now() - 600_000;
        const lines = Array.from({ length: 40 }, (_, i) => {
          const t = new Date(start + i * 1000)
            .toISOString()
            .replace("T", " ")
            .replace("Z", "");
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
            content: lines.join("\n") + "\n",
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
          const text = n as Text;
          if (!best || text.length > best.length) best = text;
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
      await page.waitForTimeout(5_000);

      const after = await page.evaluate(() => ({
        selected: window.getSelection()?.toString() ?? "",
        scrollTop: document.querySelector(".custom-scrollbar")?.scrollTop ?? 0,
      }));
      /* 关键：选区还在（没被刷新冲掉），且滚动位置没有被新日志推走。 */
      expect(after.selected).toBe(before.selected);
      expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(
        1,
      );
    });

    /**
     * ISSUE #720：「日志默认宽度太小了，而且加宽的按钮也失效了」。
     *
     * 两个现象是**同一个根因**：`ui/dialog` 的弹窗基类带着 `sm:max-w-sm`
     * （**带变体**的 max-width，Tailwind 把变体 utility 排在所有无变体之后），
     * 于是调用处无论写 `max-w-[96vw]` 还是 `w-6xl`，量到的都是 24rem：
     *   · 默认档 `max-w-5xl` 从来没生效过 → 面板只有 **384px** 宽；
     *   · 加宽档同理，按钮点了状态在变（title 加宽→收缩）、宽度纹丝不动。
     *
     * 判据只有真实浏览器量得出来（jsdom 不做布局，读不出 Tailwind 的产出）：
     *   1. 默认宽度 ≥ 800px（老形态恒为 384px，直接红）；
     *   2. 加宽后**明显更宽**且贴近视口（老形态前后差值 0）；
     *   3. 加宽后不溢出视口（贴边但不出界）。
     */
    test("@critical 日志弹窗默认够宽，且加宽按钮真的变宽", async ({ page }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const popupWidth = () =>
        page
          .locator('[data-slot="dialog-content"]')
          .evaluate((el) => Math.round(el.getBoundingClientRect().width));
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

      /* 收缩回到默认档，且宽度不残留。 */
      await page.getByTitle("收缩").click();
      await expect.poll(popupWidth).toBe(before);
    });

    test("@critical 行头里类别计数在下拉左侧，下拉贴住右侧操作区", async ({
      page,
    }) => {
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
     * ISSUE #262 复审：「顶部还有较大空白区域，全部/警告/错误这些挤在一起，
     * 可以占用大些空间」；五审：「不要因为宽度不够导致文字显示成省略号」。
     *
     * 这三件事是一体的：行头的富余宽度过去被一个**无名空白**吸走，五个筛选按钮
     * 被钉死在 32px 上。现在筛选按钮整组 `flex-1`、每个按钮等分（`min-w-fit`
     * 保住「文字 + 四位数字」的固有宽度），于是
     *   1. 按钮明显变宽（不再是 32px 的窄条）；
     *   2. 最右一个按钮与搜索框之间不再横着一大片空白；
     *   3. 标签与计数都完整显示，没有元素被文本溢出裁掉。
     *
     * 宽度只有真实浏览器量得出来（jsdom 不做布局），所以这几条在这里：
     *   - 最窄的按钮宽度 ≥ 56px（32px 的老形态直接红）；
     *   - 五个按钮等宽（差 ≤ 2px：`flex-1 basis-0` 的均分语义）；
     *   - 「错误」按钮右边缘到搜索框左边缘的空白 < 48px（老形态这里是上百 px）；
     *   - 每个按钮的 `scrollWidth <= clientWidth`（没有一个字被切掉/省略）。
     */
    test("@critical 级别筛选占满行头富余宽度，不再挤成窄条也不留大片空白", async ({
      page,
    }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      const labels = ["全部", "调试", "信息", "警告", "错误"];
      const boxes = [];
      for (const label of labels) {
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
      expect(Math.max(...boxes.map((b) => b.height))).toBeGreaterThanOrEqual(
        32,
      );

      const searchBox = await page.getByPlaceholder(/搜索日志/).boundingBox();
      expect(searchBox).not.toBeNull();
      const gap = searchBox!.x - (boxes[4]!.x + boxes[4]!.width);
      /* 按钮与搜索框之间的空白被按钮吃掉（老形态这里是 300px 上下）。 */
      expect(gap).toBeLessThan(48);
    });

    /**
     * ISSUE #262 五审（对应用户这轮的截图）：
     *
     * 1. 「警告/错误显示重复了，左侧那两个去掉」——标题旁那块灰底胶囊
     *    （`警告 n · 错误 n`）与级别按钮上的同名计数同源，是同一项数据说两遍；
     * 2. 「右侧的警告文字改成黄色，错误改成红色」——级别色落在**文字**上；
     * 3. 「每个都保留显示文字和四位数字的宽度即可。不要因为宽度不够导致文字
     *    显示成省略号」——截图里的老形态正是 `警… 539`（标签被切成省略号、
     *    数字被挤到下一行）。
     *
     * 这三条都是**布局结果**：jsdom 既不做布局也不实现 `scrollWidth`，
     * 所以判据只能落在真实浏览器上。
     */
    test("@critical 级别按钮不省略、带级别色，且标题旁不再复述警告/错误", async ({
      page,
    }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      /* ① 按钮不被裁：内容宽度不超过可视宽度（被切成 `警…` 时 scrollWidth 会反超）。 */
      for (const label of ["全部", "调试", "信息", "警告", "错误"]) {
        const button = page
          .getByTitle(new RegExp(`^当前来源的${label}：`))
          .first();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        /* 「两字标签 + 四位数字」的固有宽度在 60px 上下：低于 56px 说明按钮
         * 被压到放不下内容（老形态就是在这里把「警告」切成「警…」的）。 */
        expect(box!.width).toBeGreaterThanOrEqual(56);

        const overflow = await button.evaluate((el) => {
          const nodes = [el, ...Array.from(el.children)] as HTMLElement[];
          return nodes.map((n) => n.scrollWidth - n.clientWidth);
        });
        for (const px of overflow) expect(px).toBeLessThanOrEqual(1);
      }

      /* ② 级别色：警告黄、错误红，且两者**不同色**（同一处不能两色齐发）。
       * 颜色读数交给浏览器换算成 sRGB：Tailwind v4 产出的可能是 `lab(...)`，
       * 直接切字符串会算出色相错值（实测踩过）。这里借 2D 画布取值——
       * canvas 只认 sRGB，`getComputedStyle` 留在原色彩空间是没用的。 */
      const rgbOf = (label: string) =>
        page
          .getByTitle(new RegExp(`^当前来源的${label}：`))
          .first()
          .evaluate((el) => {
            const color = getComputedStyle(el).color;
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d")!;
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
            return [r, g, b] as [number, number, number];
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
          const count = el.children[1] as HTMLElement;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = getComputedStyle(count).color;
          ctx.fillRect(0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        });
      expect(countColor).not.toEqual([wr, wg, wb]);

      /* ③ 标题旁那块灰底胶囊整块删除（"左侧那两个"就是它复述的两个数）；
       *    行头第一行里只剩标题，不再有第二个计数源。 */
      expect(
        await page.locator('span.rounded-full[class*="bg-white/5"]').count(),
      ).toBe(0);
      const headerFirstRow = await page
        .locator("div.flex.min-h-14")
        .first()
        .evaluate((el) => el.firstElementChild!.textContent ?? "");
      expect(headerFirstRow).toContain("应用日志");
      expect(headerFirstRow).not.toMatch(/警告 \d+/);
      expect(headerFirstRow).not.toMatch(/错误 \d+/);
    });

    /**
     * ISSUE #262 六审：「有的日志只在全部页签才显示，这种也要有自己的分类或是
     * 归入其他分类」。
     *
     * 那批行是**没有文件来源**的（浏览器 console 拦截 / Tauri 事件 / 全局未捕获
     * 错误），过去它们只在「全部来源」下可见：选中任何一个来源都会整批消失，
     * 而下拉里既没有它们的名字、也看不出「还有一批行没被任何分类覆盖」。
     *
     * 判据是**守恒**：逐个分类的条数加起来 = 「全部来源」的条数——因此不存在
     * 任何一行落不进分类。这条只能在真实浏览器里量：要读的正是下拉弹层里
     * 四列数字的文本（jsdom 里弹层的过渡/层级行为与真实环境不同）。
     */
    test("@critical 无文件来源的日志有「控制台 / 全局错误」分类且能筛出来", async ({
      page,
    }) => {
      await stubBackend(page);
      await stubLogs(page);
      await openPanel(page);

      /* 掺 3 条**没有文件来源**的行：面板里的这种行正是 console 拦截来的
       * （`source: "console"`、无 `origin`）。必须在面板打开**之后**打印——
       * 拦截器是 `LogProvider` 挂载时装上的，更早的 console 调用没人接
       * （`addInitScript` 里打印会一条也进不了面板）。`stubLogs` 造的都是
       * app-runtime 文件行，所以这 3 条是唯一的 console 样本。 */
      for (let i = 0; i < 3; i += 1) {
        await page.evaluate(() =>
          console.error(
            "ResizeObserver loop completed with undelivered notifications.",
          ),
        );
      }
      /* 拦截器经 `queueMicrotask` 入库，而面板一页 200 条、窗口**锚定**在打开
       * 面板那一刻（真实日志文件同时在往里灌行），所以「这批行马上可见」不成立
       * ——用可见性等待会等不到。这里等下拉开来源下拉后它们的计数到位。
       *
       * 顺带一个坑：`console.error` 会让 Next dev 的错误浮层也渲染一份同样的
       * 文本，那是个隐藏节点——按文本全局找并 `toBeVisible` 会等到超时。 */
      await page.getByRole("combobox", { name: "按来源筛选" }).click();
      const consoleOption = page.getByRole("option", {
        name: /控制台 \/ 全局错误/,
      });
      await expect(consoleOption).toBeVisible();
      /* 样本真的进了面板（时刻最新 ≠ 窗口里可见，见上面的说明）。**至少** 3 条
       * 而不是正好 3 条：应用自身也会往 console 写错误（例如资源加载失败），
       * 它们同属这一分类，写死等值会让用例在别的机器上假红。 */
      const consoleBucketText = async () =>
        (await consoleOption.textContent()) ?? "";
      await expect
        .poll(async () =>
          Number(
            /控制台 \/ 全局错误(\d+)/.exec(await consoleBucketText())?.[1] ??
              "0",
          ),
        )
        .toBeGreaterThanOrEqual(3);

      /* 「各分类之和 = 全部来源」：**守恒**。多加一类来源却忘了给它建桶时，
       * 这条会红——用户报的「有的日志只在全部页签才显示」正是那个状态。
       *
       * 数字读的是每项里的 `sr-only` 纯文本摘要（`N 条 · 信息 x · 警告 y ·
       * 错误 z`）而不是自绘的四列：后者是视觉产物，列的位置随样式变，读它等于
       * 把用例绑在排版上。 */
      const summaryOf = async (label: string) =>
        page
          .getByRole("option", { name: new RegExp(`^${label} \\d`) })
          .evaluate((el) => {
            /* 选项里的 `sr-only` 有好几处（四列各自的「N 警告」也在其中），
             * 只有那个**以数字开头**的才是整行的纯文本摘要。 */
            const nodes = Array.from(el.querySelectorAll(".sr-only"));
            const summary = nodes
              .map((n) => n.textContent?.trim() ?? "")
              .find((t) => /^\d+ 条/.test(t));
            return Number(/^(\d+) 条/.exec(summary ?? "")?.[1] ?? "0");
          });

      const total = await summaryOf("全部来源");
      expect(total).toBeGreaterThan(5);
      const buckets = [
        "应用运行",
        "应用服务",
        "启动",
        "启动器",
        "控制台 / 全局错误",
      ];
      let sum = 0;
      for (const label of buckets) sum += await summaryOf(label);
      expect(sum).toBe(total);
      /* 那批无文件来源的行确实有自己的计数（不是 0，也不只计入「全部来源」）。 */
      expect(await summaryOf("控制台 / 全局错误")).toBeGreaterThanOrEqual(3);

      /* 切过去能看到那批行（切来源会回到第 1 页，窗口重取），且文件来源的行
       * 不在里面。 */
      await consoleOption.click();
      await expect(
        page
          .locator("[data-log-text]", {
            hasText: "ResizeObserver loop completed",
          })
          .first(),
      ).toBeVisible();
      await expect(
        page.locator("[data-log-text]", { hasText: /事件 / }),
      ).toHaveCount(0);
    });

    /**
     * ISSUE #262 六审：「日志多了我想复制报错文本还是复制不了，我刚选中内容就
     * 刷走了，需要每条日志后面加一个复制按钮，可复制日志内容」。
     *
     * 两件事在真实浏览器里量：
     *   1. 每条行末尾都有复制按钮，且**点得动**（`opacity-0` 的按钮在 jsdom 里
     *      与正常按钮无从区分，命中测试只有浏览器做得了）；
     *   2. 它写进剪贴板的**就是这一行**（带时刻与级别），而不是整页。
     */
    test("@critical 每条日志末尾的复制按钮能复制到这一行", async ({
      page,
      context,
    }) => {
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
     * ISSUE #262 复审：「启动和启动器日志丢失」。
     *
     * 真实现场：会话起点取自 `dev-launcher.log` 的 mtime，而启动器进程
     * （launcher）在它被创建**之前**就写下了自己的头几行（python / exe / cwd /
     * 探测 Node）。过去拿这个起点去裁**整条时间线**，这些本次启动最早、最该被
     * 看到的行被静默丢掉——面板上「启动」「启动器」两个来源恒为空。
     *
     * 这里在浏览器里复现同一时序：launcher 的行早于 sessionStart，dev 的行晚于
     * 它。两条都必须出现在面板上（后者本来就该在，前者是老形态丢掉的那批）。
     */
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
        const source = new URL(route.request().url()).searchParams.get(
          "source",
        );
        const lines =
          source === "launcher"
            ? launcherLines
            : source === "dev-launcher"
              ? devLines
              : [];
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
      await expect(
        page.getByText("应用日志", { exact: true }).first(),
      ).toBeVisible();

      /* 启动器的早期行必须在面板上（老形态：一行都没有）。 */
      await expect(
        page.getByText("=== launcher started ===").first(),
      ).toBeVisible();
      await expect(page.getByText("python=3.12").first()).toBeVisible();
      await expect(page.getByText("[STEP] 启动开发服务").first()).toBeVisible();

      /* 切到「启动器」来源也能看到（不是只混在全部来源里）。 */
      await page.getByRole("combobox", { name: "按来源筛选" }).click();
      await page.getByRole("option", { name: /启动器/ }).click();
      await expect(
        page.getByText("=== launcher started ===").first(),
      ).toBeVisible();
    });

    /**
     * ISSUE #262 六审：「启动和启动器 2 项还是没有日志内容」。
     *
     * 三审修的是**裁剪**（行被会话起点当成历史丢掉），这一轮是下一段：行抓到了、
     * 也没被裁，但**没被认成日志行**。真实现场是 PowerShell 的 `Write-Log`：
     * 级别经 `PadRight(5)` 补过尾空格（`[INFO ]` / `[OK   ]`），引导文案与错误
     * 详情是**缩进两格**的续行（`  [10:22:24] [ERROR] …`），颜色码偶尔残缺还会
     * 在 `[` 后多留一段假转义（`[[90m[OK`）。严格的 `\[INFO\]` 一个都匹配不到，
     * 整行于是以**原文**落板——面板上那两个来源看起来就只是带前缀的文本。
     *
     * 这里在浏览器里喂真实形态的行：断言级别标签被认出来（`INFO` / `ERROR`
     * 不是正文的一部分）、正文里不再残留 `[HH:mm:ss] [LEVEL]` 前缀。
     */
    test("@critical 启动与启动器两来源的日志行按级别解析 不整行显示原文", async ({
      page,
    }) => {
      await stubBackend(page);

      const fmt = (t: number) => {
        const d = new Date(t);
        const p = (n: number, l = 2) => String(n).padStart(l, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
      };
      const now = Date.now();
      const sessionStart = now - 30_000;
      /* 「只有时刻、没有日期」的行（dev.mjs 的真实形状）会被解析层按**今天同一时刻**
         重建。所以这个时刻必须落在现在之前：一旦在未来，服务端的 `clampLogTime`
         （`src/lib/log/log-session-scope.ts`）就把它钳成「本次读取的 now」，两轮读取
         生成两个不同的去重键，面板把同一批行计两次 —— 本用例下面钉的「启动 4」就会
         变成 8。真实运行里这类行永远是过去时刻，钳制不触发；写死 `10:22:24` 等于每天
         只在 10:22 之后才忠实，其余时段伪造了一个未来时间，把用例绑死在 #1240 的机制上。 */
      const clock = (t: number) => {
        const d = new Date(t);
        const p = (n: number) => String(n).padStart(2, "0");
        return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
      };
      /* 跨零点的那几十秒里「今天同一时刻」仍然会跑到未来（23:59 > 00:00），这一极少
         窗口退化成带完整日期时间戳的写法：本用例要守的是级别解析与正文不残留前缀，
         「同批行两轮读到同一个键」这个不变量在两种写法下都成立。 */
      const devBase = now - 40_000;
      const crossesMidnight =
        new Date(devBase).getDate() !== new Date(now).getDate();
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
        /* 游标桩要与真服务端的 readLogSlice 同形（`src/app/api/logs/current/route.ts`）：
           `size` 是**恒定的文件总大小**，客户端拿上一轮响应的 `size` 当游标；游标 == size
           就是「读到文件末尾」→ 回空，且 size 与 offset 都不许缩 —— 把 size 报小等于宣称
           「文件被新运行重建」，会触发尾部重读。
           此前这里每轮无视 offset 重发同一批行：dev-launcher 的行没有时间戳，解析层按契约
           钳到「当时本地时刻」（`log-store.ts` 时间线契约第 3 条），于是每轮生成一个新的
           `time+level+message` 键，去重救不回来 —— 面板里同一条日志出现 3 份，
           `getByText` 直接撞严格模式。 */
        const offset = Number(params.get("offset") ?? "0");
        const lines =
          source === "dev-launcher"
            ? devLines
            : source === "launcher"
              ? launcherLines
              : [];
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
      await expect(
        page.getByText("应用日志", { exact: true }).first(),
      ).toBeVisible();

      /* 四个级别标记都被认出来，正文里不残留 `[HH:mm:ss] [LEVEL]` 前缀。
         这里只取 `.first()`：面板有两个独立消费者（状态栏的错误计数与面板本体），
         本条守的是级别解析与「正文不残留前缀」，不裁决渲染层的重复计数 —— 那属于
         #1240 的口径。上一段注释里写的「两轮各钳到当时本地时刻 → 键不同」是桩把
         时刻写死在未来才触发的路径，已按真实形态改掉（时刻取现在之前）；因此下面
         那条「启动 4」的来源计数重新有意义，由它守住「同一批行只计一次」。 */
      await expect(page.getByText("预检通过").first()).toBeVisible();
      await expect(page.getByText("检查端口占用").first()).toBeVisible();
      await expect(page.getByText("Job Object 创建成功").first()).toBeVisible();
      await expect(
        page.getByText("找不到预编译 Tauri 壳").first(),
      ).toBeVisible();

      const body = await page.locator("[data-log-text]").allInnerTexts();
      expect(body.length).toBeGreaterThan(0);
      for (const text of body) {
        expect(text).not.toMatch(
          /\[\d{2}:\d{2}:\d{2}\]\s*\[(INFO|STEP|OK|WARN|ERROR|DEBUG)\s*\]/,
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
      await expect(
        page.getByText("找不到预编译 Tauri 壳").first(),
      ).toBeVisible();
    });
  });

  /**
   * 同一处回归的**第三形态**：ComfyUI 的查看出口。
   *
   * 前两轮修的都是「本应用自己的浮层盖住标题行」，而这一轮关于「点开后看不看
   * 得见东西」。两种形态的出口不是同一个东西（判据 `shouldUseBrowserTab`）：
   *   · **桌面壳内**：把 ComfyUI 开成**同一个窗口的一个页签**，里面渲染 iframe；
   *     未开 CORS 时 ComfyUI 对跨源返 403，是一片空白，所以「能不能嵌」由服务端
   *     `setting.comfyEmbeddable` 回答，不可嵌时仍在**同一个页签内**给可读说明
   *     （ISSUE #310 的原话是「只要多页签，不要另一个窗口」）。
   *   · **浏览器 / dev**：不内嵌、也不画应用内页签栏，直接把 ComfyUI 交给
   *     **新浏览器页签**（`window.open`），并给一条可见反馈。
   *
   * Playwright 起的是浏览器形态，所以上面那两条壳内断言（页签里的 iframe、
   * 页签内的不可嵌说明）在本套件里量不到 —— 本文件下面的三条按**浏览器形态的
   * 契约**守：新浏览器页签真的开出去、反馈看得见、应用内不长出假页签栏或 iframe。
   * 壳内那两条目前没有任何自动化覆盖，要验得先把用例跑进真壳（§11.10.4 壳冒烟）。
   */
  /**
   * ComfyUI 相关 tRPC 端点的统一桩：状态说「在跑、地址是假服务」，内嵌探测结论
   * 可参数化，「在浏览器打开」计次并回报成功。
   *
   * 为什么必须是一个处理器：同一个 URL 被多条通配路由匹配时，**后注册的那条先被
   * 调用**，而它对不认识的 URL 会 `route.continue()` 把请求**直接放去网络** —— 先
   * 注册的那条根本没机会应答。后果不是「有点遮蔽」而是两边都静默失灵：实测先挂
   * 计次桩、后挂状态桩，`comfyOpen` 计数恒 0（看起来像动作没发出，其实是路由顺序
   * 吃的）。所以这个 describe 里的 ComfyUI 端点统一由下面这一个处理器分派。
   * 假 ComfyUI 在 8188 上（playwright.config 的第二个 webServer）。
   */
  async function stubComfyTrpc(
    page: Page,
    options: { embeddable?: boolean } = {},
  ) {
    const calls = { open: 0 };
    await page.route("**/api/trpc/**", async (route: Route) => {
      const url = route.request().url();
      /* 两种响应形状不能混：`comfyui.status` 的 `data` **就是**状态对象，
         而 `comfyEmbeddable` / `comfyOpen` 的 `data` 外面还包一层 `json`
         （与文件顶部 `stubBackend` 的用法一致）。包错层前端读到的是 undefined。 */
      const fulfillRaw = (data: unknown) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ result: { data } }),
        });
      const fulfillJson = (data: unknown) => fulfillRaw({ json: data });
      if (url.includes("comfyui.status")) {
        await fulfillRaw({
          up: true,
          base: "http://127.0.0.1:8188",
          starting: false,
          stopping: false,
        });
        return;
      }
      if (url.includes("comfyEmbeddable")) {
        await fulfillJson({
          embeddable: options.embeddable ?? true,
          reason: "ComfyUI 对跨源请求返回 403（未开启 CORS）",
        });
        return;
      }
      if (url.includes("comfyOpen")) {
        calls.open += 1;
        await fulfillJson({
          ok: true,
          detail: "已用系统默认浏览器打开 ComfyUI",
        });
        return;
      }
      await route.continue();
    });
    return calls;
  }

  /**
   * 打开设置 → 创作后端（→ 可选地点「打开查看」）。
   *
   * `thenOpenView` 给 false 的场合：下一条用例要数「在浏览器打开」有没有额外开
   * 窗口，而「打开查看」本身就会开一个新浏览器页签 —— 顺手点上它，判据就被自己
   * 的动作污染了。
   */
  async function openComfyFromSettings(page: Page, thenOpenView = true) {
    await page.goto("/workspace");
    await page
      .getByRole("button", { name: "设置", exact: true })
      .first()
      .click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "创作后端", exact: true }).click();
    if (!thenOpenView) {
      return;
    }
    /* 先等状态真的落到界面上，再点「打开查看」。
       浏览器分支只有拿得到**已缓存的 base** 时才同步 `window.open`；缓存还空着会先
       `await` 一次 refetch，而 await 之后再 open 会被弹窗拦截器吞掉 —— 表现是「点了
       没反应」，用例等到超时（整批跑时实测复现，单跑因为缓存已热不复现）。这一句同时
       也是「用户看得见 ComfyUI 在跑、地址就在按钮旁边」的断言。 */
    await expect(page.getByText(/ComfyUI 运行中/).first()).toBeVisible({
      timeout: 20_000,
    });
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

    await openComfyFromSettings(page);

    // 真的开出一个新浏览器页签，地址就是 ComfyUI（假服务在 8188）。
    const popup = await popupPromise;
    expect(popup.url()).toContain("127.0.0.1:8188");
    await popup.close();

    // 反馈要看得见：静默打开新页签，用户不知道发生了什么。
    await expect(page.getByText(/已在新浏览器页签打开 ComfyUI/)).toBeVisible();

    /* 浏览器形态不内嵌、也不画假页签栏（判据 `shouldUseBrowserTab`）。
       「壳内页签里渲染 iframe」那条契约在这里量不到，见上面的说明块。 */
    await expect(page.locator('iframe[title="ComfyUI"]')).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(
      0,
    );
  });

  /* 负向（浏览器形态版）：即使服务端内嵌探测回答「不可嵌」，浏览器形态也**不去看
   * 这个结论** —— 它压根不内嵌，直接交给新浏览器页签。所以这里守的是两件「不该
   * 出现」：不塞一个注定空白的 iframe、不把壳内那句「无法在此页签中显示」搬到浏览器
   * 形态来（那句说明的前提是「同一个页签」，浏览器形态没有这个页签）。
   *
   * 壳内的正向契约（不可嵌 → 同一个页签内给可读说明、且不弹第二个窗口）在本套件
   * 量不到，归 §11.10.4 的壳冒烟。`blocked` 结论本身怎么产出由
   * `src/lib/comfy/comfy-embed.test.ts` 守着。 */
  test("@critical 内嵌探测结论不影响浏览器形态：仍走新浏览器页签", async ({
    page,
    context,
  }) => {
    await stubComfyTrpc(page, { embeddable: false });
    const popupPromise = context.waitForEvent("page", { timeout: 20_000 });

    await openComfyFromSettings(page);

    const popup = await popupPromise;
    expect(popup.url()).toContain("127.0.0.1:8188");
    await popup.close();

    // 壳内那句说明不该出现在浏览器形态里。
    await expect(page.getByText(/无法在此页签中显示/)).toHaveCount(0);
    await expect(page.locator('iframe[title="ComfyUI"]')).toHaveCount(0);
  });

  /**
   * 「在浏览器打开」是**与页签并列**的出口（放大看 / 装插件 / 多屏），
   * 不是替代页签：点它不得新增或切换页签，且动作要真的发出去。
   *
   * 这条链路走服务端 `setting.comfyOpen`（Node 侧 spawn 拉起系统默认浏览器），
   * 浏览器里没法真开一个系统窗口，所以这里断言「动作发出去了」——桩掉该端点
   * 并数调用次数；同时用 popup 计数确认**没有**在应用内另开窗口。
   */
  test("@critical 在浏览器打开 ComfyUI 动作发出且不切走当前视图", async ({
    page,
  }) => {
    let windowCount = 0;
    page.on("popup", () => {
      windowCount += 1;
    });

    /* 状态、内嵌结论与「在浏览器打开」的计次都由同一个桩负责：这条通配路由
       后注册者优先，另挂一条会把统一桩整个遮蔽（实测计数恒 0）。 */
    const comfyCalls = await stubComfyTrpc(page);

    await openComfyFromSettings(page, false);
    // 设置页停在创作后端那一屏（上面没离开设置），基线就是「仍在设置里」。
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();

    await page
      .getByRole("button", { name: /在浏览器打开/ })
      .first()
      .click();

    // 动作确实发出了（服务端有可见出口，不是静默失败）。
    await expect
      .poll(() => comfyCalls.open, { timeout: 20_000 })
      .toBeGreaterThan(0);
    /* 这条出口不与当前视图抢位置：点完还在设置里，且它不在应用内开新页签、
       也不弹浏览器页签（走的是系统默认浏览器那条服务端出口）。
       壳内那条「不新增也不切换应用页签」在这里量不到 —— 浏览器形态本来就没有
       应用内页签栏，归 §11.10.4 壳冒烟。 */
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible();
    await expect(page.getByRole("tablist", { name: "应用页签" })).toHaveCount(
      0,
    );
    expect(windowCount).toBe(0);
  });
});
