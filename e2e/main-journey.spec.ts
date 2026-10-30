import { expect, test, type Page } from "@playwright/test";

import { isTerminalTaskStatus } from "../src/lib/task-state";

/**
 * 主链路 E2E：**登录 → 建项目 → 出图**（ISSUE #1621 阶段二 2-2）。
 *
 * ## 它补的是哪一格
 *
 * 在它之前，`e2e/` 里没有任何一条用例走完这条主链路：
 * `critical-flows.spec.ts` 的登录用例明写「不假装认证成功」，登录后的视图全靠
 * `route.fulfill` 桩；于是「壳起不来 / 会话过期 / 中间件改写」这类**只在真实
 * HTTP 栈上成立**的缺陷没有执行者（台账 E3″）。本文件里的每一步都走真件：
 *
 * | 步 | 真在哪 | 桩在哪 |
 * | --- | --- | --- |
 * | 登录 | better-auth 真注册 + 真会话 cookie（本地 SQLite） | 无 |
 * | 建项目 | `project.upsert` 真写库，断言的是**库里有这一行** | 无 |
 * | 出图 | 执行器真被派出、真收口到 `SUCCEEDED`，产物真落盘 | **下游 ComfyUI + comfy-cli** 是替身 |
 *
 * ## 「出图」那一跳为什么能算真的（ISSUE #1621 §三 的三选一）
 *
 * 三个选项里选的是第二个：**起一个最小 fake ComfyUI**。它不是「快一点」的取舍，
 * 是这条链路上唯一能真跑的形状 —— 本应用的任务**只经 comfy-cli 执行**
 * （`executor-cli.ts` 起 `python -m comfy_cli run --workflow …`），提交、进度、
 * 收口判定全部读它的 stdout 协议；而收口那一刻会回到 ComfyUI 的
 * `GET /history/{prompt_id}` 找产物、`GET /api/view` 下字节。两段都在**服务端**
 * （不经浏览器），`page.route` 一条都栏不到。
 *
 * 代价写清楚：替身是**第二份实现**，要跟着真件的对外契约走。但它复刻的是
 * comfy-cli / ComfyUI 的**外部协议**，本仓库的执行器逻辑一行都没抄 —— §12.12
 * 的孪生判据判的是「仓库内两份同样实现」，不是被替身掉的外部程序。
 *
 * 走完的真实程度：`RUNNING → SUCCEEDED` 由真执行器写、`TaskImage` 行由真收口写、
 * 磁盘上的 PNG 由真 `getView` 下载写。**没有覆盖**的只有「ComfyUI 真的采样出图」
 * 与「torch 真的在跑」——那是 GPU 层的事，不该是 e2e 的门槛。
 *
 * ## 失败路径为什么也有执行者
 *
 * 只有成功路径的用例会把「永远报成功」的缺陷放过去。第二条用例用假 comfy-cli 的
 * **哨兵触发**（工作流里出现某个词 → 回放失败序列），断言链路真的能把失败**写成
 * 一个说得清的终态**（`FAILED` + error 里有假 CLI 给的原因），而不是超时后报别的
 * —— 这正是 ISSUE #1621 验收标准 3 要的那一格。
 */

/** 假 comfy-cli 的失败触发词：工作流里出现它 → 回放失败序列。
 *  取值只看「在不在」，所以「判据真的在判」可以用一条变异反证
 *  （把哨兵从工作流里删掉 → 用例必须转绿）。 */
const FAIL_SENTINEL = "E2E_FAKE_CLI_FAIL_SENTINEL";

/** 出一条能被执行的最小 RAW 工作流（UI 格式：`nodes` 非空即 `hasExecutableWorkflow`）。
 *
 *  用 RAW 而不是 API 图：`execution-shape.ts` 的口径是「可执行 = rawJson 有内容」，
 *  本应用**只**从这里出发（API 格式不是任何一条路径的可导入形态）。 */
function rawWorkflow(text: string) {
  return {
    last_node_id: 2,
    nodes: [
      {
        id: 1,
        type: "CLIPTextEncode",
        pos: [100, 100],
        size: [300, 100],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [],
        widgets_values: [text],
      },
      {
        id: 2,
        type: "SaveImage",
        pos: [100, 300],
        size: [300, 100],
        flags: {},
        order: 1,
        mode: 0,
        inputs: [],
        outputs: [],
        widgets_values: [],
      },
    ],
    links: [],
    version: 0.4,
  };
}

