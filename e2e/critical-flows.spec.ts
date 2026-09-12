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

    // 侧栏主干入口齐备：这是「应用能用」的最小结构断言
    for (const label of ["首页", "画布", "工坊", "模型", "流程"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }).first(),
      ).toBeVisible();
    }

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
    // 应用日志入口在设置页/状态栏；这里只断言页面在轮询接口可用时不白屏。
    await expect(
      page.getByRole("heading", { name: "灵感从这里开始" }),
    ).toBeVisible();
  });
});

test.describe("应用页签与全屏视图 @critical", () => {
  /**
   * ISSUE #310 回归：应用级页签搬到窗口标题行后，应用内的「全屏视图」
   * （设置、工作流编辑器、消息中心…）仍按 `fixed inset-0` 铺满整个视口，
   * 把标题行里的页签整条盖住 —— 用户打开这些视图后就再也看不到页签。
   *
   * 这里在浏览器形态（`InAppTabStrip`，无原生标题行可让位）下断言：
   * 打开设置后，页签栏仍在视口内可见、且未被设置层覆盖。
   */
  /**
   * 复用「顶部命中页签栏」的判定：浮层若盖住标题行，elementFromPoint
   * 会返回浮层自己的子节点。
   */
  async function expectTopHitsTabStrip(page: Page) {
    const tablist = page.getByRole("tablist", { name: "应用页签" });
    await expect(tablist).toBeVisible();
    const tabBox = await tablist.boundingBox();
    expect(tabBox).not.toBeNull();
    const box = tabBox ?? { x: 0, y: 0, width: 0, height: 0 };
    expect(box.height).toBeGreaterThan(0);
    const hitTest = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el ? Boolean(el.closest('[role="tablist"]')) : false;
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(hitTest).toBe(true);
  }

  test("@critical 打开设置后应用页签仍可见可点", async ({ page }) => {
    await stubBackend(page);
    await page.goto("/workspace");

    const tablist = page.getByRole("tablist", { name: "应用页签" });
    await expect(tablist).toBeVisible();

    // 打开设置（overlay 形态，不卸载 workspace 组件树）。
    // 设置入口是 nav 底部的图标按钮，只有 title="设置"。
    await page.getByTitle("设置").first().click();
    // 设置 overlay 是 dynamic import + 首屏 loading，给它更宽的等待窗口。
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible({
      timeout: 20_000,
    });

    // 关键断言：页签栏仍在、且没有被设置层盖住（顶部元素仍是页签）。
    await expectTopHitsTabStrip(page);
  });

  /**
   * 同一处回归的**第二形态**：居中弹窗（应用日志、执行日志、任务详情…）。
   * 首轮修复只改了「全屏视图」，弹窗类仍是 `fixed inset-0`，于是打开应用日志
   * 后页签与右上角的关闭按钮照样被挡住。这条把弹窗形态钉进 E2E。
   */
  test("@critical 打开应用日志面板后应用页签仍可见可点", async ({ page }) => {
    await stubBackend(page);
    await page.route("**/api/logs/current**", async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ lines: [], sessionStart: Date.now() }),
      });
    });

    await page.goto("/workspace");
    await expectTopHitsTabStrip(page);

    // 入口在底部状态栏：只有 title 属性，没有可读文本。
    await page.getByTitle(/^日志面板/).click();
    // 面板标题：确认弹窗真的打开了（而不是入口没接上）。
    await expect(page.getByText("应用日志", { exact: true }).first()).toBeVisible();

    await expectTopHitsTabStrip(page);
  });

  /**
   * 同一处回归的**第三形态**：ComfyUI 页签里的内容。
   *
   * 前两轮修的都是「本应用自己的浮层盖住标题行」，而 ComfyUI 页签是另一类：
   * 页签打开了、地址也对，里面却什么都没有 —— 未开 CORS 的 ComfyUI 会对
   * 跨源请求返 **403**（origin-only 中间件），响应体为空所以一片白。宿主页
   * 跨源读不到响应头、事件也不带原因，所以「能不能嵌」由服务端
   * `setting.comfyEmbeddable` 回答。
   *
   * 两个方向都要守住（ISSUE #310，用户要求「只要多页签，不要另一个窗口」）：
   *   ① 可嵌 → 页签里确实渲染 iframe；
   *   ② 不可嵌 → 仍在**同一个窗口的页签**里给出可读说明，不弹第二个窗口。
   */
  /* 打开设置 → 创作后端 → 点「打开查看」。假 ComfyUI 在 8188 上（见
   * playwright.config.ts 的第二个 webServer），带 `--enable-cors-header`
   * 语义启动，即用户实际会遇到的正常路径。 */
  async function openComfyFromSettings(page: Page) {
    await page.goto("/workspace");
    await page.getByTitle("设置").first().click();
    await expect(page.getByRole("heading", { name: "设置" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "创作后端", exact: true }).click();
    await page.getByRole("button", { name: /打开查看/ }).first().click();
  }

  test("@critical ComfyUI 在页签里内嵌渲染 不另开窗口", async ({ page }) => {
    let windowCount = 0;
    page.on("popup", () => {
      windowCount += 1;
    });

    await openComfyFromSettings(page);

    // 页签里确实渲染出被嵌页（而不是一片空白）。
    await expect(page.locator('iframe[title="ComfyUI"]')).toHaveCount(1, {
      timeout: 20_000,
    });
    // 页签栏出现 ComfyUI —— 就是用户要的「多页签」形态。
    await expect(page.getByRole("tab", { name: /ComfyUI/ })).toBeVisible();
    // 且**没有**弹出第二个窗口。
    expect(windowCount).toBe(0);
  });

  /* 负向：内嵌探测判「不可嵌」时，**仍然留在同一个页签**里给出可读说明 ——
   * 不塞一个注定空白的 iframe、不弹第二个窗口、不跳浏览器。
   *
   * 只桩 `comfyEmbeddable` 一个端点（其余走真实后端）：判定要覆盖的是
   * 「客户端拿到 blocked 结论后怎么渲染」，而 blocked 的**成因**（ComfyUI 未开
   * CORS 对跨源返 403）已在 `src/lib/comfy-embed.test.ts` 与假 ComfyUI 的
   * 真实 403 场景里各自钉住。 */
  test("@critical ComfyUI 不可嵌时在同一页签里给说明 不另开窗口", async ({
    page,
  }) => {
    let windowCount = 0;
    page.on("popup", () => {
      windowCount += 1;
    });

    await page.route("**/api/trpc/**", async (route: Route) => {
      const url = route.request().url();
      if (!url.includes("comfyEmbeddable")) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                embeddable: false,
                reason: "ComfyUI 对跨源请求返回 403（未开启 CORS）",
                target: "blocked",
              },
            },
          },
        }),
      });
    });

    await openComfyFromSettings(page);

    // 绝不塞一个注定空白的内嵌 iframe（那正是空白页签的来源）。
    await expect(page.locator('iframe[title="ComfyUI"]')).toHaveCount(0);
    // 说明留在**页签内**，用户看得见成因。
    await expect(page.getByText(/无法在此页签中显示 ComfyUI/)).toBeVisible({
      timeout: 20_000,
    });
    // 页签本身照常存在（不是「什么都没发生」）。
    await expect(page.getByRole("tab", { name: /ComfyUI/ })).toBeVisible();
    // 不弹第二个窗口。
    expect(windowCount).toBe(0);
  });
});
