/**
 * 「客户端写的地址有没有落点」判据（台账 E3′ 带出的那类故障）。
 *
 * 起因：工坊首挂载的三路拉取里有一条 `fetch("/api/skills")`，而仓库里**没有**
 * `/api/skills` 这个 handler —— 请求必然 404，404 的 HTML 又让 `res.json()` 抛错，
 * 被调用点那句 `catch {}` 吞成「没有技能」。于是风格卡下拉常年空态，而
 * `pnpm test` / `pnpm check:all` 全绿：**没有任何一条判据知道这条地址是假的**。
 *
 * 为什么值得机器判：它的失败形态是「界面少一块 + 一声不吭」。人 review 时看见
 * `fetch("/api/skills")` 只会觉得那口存在，因为路径写得很像真的。而 REST 这一维
 * 此前两头都不管：既没人要求 handler 有用例，也没人要求调用点有 handler
 * （tRPC 那一维有 `trpc-surface-executors.test.ts` 兜着 —— 挂了就欠执行者与消费方）。
 *
 * 判据：`src/**` 里（非测试代码、剥注释后）每个**以引号 / 反引号 / `}` 紧接 `/api/`**
 * 的地址字面量，必须能在 `src/app/…/route.ts` 的目录形状里找到一个落点。
 *  · 段数要对齐：写 `/api/film` 而 handler 是 `/api/film/[id]` ⇒ 报（少一段就是 404）；
 *  · `[x]` 吃一段，`[...x]` 吃掉剩下的全部（也吃零段 —— `/api/trpc` 就是这么被
 *    `api/trpc/[trpc]` 接住的，本机 App Router 的实测行为）；
 *  · 模板串里的 `${…}` 当通配段：它吃什么由运行期决定，这里只保证形状对得上。
 *
 * ## 「前一位是 `}`」这一档为什么从豁免改成默认判
 *
 * 旧口径把 `}` 形态整个当成外部服务放过，理由写在原来的注释里：
 * `` `${comfyBaseUrl}/api/prompt` `` 是 ComfyUI 的接口，不归本应用的路由表管。
 * 这个代理规则**语法上说得通、语义上漏**：`src/config/custom-nodes.ts` 的
 * `` `${base}/api/custom-nodes/manifest` `` 前一位也是 `}`，而它是本应用的同源地址
 * ——「解析完注册表恒空」（台账 E9）就是这么躲过整条判据的：handler 在基线迁移时
 * 被删掉，调用点那句 fetch 因为写成模板形态而**从未被点名**。
 *
 * 所以这里改成**默认判、按整条地址登记放行**：`}` 形态一并进扫描面，外部服务由
 * `UPSTREAM_SERVICE_ADDRESS` 逐条登记并写原因。多花的登记换来的是
 * 「新写的同源地址一定会被判」—— 少判一条就是本次事故那一格。
 *
 *
 * 两类**长得像地址但不是本应用请求**的字面量必须显式登记，两张表吃同一套陈旧判据
 * （每条都要还有字面量在用、都要写着原因、都要**确实没有落点** —— 哪天那条路径
 * 真有了 route handler，登记就红，逼人重看「这条到底是谁的」）：
 *   · `NON_REQUEST_ADDRESS` —— 是本应用的路径，但那句字符串不是请求
 *     （`/api/trpc` 是 tRPC 的**通道基址**，真实请求一律是 `/api/trpc/<ns.proc>`，
 *     本机实测那条 200、基址本身 404，把它当 REST 路径判会永远红在 `src/trpc/**`；
 *     `/api/ws` 是 ComfyUI 的 WS 路径名，拼在 `ws://<comfy host>` 上，
 *     见 `runner-state.ts` 的 `WS_PATHS`）。
 *   · `UPSTREAM_SERVICE_ADDRESS` —— 上游服务自己的接口（本机 ComfyUI / Ollama /
 *     远端 LLM），本应用不实现它们，也不该被路由表判。
 *
 * 已知边界（写在判据旁边，不假装没有）：
 *  · 只看**整段字面量**。`"/api/" + kind` 这种拼出来的地址抓不到（它没有完整字面量）。
 *    要拼接就写成 `${base}/x` 的模板形态 —— 假红比假绿好修。
 *  · 判的是「有没有 handler」，不是「handler 答得对不对」。后者由各个 route 自己的用例负责。
 *  · 剥注释用 `tests/helpers/strip-comments.ts`，它不动行尾注释：
 *    `foo(); // 见 /api/xxx` 会被算成一条地址。方向是假红，出现时把尾注改成整行注释。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "./helpers/strip-comments";

/** 路由段的一种形状：写死的名字、单段动态、还是吃掉剩下的全部。 */
type RouteToken =
  { kind: "static"; value: string } | { kind: "one" } | { kind: "many" };