/**
 * 调一条 tRPC procedure（query / mutation 共用），返回它的**返回值**。
 *
 * 形态照 `httpBatchStreamLink` 的真协议（`src/trpc/link.ts`）：
 *   · query：`GET /api/trpc/<proc>?batch=1&input=<superjson 载荷>`
 *   · mutation：`POST /api/trpc/<proc>?batch=1`，载荷在 body 里
 *   · 请求头 `trpc-accept: application/jsonl` —— 服务端据此走 Streaming 那一支，
 *     回的是逐行 JSON（**不写它会被判 400 "Streaming requests must be batched"**）
 *   · 响应体前几行是 head / result / data 的 promise 递进，**最后一行才是真数据**
 *     （逐行含义见 `e2e/support/trpc-stub.ts` 的文件头）
 *
 * 为什么不经 `page.evaluate` 调应用自己的 vanilla client：那会把「用例怎么发请求」
 * 与「界面怎么发请求」绑死，重构客户端就红一片；这里要断言的只是**服务端真的收到
 * 了这条调用、真的落了库**，请求用最朴素的形式发最接近事实。
 */
async function trpcCall(
  page: Page,
  procedure: string,
  input: unknown,
  kind: "query" | "mutation",
): Promise<unknown> {
  const envelope = input === undefined ? {} : input;
  /* superjson 的外壳（`{"json": …, "meta": …}`）是 transformer 的协议：
   * 不带 `json` 那一层会被判成没给输入。`meta` 只在需要 Date/Map 时才非空，
   * 本文件传的都是纯 JSON。 */
  const payload = { json: envelope, meta: { values: {} } };

  const url =
    kind === "query"
      ? `/api/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: payload }))}`
      : `/api/trpc/${procedure}?batch=1`;
  const res =
    kind === "query"
      ? await page.request.get(url, {
          headers: { "trpc-accept": "application/jsonl" },
        })
      : await page.request.post(url, {
          headers: {
            "content-type": "application/json",
            "trpc-accept": "application/jsonl",
          },
          data: { 0: payload },
        });

  const body = await res.text();
  if (!res.ok()) {
    throw new Error(`${procedure} 失败：HTTP ${res.status()} ${body.slice(0, 400)}`);
  }
  const lines = body.split("\n").filter(Boolean);
  const last = lines.at(-1);
  if (last === undefined) {
    throw new Error(`${procedure} 回了空响应体（预期 JSON Lines）`);
  }
  const parsed = /* SAFETY: 类型断言已复核 */ JSON.parse(last) as { json?: unknown };
  /* 最后一行是 `[chunkId, status, data]`，其中 `data` 的形状是
   * `[[值]]`「值 + 零个 asyncProp」（三段含义见 `e2e/support/trpc-stub.ts` 的
   * 文件头）。逐层取到 `[2] → [0] → [0]` 就是过程返回的那个值本身。 */
  const data = /* SAFETY: 类型断言已复核 */ (parsed.json as Array<unknown> | undefined)?.[2];
  const value = /* SAFETY: 类型断言已复核 */ (data as Array<Array<unknown>> | undefined)?.[0];
  return Array.isArray(value) ? value[0] : value;
}

/** query 的薄封装（多数调用是它）。 */
function trpcQuery(page: Page, procedure: string, input?: unknown) {
  return trpcCall(page, procedure, input, "query");
}

/** mutation 的薄封装。 */
function trpcMutation(page: Page, procedure: string, input: unknown) {
  return trpcCall(page, procedure, input, "mutation");
}

/** 真注册一个账号并把会话 cookie 落进浏览器上下文。
 *
 *  密码 ≥ 12 字符：`auth-server` 的 `minPasswordLength: 12`，短密码会在提交那一刻
 *  被判破坏 —— 本用例要的是「真的登录成功」，不是「表单变灰」。 */
