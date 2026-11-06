import { expect, test, type Page } from "@playwright/test";

import { isRecord } from "../src/lib/is-record";
import { isTerminalTaskStatus } from "../src/lib/task-state";

/**
 * 主链路 E2E：**登录 → 建项目 → 出图**（ISSUE #1621 阶段二 2-2）。此前 `e2e/` 无一条用例走完这条链（登录用例明写「不假装认证成功」、登录后视图靠 `route.fulfill` 桩），于是「壳起不来 / 会话过期 / 中间件改写」这类只在真实 HTTP 栈上成立的缺陷没有执行者（台账 E3″）。
 * 真件：better-auth 真注册 + 真会话 cookie（本地 SQLite）、`project.upsert` 真写库（断言库里有这一行）、执行器真派出且收口到 `SUCCEEDED`、产物真由 `getView` 写到磁盘；**下游 ComfyUI + comfy-cli 是替身**。本应用任务只经 `executor-cli.ts` 起 `python -m comfy_cli run` 并读其 stdout 协议，收口回 `GET /history/{prompt_id}` 与 `GET /api/view` 都在服务端（`page.route` 拦不到），故最小假 ComfyUI 是唯一能真跑的形状（ISSUE #1621 §三）；替身只复刻外部协议，§12.12 判的是仓内两份同样实现。
 * 未覆盖的只有「ComfyUI 真采样 / torch 真在跑」（GPU 层，不该是 e2e 门槛）。第二条用例用假 comfy-cli 的哨兵触发（工作流出现某词 → 回放失败序列），断言失败被写成说得清的终态（`FAILED` + error 带假 CLI 原因）而非超时后报别的 —— ISSUE #1621 验收标准 3。
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
 * 调一条 tRPC procedure（query / mutation 共用），返回它的**返回值**。形态照 `src/trpc/link.ts`：query `GET /api/trpc/<proc>?batch=1&input=<superjson 载荷>`、mutation `POST ...?batch=1` 载荷在 body；必须带 `trpc-accept: application/jsonl`（否则 400 "Streaming requests must be batched"）；响应前几行是 head/result/data 的 promise 递进、**最后一行才是真数据**（见 `e2e/support/trpc-stub.ts` 文件头）。
 * 不经 `page.evaluate` 调应用自己的 client：那会把「用例怎么发请求」与「界面怎么发请求」绑死（重构客户端就红一片）；这里要断言的只是服务端真收到这条调用、真落了库，请求用最朴素的形式最接近事实。
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
  const parsed: unknown = JSON.parse(last);
  /* 最后一行是 `[chunkId, status, data]`，其中 `data` 的形状是
   * `[[值]]`「值 + 零个 asyncProp」（三段含义见 `e2e/support/trpc-stub.ts` 的
   * 文件头）。逐层取到 `[2] → [0] → [0]` 就是过程返回的那个值本身。 */
  const json = isRecord(parsed) ? parsed.json : undefined;
  const data = isUnknownArray(json) ? json[2] : undefined;
  const value = isUnknownArray(data) ? data[0] : undefined;
  return isUnknownArray(value) ? value[0] : value;
}

/** query 的薄封装（多数调用是它）。 */
function trpcQuery(page: Page, procedure: string, input?: unknown) {
  return trpcCall(page, procedure, input, "query");
}

/** mutation 的薄封装。 */
function trpcMutation(page: Page, procedure: string, input: unknown) {
  return trpcCall(page, procedure, input, "mutation");
}

/** `Array.isArray` 的内置守卫会把元素收成 `any[]`；这里收成 `unknown[]`。 */
function isUnknownArray(value: unknown): value is Array<unknown> {
  return Array.isArray(value);
}

/** tRPC 返回的列表：不是数组按空列表处理（原 `(listed ?? [])` 的读法）。 */
function recordList(value: unknown): Array<Record<string, unknown>> {
  return isUnknownArray(value) ? value.filter(isRecord) : [];
}

/** 读一个字符串字段；不是字符串时按「没读到」处理（原断言的 `?: string`）。 */
function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const field = record[key];
  return typeof field === "string" ? field : undefined;
}

/** `task.detail` 的运行时视图：只保留断言点原来读取的字段，缺失即让下游 expect 判红。 */
type TaskDetail = {
  error?: string | null;
  images?: Array<unknown>;
  status?: string;
};