/** 通配段：来自模板插值 `${…}`，与任何路由段都对得上。 */
const WILD = "*";

/** 递归收集目录下的 `.ts` / `.tsx`。
 *
 *  只跳 `node_modules` 与 `.next`。**不要**顺手跳名为 `generated` 的目录：
 *  产物根在仓库根，但 `src/app/api/generated/[...path]` 是一个真 route handler，
 *  跟着跳就会把「产物读取口」从路由表里抹掉 —— 表现是判据把 `/api/generated/...`
 *  报成没有落点（假红），而真正该报的那条反而被同一份盲区盖住。 */
function collectTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectTs(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** `src/app` 下的 route handler 文件 → 它接住的 URL 段序列。
 *
 *  目录形状就是 URL：`src/app/api/tasks/[id]/stream/route.ts` → `api/tasks/:id/stream`。
 *  三处 Next 约定要照办：路由组 `(...)` 不进 URL；`[x]` 是一段；`[...x]` 是剩余全部。 */
function routeTable(appDir: string): Map<string, RouteToken[]> {
  const routes = new Map<string, RouteToken[]>();
  for (const file of collectTs(appDir)) {
    if (!/(^|[\\/])route\.tsx?$/.test(path.basename(file))) continue;
    const dirs = path
      .relative(appDir, path.dirname(file))
      .split(/[\\/]+/)
      .filter((seg) => seg && !/^\(.*\)$/.test(seg));
    const tokens: RouteToken[] = [];
    for (const seg of dirs) {
      // `[...x]` 与 `[[...x]]` 都算「吃掉剩下的全部」；`[x]` 只吃一段
      if (/^\[\.{3}[\w-]+\]$/.test(seg) || /^\[\[\.{3}[\w-]+\]\]$/.test(seg))
        tokens.push({ kind: "many" });
      else if (/^\[[\w-]+\]$/.test(seg)) tokens.push({ kind: "one" });
      else tokens.push({ kind: "static", value: seg });
    }
    routes.set(dirs.join("/"), tokens);
  }
  return routes;
}

/** 一个地址字面量 → 段序列；`${…}` 折成通配段，查询串与尾斜杠丢掉。 */
function endpointSegments(literal: string): string[] {
  return literal
    .split("?")[0]!
    .split("#")[0]!
    .split("/")
    .filter((seg) => seg !== "")
    .map((seg) => (seg.includes("${") || seg.startsWith("[") ? WILD : seg));
}

/** 地址能不能被某个 handler 接住（段序列逐段比，见文件头的三条形状规则）。 */
function hasRouteFor(
  segments: string[],
  routes: Map<string, RouteToken[]>,
): boolean {
  for (const tokens of routes.values()) {
    let i = 0;
    let j = 0;
    let matched = false;
    while (i < tokens.length) {
      const token = tokens[i]!;
      if (token.kind === "many") {
        // 吃掉剩下的全部，也吃零段：`/api/trpc` 与 `/api/generated/a/b.png` 都算落点
        matched = true;
        break;
      }
      if (j >= segments.length) break;
      const seg = segments[j]!;
      if (seg !== WILD && token.kind === "static" && token.value !== seg) break;
      i++;
      j++;
    }
    if (!matched && j === segments.length && i === tokens.length)
      matched = true;
    if (matched) return true;
  }
  return false;
}

/** 显式登记的「不是 REST 地址」的 `/api/` 字面量 → 为什么。
 *
 *  这张表只能变短：新增一项前先问「这条字符串真的是发给本应用的路由吗」。 */
const NON_REQUEST_ADDRESS: Record<string, string> = {
  "/api/trpc":
    "tRPC 通道基址（`src/trpc/react.tsx` / `vanilla.ts` 的 httpBatchStreamLink 与 handler 自己的说明）。真实请求是 `/api/trpc/<ns.proc>`，实测那条 200；基址本身谁都不去 GET。",
  "/api/ws":
    "ComfyUI 自己的 WS 路径（`runner-state.ts` 的 `WS_PATHS`，拼在 `ws://<comfy host>` 上）。它是外部服务的地址，不进本应用的路由表。",
};

/** 上游服务**自己的**接口路径 → 它是谁的、地址是从哪台机器拼出来的。
 *
 *  这张表替代的是旧的「前一位是 `}` 就整类豁免」那条语法代理规则 —— 那条规则
 *  漏掉了 `src/config/custom-nodes.ts` 的同源模板地址（台账 E9）。改成按**整条
 *  规范地址**登记之后：新写一条 `${...}/api/x` 会先红，再由人决定它是不是上游。
 *
 *  段里的 `*` 是模板插值折出来的通配段（`/api/history/*` = `${base}/api/history/${id}`）。
 *  只能变短：哪天本应用在同名路径上立了 route handler，陈旧判据会把它点名。 */
const UPSTREAM_SERVICE_ADDRESS: Record<string, string> = {
  "/api/prompt":
    "本机 ComfyUI 的提交队列口（`src/server/workshop/comfyui.ts` 把 prompt 图 POST 进去）。上游是 `http://127.0.0.1:<comfy port>`，不是本应用。",
  "/api/history/*":
    "本机 ComfyUI 的单条执行历史（`${comfyBase()}/api/history/${promptId}`，`client.ts` 与 `comfyui.ts` 两处）。尾段是 promptId，归上游的路由形状。",
  "/api/view":
    "本机 ComfyUI 的产物读取口（`client.ts` / `comfyui.ts`）。本应用对应的那一口刻意叫 `/api/images`，正是为了不与它同名 —— 见 `src/app/api/images/route.ts`。",
  "/api/upload/image":
    "本机 ComfyUI 的上传口（`${comfyBase()}/api/upload/image`）。图先落到 ComfyUI 的 input 目录，执行时才用得上。",
  "/api/interrupt":
    "本机 ComfyUI 的中断口（`client.ts` 的 `interrupt()`）。停止当前执行是它的进程内状态，本应用没有等价实现。",
  "/api/object_info":
    "本机 ComfyUI 的节点类型清单（`raw.ts` 拉整份 object_info 做注册表镜像）。它是 ComfyUI 启动后扫描自定义节点的结果。",
  "/api/models":
    "本机 ComfyUI 的模型目录口（`client.ts` 按 folder 列模型，`${comfyBase()}/api/models[/<folder>]`）。",
  "/api/models/*":
    "同上，带子目录那一档：`${comfyBase()}/api/models/${encodeURIComponent(folder)}`。登记成两条是因为通配段不是「前缀豁免」——少一段就多一段，多一段就少一段。",
  "/api/tags":
    "Ollama 的候选模型清单（`ollama-client.ts` 与 `/api/llm/models` 的 local 分支：把 OpenAI 兼容 base 剥掉 `/v1` 再拼）。远端 LLM 服务商的接口不进本应用的路由表。",
  "/api/version":
    "Ollama 的存活探测（`ollama-start` / `ollama-stop` 两个端点用它判「起来了没有」），拼在 `ollamaBaseUrl(port)` 上。",
};

/** 把地址折成比较用的规范形：丢查询串、丢尾斜杠、段序保持。 */
function normalizeAddress(literal: string): string {
  return "/" + endpointSegments(literal).join("/");
}

/** 登记的粒度是**整条地址**，不是前缀：`/api/trpc` 放行，`/api/trpcx` 不放行。 */
function registeredIn(table: Record<string, string>, literal: string): boolean {
  return Object.hasOwn(table, normalizeAddress(literal));
}

function isRegisteredNonAddress(literal: string): boolean {
  return registeredIn(NON_REQUEST_ADDRESS, literal);
}

function isUpstreamAddress(literal: string): boolean {
  return registeredIn(UPSTREAM_SERVICE_ADDRESS, literal);
}

/** 地址字面量的提取：**引号 / 反引号 / `}` 紧接 `/api/`** 都算一条地址。
 *
 *  `}` 那一档是模板形态 `` `${base}/api/x` ``。它以前被整类豁免，理由是「前面是
 *  `}` 的一定是外部服务」—— 那次豁免放走了一条真事故（见文件头）。现在默认判，
 *  上游那十条由 `UPSTREAM_SERVICE_ADDRESS` 逐条放行。 */
function endpointsOf(text: string): string[] {
  return [...text.matchAll(/["'`}]\/api\/[^"'`\s]*/g)].map((m) =>
    m[0].slice(1),
  );
}

describe("REST 地址都要有落点：客户端写的每个 /api/... 必须命中一个 route handler", () => {
  const routes = routeTable(path.join(process.cwd(), "src/app"));
  /** 消费面：`src/**` 里非测试的代码，注释剥掉。测试里的假路径不该判（它不发请求）。 */
  const files = collectTs(path.join(process.cwd(), "src"))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => ({
      file: path.relative(process.cwd(), f).replace(/\\/g, "/"),
      text: stripComments(readFileSync(f, "utf8")),
    }));
  const found = files.flatMap(({ file, text }) =>
    endpointsOf(text).map((literal) => ({ file, literal })),
  );

  it("扫描面本身不是空的（判据不许在空输入上假绿）", () => {
    // 两头都要非空：handler 清单少到几十条以下、或一条地址都没扫到，
    // 都意味着主断言退化成「无话可说 = 全过」。
    expect(routes.size).toBeGreaterThan(30);
    expect(found.length).toBeGreaterThan(20);
  });

  it("每条地址都能找到一个 route handler", () => {
    const missing = found
      .filter(
        ({ literal }) =>
          !isRegisteredNonAddress(literal) &&
          !isUpstreamAddress(literal) &&
          !hasRouteFor(endpointSegments(literal), routes),
      )
      .map(({ file, literal }) => `${file} → ${literal}`);
    // 红话里带着「这是 404 不是空数据」：调用点常常一句 catch 就吞了
    expect(missing).toEqual([]);
  });

  it("同源地址里确有 `}` 模板形态的一条被判到了（旧口径的漏点）", () => {
    /* 这一格钉住本批改动的**收益本身**：`src/config/custom-nodes.ts` 的
     * `` `${base}/api/custom-nodes/manifest` `` 在前一版判据里被整类语法豁免放走，
     * 于是 handler 被删掉之后没有任何一条门禁知道。现在它进了扫描面，并且
     * 必须**不被两张登记表放行**（放行它 = 把漏点重新打开）。 */
    const hit = found.filter(
      ({ literal }) =>
        normalizeAddress(literal) === "/api/custom-nodes/manifest",
    );
    expect(hit.length).toBeGreaterThan(0);
    expect(isUpstreamAddress("/api/custom-nodes/manifest")).toBe(false);
    expect(isRegisteredNonAddress("/api/custom-nodes/manifest")).toBe(false);
    expect(
      hasRouteFor(endpointSegments("/api/custom-nodes/manifest"), routes),
    ).toBe(true);
  });

  it("登记表本身不陈旧：每条都还有字面量在用它、写着原因，且确实没有落点", () => {
    const used = new Set(found.map(({ literal }) => normalizeAddress(literal)));
    const tables: Array<[string, Record<string, string>]> = [
      ["NON_REQUEST_ADDRESS", NON_REQUEST_ADDRESS],
      ["UPSTREAM_SERVICE_ADDRESS", UPSTREAM_SERVICE_ADDRESS],
    ];
    for (const [tableName, table] of tables) {
      for (const [address, reason] of Object.entries(table)) {
        // 空壳原因（「TODO」这类）等于没有登记表
        expect(reason.length, `${address} 的登记理由太短`).toBeGreaterThan(30);
        expect(
          used,
          `${tableName}: ${address} 已经没有字面量在用了，把登记删掉`,
        ).toContain(address);
        // 有落点的路径不可能是「非地址」：那说明登记写错了，或这条已经有了 handler
        expect(
          hasRouteFor(endpointSegments(address), routes),
          `${tableName}: ${address} 已经有 route handler 了，不该登记成免判项`,
        ).toBe(false);
      }
    }
  });

  it("判据自身可反证：少一段、多一段、通配段、注释都要判对", () => {
    const table = new Map<string, RouteToken[]>([
      ["api/film/[id]", endpointTokens(["api", "film", ":one"])],
      [
        "api/generated/[...path]",
        endpointTokens(["api", "generated", ":many"]),
      ],
      ["api/materials", endpointTokens(["api", "materials"])],
    ]);
    // 命中：写死形状
    expect(
      hasRouteFor(endpointSegments("/api/materials?projectId=x"), table),
    ).toBe(true);
    // 命中：动态段被真实 id 填上
    expect(hasRouteFor(endpointSegments("/api/film/abc123"), table)).toBe(true);
    // 命中：模板插值段 = 通配
    expect(hasRouteFor(endpointSegments("/api/film/${id}"), table)).toBe(true);
    // 少一段必须报 —— 这就是 `/api/skills` 那类故障的形状（handler 在，路径差一段）
    expect(hasRouteFor(endpointSegments("/api/film"), table)).toBe(false);
    // 名字对不上也要报
    expect(hasRouteFor(endpointSegments("/api/skills"), table)).toBe(false);
    // catch-all 吃任意深度，也吃零段（`/api/trpc` 那条）
    expect(
      hasRouteFor(endpointSegments("/api/generated/a/b/img_0.png"), table),
    ).toBe(true);
    expect(hasRouteFor(endpointSegments("/api/generated"), table)).toBe(true);
    // 只有注释里出现的地址不进扫描面（先剥注释再提）
    expect(endpointsOf(stripComments('// 见 "/api/nope"'))).toEqual([]);
    /* 模板形态现在**进**扫描面：`}` 不再是整类豁免。这一条就是本次改动的判据面 ——
     * 上游那一档随后由 `UPSTREAM_SERVICE_ADDRESS` 逐条放行，而不是靠语法。 */
    expect(endpointsOf("fetch(`${base}/api/prompt`)")).toEqual(["/api/prompt"]);
    expect(
      endpointsOf('fetch(`${comfyBase()}/api/view?filename=a.png")'),
    ).toEqual(["/api/view?filename=a.png"]);
    // 未登记的上游形态照旧要点名：登记表的粒度是整条地址，不是「有 `${` 就放过」
    expect(isUpstreamAddress("/api/prompt")).toBe(true);
    expect(isUpstreamAddress("/api/promptx")).toBe(false);
    expect(isUpstreamAddress("/api/history/${promptId}")).toBe(true);
    // 通配段不放宽前缀：`/api/history`（不带 id）没登记过，照样判
    expect(isUpstreamAddress("/api/history")).toBe(false);
    // 登记表按**整条地址**放行，不是按前缀：`/api/trpcx` 这种长得像的一样要判
    expect(isRegisteredNonAddress("/api/trpc")).toBe(true);
    expect(isRegisteredNonAddress("/api/trpc?batch=1")).toBe(true);
    expect(isRegisteredNonAddress("/api/trpcx")).toBe(false);
    // 少一段就是少一段：登记了基址不等于登记了它下面的每一条
    expect(isRegisteredNonAddress("/api/trpc/project.list")).toBe(false);
    // 两张表不互相顶：`/api/ws` 在上游表里查不到，它靠 NON_REQUEST 放行
    expect(isUpstreamAddress("/api/ws")).toBe(false);
  });
});

/** 测试夹具用的短写法：把人类可读的段序列折成 `RouteToken[]`。 */
function endpointTokens(segs: string[]): RouteToken[] {
  return segs.map((seg) =>
    seg === ":one"
      ? { kind: "one" }
      : seg === ":many"
        ? { kind: "many" }
        : { kind: "static", value: seg },
  );
}
