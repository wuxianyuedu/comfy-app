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
 * 判据：`src/**` 里（非测试代码、剥注释后）每个**以引号紧接 `/api/` 开头**的地址字面量，
 * 必须能在 `src/app/…/route.ts` 的目录形状里找到一个落点。
 *  · 段数要对齐：写 `/api/film` 而 handler 是 `/api/film/[id]` ⇒ 报（少一段就是 404）；
 *  · `[x]` 吃一段，`[...x]` 吃掉剩下的全部（也吃零段 —— `/api/trpc` 就是这么被
 *    `api/trpc/[trpc]` 接住的，本机 App Router 的实测行为）；
 *  · 模板串里的 `${…}` 当通配段：它吃什么由运行期决定，这里只保证形状对得上；
 *  · 「引号紧接 `/api/`」把它和**外部服务**的地址分开：
 *    `` `${comfyBaseUrl}/api/prompt` `` 前面是 `}`，那是 ComfyUI 的接口，不归本应用的路由管。
 *
 * 两类**长得像地址但不是地址**的字面量必须显式登记在 `NON_REQUEST_ADDRESS`
 * 里（每条带原因，且登记表双向不陈旧：字面量消失了还留着 = 红）：
 *   · `/api/trpc` —— tRPC 的**通道基址**。真实请求一律是 `/api/trpc/<ns.proc>`
 *     （本机实测：`GET /api/trpc/project.list` → 200，而基址本身 404 —— 没人去拿它），
 *     把它当 REST 路径判会永远红在 `src/trpc/**` 这三份客户端配置上。
 *   · `/api/ws` —— **ComfyUI 自己的** WS 路径（拼在 `ws://<comfy host>` 上，
 *     见 `runner-state.ts` 的 `WS_PATHS`），不归本应用的路由表管。
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

/** 把地址折成比较用的规范形：丢查询串、丢尾斜杠、段序保持。 */
function normalizeAddress(literal: string): string {
  return "/" + endpointSegments(literal).join("/");
}

/** 登记的粒度是**整条地址**，不是前缀：`/api/trpc` 放行，`/api/trpcx` 不放行。 */
function isRegisteredNonAddress(literal: string): boolean {
  const norm = normalizeAddress(literal);
  return Object.hasOwn(NON_REQUEST_ADDRESS, norm);
}

/** 地址字面量的提取：**引号 / 反引号紧接 `/api/`** 才算本应用的同源地址。
 *  前一位是 `}` 的是外部服务（ComfyUI / Ollama / 远端 LLM）的接口，不归这里判。 */
function endpointsOf(text: string): string[] {
  return [...text.matchAll(/["'`]\/api\/[^"'`\s]*/g)].map((m) => m[0].slice(1));
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
          !hasRouteFor(endpointSegments(literal), routes),
      )
      .map(({ file, literal }) => `${file} → ${literal}`);
    // 红话里带着「这是 404 不是空数据」：调用点常常一句 catch 就吞了
    expect(missing).toEqual([]);
  });

  it("登记表本身不陈旧：每条都还有字面量在用它、写着原因，且确实没有落点", () => {
    const used = new Set(found.map(({ literal }) => normalizeAddress(literal)));
    for (const [address, reason] of Object.entries(NON_REQUEST_ADDRESS)) {
      // 空壳原因（「TODO」这类）等于没有登记表
      expect(reason.length, `${address} 的登记理由太短`).toBeGreaterThan(30);
      expect(used, `${address} 已经没有字面量在用了，把登记删掉`).toContain(
        address,
      );
      // 有落点的路径不可能是「非地址」：那说明登记写错了，或这条已经有了 handler
      expect(
        hasRouteFor(endpointSegments(address), routes),
        `${address} 已经有 route handler 了，不该登记成非地址`,
      ).toBe(false);
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
    // 外部服务的地址（前面是 `}`）不进扫描面
    expect(endpointsOf("fetch(`${base}/api/prompt`)")).toEqual([]);
    // 登记表按**整条地址**放行，不是按前缀：`/api/trpcx` 这种长得像的一样要判
    expect(isRegisteredNonAddress("/api/trpc")).toBe(true);
    expect(isRegisteredNonAddress("/api/trpc?batch=1")).toBe(true);
    expect(isRegisteredNonAddress("/api/trpcx")).toBe(false);
    // 少一段就是少一段：登记了基址不等于登记了它下面的每一条
    expect(isRegisteredNonAddress("/api/trpc/project.list")).toBe(false);
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