function taskDetail(value: unknown): TaskDetail {
  if (!isRecord(value)) {
    return {};
  }
  const rawError = value.error;
  return {
    error: typeof rawError === "string" || rawError === null ? rawError : undefined,
    images: isUnknownArray(value.images) ? value.images : undefined,
    status: stringField(value, "status"),
  };
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
    const listed = recordList(await trpcQuery(page, "project.list"));
    const project = listed.find((item) => stringField(item, "id") === projectId);
    expect(
      project,
      "建项目之后 project.list 里必须有这一行（只断言请求发出去了等于没测）",
    ).toBeTruthy();
    expect(project === undefined ? undefined : stringField(project, "name")).toBe(projectName);

    /* 建工作流：出图还需要一条**可执行**的库行（`hasExecutableWorkflow` 认
     * rawJson 的 nodes 非空）。这条也走服务端，随后由 `generate.generate` 提交。 */
    const workflow = await trpcMutation(page, "workflow.create", {
      name: `E2E 工作流 ${stamp}`,
      taskType: "image",
      /* 入参字段是 `raw`（服务端 `parseWorkflowContent(JSON.stringify(raw))`
       * 解析后落库到 rawJson 列）—— 也是 `hasExecutableWorkflow` 唯一认的列。 */
      raw: rawWorkflow("一只在窗台上的猫"),
    });
    const workflowId = isRecord(workflow) ? stringField(workflow, "id") : undefined;
    expect(workflowId, "workflow.create 必须回一个 id").toBeTruthy();

    /* ── ③ 出图：真提交 + 真收口 ── */
    const submitted = await trpcMutation(page, "generate.generate", {
      workflow: workflowId,
      prompt: "一只在窗台上的猫",
      projectId,
      paramMap: {},
    });
    const taskId = isRecord(submitted) ? stringField(submitted, "taskId") : undefined;
    expect(taskId, "generate.generate 必须回一个 taskId").toBeTruthy();

    /* 轮询任务详情直到**终态**。断言终态而非「界面显示生成中」：后者在桩后端下也成立，而这条链路要证明
       执行器真跑完这一轮 —— 终态由 `executor-finalize` 写、产物由它下载落盘。⚠️ 判据必须是「已到终态」，
       不是「不再是 RUNNING」：后者对 `QUEUED` 也成立（提交后一瞬在排队，`expect.poll` 立刻命中、直接去
       断言 `SUCCEEDED`，红了却不是被测链路的问题，ISSUE #1727 第 2 条）。终态判据取 `src` 唯一出处
       `isTerminalTaskStatus()`，不在用例里再抄一份三个字面量。 */
    const terminal = await expect
      .poll(
        async () => {
          const detail = taskDetail(await trpcQuery(page, "task.detail", { id: taskId }));
          /* 非终态一律回同一个哨兵：poll 据此**继续等**（`QUEUED` 也到不了
             `"终态"`，所以不会被当成结论放行）。 */
          return isTerminalTaskStatus(detail.status) ? detail : null;
        },
        {
          timeout: 60_000,
          message: "任务没有到终态：出图这一跳断了（下游替身没应答，或执行器收口失败）",
        },
      )
      .not.toBeNull()
      .then(() => trpcQuery(page, "task.detail", { id: taskId }))
      .then((detail) => taskDetail(detail));

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

    const workflow = await trpcMutation(page, "workflow.create", {
      name: `E2E 失败工作流 ${stamp}`,
      taskType: "image",
      /* 哨兵进工作流 → 假 comfy-cli 回放失败序列（见本文件头 FAIL_SENTINEL）。 */
      raw: rawWorkflow(`失败用例 ${FAIL_SENTINEL}`),
    });
    const workflowId = isRecord(workflow) ? stringField(workflow, "id") : undefined;

    const submitted = await trpcMutation(page, "generate.generate", {
      workflow: workflowId,
      prompt: "这条应当失败",
      paramMap: {},
    });
    const taskId = isRecord(submitted) ? stringField(submitted, "taskId") : undefined;
    expect(taskId).toBeTruthy();

    /* 同成功用例：等的是**已到终态**，不是「不再是 RUNNING」（后者对 `QUEUED`
     * 也成立，会在排队那一瞬就放行、把 `QUEUED` 当成结论）。 */
    /* 同成功用例：等的是**已到终态**（非终态回 null、poll 继续等），不是
     * 「不再是 RUNNING」——后者对 `QUEUED` 也成立，会在排队那一瞬放行。 */
    const terminal = taskDetail(
      await expect
        .poll(
          async () => {
            const detail = taskDetail(await trpcQuery(page, "task.detail", { id: taskId }));
            return isTerminalTaskStatus(detail.status) ? detail : null;
          },
          {
            timeout: 60_000,
            message: "失败用例没有到终态",
          },
        )
        .not.toBeNull()
        .then(() => trpcQuery(page, "task.detail", { id: taskId })),
    );

    expect(terminal.status).toBe("FAILED");
    /* 关键：报错必须**指回失败的那一步**（假 CLI 给的原因），而不是
     * 「未收到 envelope」这类把矛头指向我们自己的兜底话术。 */
    expect(terminal.error ?? "").toContain(FAIL_SENTINEL);
  });
});