async function signUp(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await /* 登录 / 创建账号是一排里选一个（`role="radio"`，规范 16 §16.2.4.75）——
     不是按钮。改的是读法，不是用例锁的那件事。 */
  page.getByRole("radio", { name: "创建账号" }).click();
  /* 昵称那一格标着「（可选）」但**带着 required**（共用字段行 LoginFieldRow 给
   * 每个 input 都加了它）——留空会被浏览器的原生校验拦在提交之前，表现是
   * 「点了没反应、一个请求都不发」。填上它：本用例要测的是认证链路，
   * 不是这条既有怪癖。 */
  await page.getByPlaceholder("体验创作者").fill("E2E 旅人");
  await page.getByPlaceholder("name@example.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  /* 真的离开登录页才算登录成功（导航由登录页的 router.push 发起）。
   * 只断言「按钮点过了」正是本用例要取代的旧口径。 */
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

test.describe("主链路：登录 → 建项目 → 出图 @critical", () => {
  test("@critical 走完登录、建项目、出图，且断言的是链路产物", async ({ page }) => {
    test.slow();

    /* ── ① 登录：真认证路径 ── */
    const stamp = Date.now();
    const email = `e2e-journey-${stamp}@example.com`;
    await signUp(page, email, "e2e-journey-password");

    /* ── ② 建项目：真写库 ── */
    const projectId = `proj_e2e_${stamp}`;
    const projectName = `E2E 主链路 ${stamp}`;
    await trpcMutation(page, "project.upsert", {
      id: projectId,
      name: projectName,
      nodes: [],
      edges: [],
    });

    /* 断言的是**库里有这一行**，不是「请求发出去了」：再读一次服务端，
     * 拿到的必须是我们刚写进去的那个 id / 名字。 */
    const listed = /* SAFETY: 类型断言已复核 */ (await trpcQuery(page, "project.list")) as
      | Array<{ id: string; name: string }>
      | undefined;
    const project = (listed ?? []).find((item) => item.id === projectId);
    expect(
      project,
      "建项目之后 project.list 里必须有这一行（只断言请求发出去了等于没测）",
    ).toBeTruthy();
    expect(project?.name).toBe(projectName);

    /* 建工作流：出图还需要一条**可执行**的库行（`hasExecutableWorkflow` 认
     * rawJson 的 nodes 非空）。这条也走服务端，随后由 `generate.generate` 提交。 */
    const workflow = /* SAFETY: 类型断言已复核 */ (await trpcMutation(page, "workflow.create", {
      name: `E2E 工作流 ${stamp}`,
      taskType: "image",
      /* 入参字段是 `raw`（服务端 `parseWorkflowContent(JSON.stringify(raw))`
       * 解析后落库到 rawJson 列）—— 也是 `hasExecutableWorkflow` 唯一认的列。 */
      raw: rawWorkflow("一只在窗台上的猫"),
    })) as { id?: string } | undefined;
    const workflowId = workflow?.id;
    expect(workflowId, "workflow.create 必须回一个 id").toBeTruthy();

    /* ── ③ 出图：真提交 + 真收口 ── */
    const submitted = /* SAFETY: 类型断言已复核 */ (await trpcMutation(page, "generate.generate", {
      workflow: workflowId,
      prompt: "一只在窗台上的猫",
      projectId,
      paramMap: {},
    })) as { taskId?: string } | undefined;
    const taskId = submitted?.taskId;
    expect(taskId, "generate.generate 必须回一个 taskId").toBeTruthy();

    /* 轮询任务详情直到**终态**。**为什么断言终态而不是「界面显示生成中」**：
     * 后者在桩后端下也成立，而这条链路要证明的是**执行器真的把这一轮跑完了**
     * ——终态由 `executor-finalize` 写，产物由它下载落盘。
     *
     * ⚠️ 判据必须是「**已到终态**」，不是「不再是 RUNNING」：后者对 `QUEUED`
     * 也成立 —— 提交后那一瞬任务正在排队，`expect.poll` 立刻命中、直接去断言
     * `SUCCEEDED`，于是**红了但错的不是被测链路**（ISSUE #1727 第 2 条：executor
     * 其实跑成功、产物也落了盘，报出来的却是 `QUEUED`）。终态判据取 `src` 的
     * 唯一出处 `isTerminalTaskStatus()`，不在用例里再抄一份三个字面量。 */
    const terminal = await expect
      .poll(
        async () => {
          const detail = /* SAFETY: 类型断言已复核 */ (await trpcQuery(page, "task.detail", {
            id: taskId,
          })) as { status?: string; error?: string | null; images?: Array<unknown> } | undefined;
          /* 非终态一律回同一个哨兵：poll 据此**继续等**（`QUEUED` 也到不了
             `"终态"`，所以不会被当成结论放行）。 */
          return isTerminalTaskStatus(detail?.status) ? detail : null;
        },
        {
          timeout: 60_000,
          message: "任务没有到终态：出图这一跳断了（下游替身没应答，或执行器收口失败）",
        },
      )
      .not.toBeNull()
      .then(() => trpcQuery(page, "task.detail", { id: taskId }))
      .then(
        (detail) =>
          /* SAFETY: 类型断言已复核 */ detail as {
            status?: string;
            error?: string | null;
            images?: Array<unknown>;
          },
      );

    /* 失败也要说清失败在哪一步（验收标准 3）：把 error 带进断言消息，
     * 而不是只报「status 不是 SUCCEEDED」。 */
    expect(terminal.status, `任务终态不是 SUCCEEDED，error=${terminal.error ?? "(无)"}`).toBe(
      "SUCCEEDED",
    );

    /* 链路产物的第二重断言：产物真的落进了任务行（`TaskImage`），
     * 也就是「出图」不是「任务标个成功就完了」。 */
    expect(
      terminal.images?.length ?? 0,
      "SUCCEEDED 的任务必须带产物行：收口只写了状态、没落盘时会命中这一条",
    ).toBeGreaterThan(0);
  });

  test("@critical 出图失败时终态说得清失败原因（不是超时后报别的）", async ({ page }) => {
    test.slow();

    const stamp = Date.now();
    await signUp(page, `e2e-journey-fail-${stamp}@example.com`, "e2e-journey-password");

    const workflow = /* SAFETY: 类型断言已复核 */ (await trpcMutation(page, "workflow.create", {
      name: `E2E 失败工作流 ${stamp}`,
      taskType: "image",
      /* 哨兵进工作流 → 假 comfy-cli 回放失败序列（见本文件头 FAIL_SENTINEL）。 */
      raw: rawWorkflow(`失败用例 ${FAIL_SENTINEL}`),
    })) as { id?: string } | undefined;

    const submitted = /* SAFETY: 类型断言已复核 */ (await trpcMutation(page, "generate.generate", {
      workflow: workflow?.id,
      prompt: "这条应当失败",
      paramMap: {},
    })) as { taskId?: string } | undefined;
    const taskId = submitted?.taskId;
    expect(taskId).toBeTruthy();

    /* 同成功用例：等的是**已到终态**，不是「不再是 RUNNING」（后者对 `QUEUED`
     * 也成立，会在排队那一瞬就放行、把 `QUEUED` 当成结论）。 */
    /* 同成功用例：等的是**已到终态**（非终态回 null、poll 继续等），不是
     * 「不再是 RUNNING」——后者对 `QUEUED` 也成立，会在排队那一瞬放行。 */
    const terminal = /* SAFETY: 类型断言已复核 */ (await expect
      .poll(
        async () => {
          const detail = /* SAFETY: 类型断言已复核 */ (await trpcQuery(page, "task.detail", {
            id: taskId,
          })) as { status?: string } | undefined;
          return isTerminalTaskStatus(detail?.status) ? detail : null;
        },
        {
          timeout: 60_000,
          message: "失败用例没有到终态",
        },
      )
      .not.toBeNull()
      .then(() => trpcQuery(page, "task.detail", { id: taskId }))) as {
      status?: string;
      error?: string | null;
    };

    expect(terminal.status).toBe("FAILED");
    /* 关键：报错必须**指回失败的那一步**（假 CLI 给的原因），而不是
     * 「未收到 envelope」这类把矛头指向我们自己的兜底话术。 */
    expect(terminal.error ?? "").toContain(FAIL_SENTINEL);
  });
});
