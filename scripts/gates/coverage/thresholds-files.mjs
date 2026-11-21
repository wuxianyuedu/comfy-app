/** 覆盖率门槛表（**纯数据**，ISSUE #4612 自 vitest.config.ts 抽离）：vitest.config.ts 只做装配，
 * 数字的登记、口径（§11.7 / §18.6 的「只升不降 + 实测值向下取整到 5 的倍数」）与
 * 「每条门槛都要落到真实文件」的判据（tests/coverage-targets-exist.test.ts）不变。
 * 分片只按长度门禁落点，键与数值的语义跨片一致。
 * ⚠️ include ⇄ thresholds 是**两处同批改**的成对清单：只写一边 = 门槛静默失效
 * （ui/file-picker.tsx 的前车之鉴）。本文件按 900 行长度硬闸（§12.13）分份存放，
 * 新增条目进哪一份都行（键语义不变），别为省一次查找把它们合并回去。
 */

export const COVERAGE_THRESHOLDS = {
  "src/lib/comfyui/lifecycle-derive.ts": {
    lines: 90,
    functions: 90,
    statements: 90,
    branches: 90,
  },
  "src/lib/comfyui/lifecycle.ts": {
    lines: 45,
    functions: 60,
    statements: 45,
    branches: 30,
  },
  // reaper 与队列调度的判决矩阵（ISSUE #315）：sweeper 的「跳过/回收/不动」
  // 与调度器的排队提示/槽位释放规则按实测值设门槛，只升不降。
  "src/lib/comfyui/reaper.ts": {
    lines: 70,
    functions: 70,
    statements: 70,
    branches: 60,
  },
  /* ── `src/lib` 的子域门槛（ISSUE #572 第 5 项 / 规范 §18.6）──────────
   *
   * 门槛此前只有上面那几个**文件**：`src/lib` 其余 180 个文件**零门槛**，
   * 于是「覆盖率」这件事对它们既不报警也不记账 —— 而 `film`（7.5%）、
   * `llm`（31%）、`core`（35%）恰恰是本项目的关键路径（编排 / 解密 / 仓储）。
   *
   * 三条口径（与 §11.7 的覆盖率棘轮一致）：
   *   1. 门槛取**实测值向下取整到 5 的倍数**，不设理想值 —— 设高了会让
   *      无关提交变红，设低了等于没设；
   *   2. 之后**只升不降**（补了测试就上调，改动导致下降要在这里说清楚）；
   *   3. 实测为 0 的目录先设 0，**但 0 不是终点**：补上测试就立刻上调
   *      （`drizzle-studio` 就是这么从 0 抬到 40 的）。
   *
   * 统计口径与表格里的 `lib/<domain>` 行一致（v8 按目录聚合）。 */
  // 从「20/20/15/10」抬到实测值：三条**从未被覆盖**的用户路径进了用例 ——
  //   · `agentic.ts`（0 → 100）：多轮引导的离线状态机（空历史 / 没说类型 /
  //     信息不足 / 出方案）与 LLM 路径的「模型返回畸形 JSON / 空回复 /
  //     缺 spec 却自称 ready」处置；
  //   · `client.ts`（0 → 100）：坏 tool_call 过滤（空 id 会让执行层串台）、
  //     非 2xx 错误信封解包、响应体不是 JSON 时的不炸路径；
  //   · `server.ts`（0 → 97.8）：两条协议（tools / JSON 指令回退）的选路与
  //     「action 未登记就不交给执行层」的闸门、消息窄化（伪造 system 被丢弃）。
  // 目录实测 77.96/70.05/82.6/81.26，取向下取整到 5 的倍数（只升不降，§18.6）。
  // `shared.ts` / `types.ts` 是纯类型文件（v8 记 0%），因此目录整体低于
  // 各实现文件的实测值 —— 门槛取目录口径。
  "src/lib/browser-io.ts": {
    lines: 95,
    functions: 100,
    statements: 90,
    branches: 80,
  },
  "src/lib/time-format.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 「值不存在显示什么」的口径（§16.2.4，P8 的对面）：判据只有在
   * 边界值上才看得出差别（`0` / `false` 照常显示、`""` / NaN 给占位符），
   * 所以按实测值设门槛 —— 这几条边界用例就是它的全部逻辑。 */
  "src/lib/display-value.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 「可搜索列表过滤」的口径（§16.2.4.16，P13 的对面）：判据的差别
   * 只在「归一化做到哪一步」上 —— `trim()` 单独写与 `trim().toLowerCase()`
   * 都编译、都运行，差别是含拉丁字母的候选能不能被小写关键字搜到。
   * 100/90/100/100 是实测值；唯一未覆盖的分支是 `filterGroups` 里
   * 「`field` 上的值不是数组」那条兜底（调用处类型上就到不了）。 */
  "src/lib/list-filter.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 90,
  },
  /* 隐藏文件选择框与闪一下复位这两件「交互样板」的出口：
   * 它们承载的是**时序**与**复位**，恰恰是各自调用点看不出来的部分
   * （卸载后 setState、连点被旧定时器打断、连选同一文件不触发 change）。 */
  "src/lib/external-open.ts": {
    lines: 100,
    functions: 100,
    statements: 95,
    branches: 85,
  },
  /* 「按形态」收口的三条新出口（规范 16 §16.2.4.27 ~ §16.2.4.29）。
   * 门槛取实测值向下取整到 5 的倍数（§18.6 的口径：不设理想值）：
   *   · `file-io` 100/100/100/100 —— 两条通道的「读到 / 读到空 / 读失败」
   *     六条路径（`file.text()` 与 `FileReader` 各三条）全在用例里；
   *   · `browser-storage` 95/100/90/90 —— 未覆盖的是「`removeItem` 抛」
   *     （配额满能测，删失败只有 Safari 隐私模式那一种现场）；
   *   · `use-enter-commit` 100/100/100/100 —— 判据只有「按哪个键」与
   *     「组字中不按」两件事，全在用例里。
   * ⚠️ 三个都**同批**进了上面的 `coverage.include` —— 只写门槛不进
   * `include` 会让门槛静默失效（`ui/file-picker.tsx` 的前车之鉴）。 */
  "src/lib/file-io.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 台账 E7 剩下的四档之一，按实测抬回满档（旧值 95/100/90/90 → E2 开门时降到
   * 80/85/80/85 → 本批 100/100/100/100）。当初没盖到的正是那条注释里点的两格：
   * `removeItem` 单独被拒（配额满测得到、删失败测不到），以及 `writeCookieItem`
   * 整支零执行者 —— 后者是 cookie 那条通道的唯一写入口，属性串三件（编码 /
   * `path=/` / 显式 `max-age`）少任何一件都不报错，只是服务端读不到或关窗即忘。 */
  "src/lib/browser-storage.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/async-action.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 85,
  },
  /* 「一组值写成查询串」的出口（§16.2.4.32，P29 的对面）：四条语义决定
   * （省略 / `0` 不是缺值 / 一律编码 / 重复键）都有正反用例。
   * 分支取实测值 —— 未覆盖的是 `decode()` 的容错分支在读取侧之外
   * 的那一条（`readQueryParam` 里 `+` 替换后再解码的组合）。 */
  "src/lib/query-string.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 95,
  },
  /* 「每一条各自挂错误」的出口（§16.2.4.33，P30 的对面）：判据是
   * 「错误属于哪一条」——`get` / `hasAny` / `report` / `clear` /
   * `clearAll` 与生命周期收敛（条目删掉、错误随之消失）全在用例里。
   * 分支取实测值 —— 未覆盖的是 `keys` 由 `undefined` 变为数组时
   * 那一档的 `useMemo` 重算（组件挂载后 `keys` 恒定的常态）。 */
  "src/lib/stale-run.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 「服务端错误信封」的出口（§16.2.4.35，P32 的对面）：两条口径
   * （取值走 `errorMessage`、形状只有两种）与客户端读取的两种历史
   * 形态、空文案、非错误体都在用例里。 */
  "src/lib/api-error.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 「给一条新记录分配 id」的出口（§16.2.4.36，P33 的对面）：同一前缀
   * 内的严格递增、每前缀一套序号、注入时刻的批内共享、随机短标记都在
   * 用例里。门槛先按实测值给 —— 「不回绕」这条判据本身就是用例的核心。 */
  "src/lib/unique-id.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 「ComfyUI 报错 → 可行动建议」的出口（§16.2.4.37，P34 的对面）：
   * 规则顺序即优先级、两条旧词表各自认得 / 漏掉的形态、未识别不编造
   * 建议、通用兜底的适用面、自动展开判据都在用例里。 */
  "src/lib/comfyui/error-advice.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 本批三条新出口（规范 16 §16.2.4.39 ~ §16.2.4.41）。
   * 门槛按**实测值**设（未覆盖的是 jsdom 到不了的分支：`use-element-box`
   * 的「`ResizeObserver` 回调里取值没变」与 `readElementBox` 的
   * 「元素上取不到 `getBoundingClientRect`」）。 */
  "src/lib/dom-rect.ts": {
    lines: 95,
    functions: 80,
    statements: 90,
    branches: 85,
  },
  /* 本批四条新出口（规范 16 §16.2.4.42 ~ §16.2.4.44）。门槛取**实测值**
   * （§11.7 的覆盖率棘轮口径：不设理想值，设高了会让无关提交变红）。
   * 两个类型守卫与两个调度函数都是纯判据，用例把每条分支都走到了；
   * 反馈 hook 的三条分支（成功 / 失败 / 静默）与重入判据也在用例里。 */
  "src/lib/next-frame.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/is-record.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/server/lib/request-body.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 「扩展名 ⇄ MIME」的唯一出口（§16.2.4.51，P47 的对面）：两组查表、
   * 带参数的 content-type 切分、`extOfPath` 的点/隐藏文件/查询串三态、
   * `stemOfPath` 与 `contentTypeForPath` 的两档兜底全在用例里。
   * 行/函数/语句 100 是实测值；分支 85 也是实测 —— 未覆盖的四条是
   * `split(...)[0] ?? ""` / `.pop() ?? ""` 这两处**不可达**兜底
   *（`split` 对任意输入都至少返回一个元素）。 */
  "src/lib/media/mime-ext.ts": {
    lines: 100,
    functions: 100,
    statements: 95,
    branches: 85,
  },
  /* 「把文本变成安全的文件名片段」的唯一出口（§16.2.4.53，P49 的对面）：
   * 两档的差异（保留 / 不保留 CJK）就是这条账的全部内容，必须 100%。 */
  "src/lib/safe-name.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 本批三条新出口（规范 16 §16.2.4.54 ~ §16.2.4.56），门槛按实测值设满档：
   *   · P50 对面 `~/lib/number-format` —— 四档各有边界（非有限数 /
   *     负零 / 整数 / 大小数位夹取），用例逐条钉住；
   *   · P51 对面 `~/lib/ordered-set` —— 「首次出现 vs 字典序」
   *     与「键为空值算不算身份」都是判据，逐条钉住；
   *   · P52 对面 `~/lib/media/data-url` —— 畸形输入（缺逗号 /
   *     非 base64 形态 / 空载荷）与浏览器侧分块编码都验到。 */
  "src/lib/number-format.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/ordered-set.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/media/data-url.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 本批三条新出口（规范 16 §16.2.4.57 ~ §16.2.4.59），门槛按实测值设满档：
   *   · P53 对面 `~/lib/keyboard` —— 三条归一规则（空格两个名字 /
   *     小写归一 / 单字符不 trim）与 `isKeyIn` 的边界逐条钉住；
   *   · P53 对面 `~/components/ui/simple-key-handler` ——
   *     `preventDefault` / `ignoreRepeat` 两个开关的正反两面都验到；
   *   · P55 对面 `~/lib/case-token` —— 连续大写 / 前导下划线 /
   *     往返一致这三条「刻意不做的花活」由用例钉住。 */
  "src/lib/keyboard.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/case-token.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 本批三条新出口（规范 16 §16.2.4.66 ~ §16.2.4.68），门槛按实测值设满档：
   *   · P62 对面 `~/lib/form-props` —— 五支适配器的边界逐条钉住
   *     （空串不是 0、`Infinity` 不交出去、`digitsOnly` 只留数字）；
   *   · P63 对面 `~/lib/page-window` —— 三族方向相反的窗口与各自的
   *     边界（空列表 / 越界页码 / `pageSize` 为 0 / 最后一块收口）；
   *   · P64 对面 `~/components/ui/use-throttled-progress` ——
   *     首帧立即、窗口内丢弃、同值短路、`flush` 终值、卸载守卫、
   *     按条目独立窗口与 `clear(key)`。 */
  "src/lib/form-props.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/page-window.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/path-display.ts": {
    lines: 100,
    functions: 100,
    statements: 95,
    branches: 90,
  },
  "src/lib/dom-props.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/with-timeout.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 80,
  },
  /* #2586 收进来的那一份撞锁循环体：四个分支（首次成 / 锁族重试 / 非锁族原样抛 /
   * 穷尽）各有用例，实测 11 statements、4 branches、1 function 全覆盖 ⇒ 按满档钉住。
   * 这条门槛要留的原因与 `sqlite-error` 同族：它是**判决路径**，掉一条分支就意味着
   * 某个「认不出原因就原样抛」的纪律没人再验了。 */
  "src/lib/sqlite-busy-retry.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 本批三条新出口（规范 16 §16.2.4.63 ~ §16.2.4.65），门槛按实测值设满档：
   *   · P59 对面 `~/lib/clamp` —— `NaN` 与 `±Infinity` 分两种处理、
   *     「先夹后整」的顺序、`min > max` 不换序都是判据，逐条钉住；
   *   · P60 对面 `~/lib/upper-token` —— 「吃空白」这条唯一口径与
   *     `unknown` 参数的守卫逐条钉住；
   *   · P61 对面 `~/lib/app-events` —— 带 / 不带载荷、多订阅者、
   *     退订只影响自己、无 `window` 分支都验到。 */
  "src/lib/clamp.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/collections.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/upper-token.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/app-events.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/media/natural-size.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 90,
  },
  /* 「媒体引用 → 可渲染地址」的出口（§16.2.4.32 的另一半）：
   * `/api/images` 的参数与编码、`subfolder` 的省略、空引用给 `null`、
   * 「以 `/` 开头即已是可渲染路径」都在用例里。 */
  "src/lib/media/media-url.ts": {
    lines: 95,
    functions: 100,
    statements: 95,
    branches: 90,
  },
  /* 台账 E7：`repository-task.ts` 补完执行者后的目录实测（原 90/90/90/85 是
   * E2 开门时的记账位）。抬档的那一截不是「补了几条断言」，而是三格此前**零执行者**
   * 的入口：底部状态栏那两格（刻意跨归属，补上归属条件就永远读不到 host 那片）、
   * 成片监看的批量进度、执行宿主的领取 / 只读窥视 / 载荷读；再加「includeImages
   * 且只给 skip」那条分页 —— 它走的是「普通 select 取页 + 按 id 装载」，
   * 与此前只跑到「这一页是空的」相比，`attachImages` 的真实装载第一次被执行。 */
  /* 「数据存放位置」的登记本体（ISSUE #3625）：纯数据模块，四条判据都有执行者 ——
   * 逐条登记项的不变量（类别存在、文案非空、同一 kind 共名）、分组结果
   * （不漏 / 不重 / 排序口径）与「每一类位置都真的画得出图标」都在用例里。
   * 门槛按实测值设满档（纯数据模块没有 IO 分支可漏）。 */
  "src/lib/layout-budget.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 窄窗判据 + 跨越次数。实测 lines 91.66 / branch 75 / funcs 85.71：
   * 唯一没走到的分支是 `getServerSnapshot`（SSR 快照），jsdom 与真浏览器都
   * 不会调它 —— 不为它把文件改成可注入（那是为了凑数而改结构），门槛按实测
   * 取不高于现状的档。 */
  "src/app/api/generated/[...path]/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/app/api/debug/source/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/app/api/comfy/stats/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/app/api/comfy/queue/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/app/api/comfy/ensure/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/poll-timer.ts": {
    lines: 90,
    functions: 85,
    statements: 90,
    branches: 85,
  },
  "src/lib/offline-gate.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/comfy/comfy-stats-store.ts": {
    lines: 95,
    functions: 75,
    statements: 95,
    branches: 100,
  },
  /* ── 体检清单 ⑦ 第二批 · 并到安全台账 A 系列（按实测登记）────────────
   * `custom-nodes`：35 条 POST 闸门用例 + 26 条 GET 只读侧用例（台账 E7 的
   * 最后一格，本批清掉）。仍登记在实测而不是 100：余下没覆盖的是 POST
   * `streamParse` 里解析器 stdout 协议的那几支（PROGRESS 行 / 退出码 /
   * 解释器轮换），由 `scripts/parse_custom_nodes.py` 的输出形态决定，
   * 归入下一批（不为凑数造假事件）。
   * 实测命令：`pnpm exec vitest run --no-file-parallelism --coverage.enabled
   * --coverage.include='src/app/api/custom-nodes/route.ts' src/app/api/custom-nodes/route.test.ts`
   * → 87.87 / 80 / 88.09 / 85.4（抬档前 77.95 / 70.96 / 83.33 / 80.8；四个维度同批只升不降，§11.7）。
   * 升上来的那一档全部来自「流式探测的进程协议」那 12 条：解释器退避链（异步 ENOENT
   * 与退出码 127 两条）、stderr 转进度、PROGRESS 行语法的四个分支与跨 chunk 的半行。 */
  "src/app/api/custom-nodes/route.ts": {
    lines: 87,
    functions: 87,
    statements: 85,
    branches: 79,
  },
  /* `project.ts`：分支 94.44 → 90（余下两处是 `patch` 里「nodes 给了、
   * edges 没给」这类形状组合，与 `params ?? {}` 的另一侧 —— 后者在当前
   * schema 下取不到，属于不可达分支，不为它写假数据凑数）。 */
  "src/server/api/routers/project.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 90,
  },
  /* `task.ts`：94.11 / 89.39 → 90 / 85。余下的是 `inferMediaType` 的
   * 音频/视频文案分支与 `list` 的补页出口 —— 都是「投影长什么样」而不是
   * 「越不越得过去」，本批不动它们。 */
  "src/server/api/routers/task.ts": {
    lines: 100,
    functions: 100,
    statements: 90,
    branches: 85,
  },
  /* 产物布局：一个形状、三条出口（落盘 / URL / 删除），每一支都必须有
   * 人判 —— 它是「一处认 projects、一处不认」这类分叉的最后一道线。 */
  "src/lib/media/output-paths.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* ── 体检清单 ⑦ 第三批 · 协议白名单（实测登记）──────────────────────
   * `url-scheme.ts` 满档：它是四条出口共用的那一句判据，掉一支就是某个
   * 危险协议被放行 —— 没有「大部分对就行」这一档。 */
  "src/lib/url-scheme.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 与上面 `coverage.include` 同批登记（实测满档）。这条不敢留余地：
   * 后缀形式、裁剪、`first > last` 的优先级这些分支只要有一支没人判，
   * 表现就是某些浏览器拖进度条时拿到 416 或半截字节，而全仓库是绿的。 */
  "src/server/lib/range-request.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 首页「本机算力」卡与它读的口径描述符（与上面 `coverage.include` 同批登记）。
   * 满档的依据是实测而不是理想值：描述符是纯函数、卡片的分支全在 jsdom 用例里
   * 走到位（含「未运行 / 首帧未到 / 迟滞期」三条互斥出口）。这块掉覆盖会同时
   * 影响状态栏与首页两处消费点，值得被数字看着。 */
  "src/server/api/routers/setting.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 90,
  },
  /* ── 体检清单 ⑨ · 素材库归属（实测登记）──────────────────────────── */
  /* 旧值 95/90/85/80（⑨ 第一刀）→ 现在按判据层自己有用例之后的**实测**登记。
   * 抬上来的原因不是「门多了」而是门少了一扇：tRPC 的 `material.*` 因零消费方删掉后
   * （台账 E3′）这里掉到 78.43 分支、`check:all` 当场红 —— 那些清洗与包含分支此前只被
   * 那扇门的用例**顺带**走过，而活着的 REST 门送进来的全是合法入参。
   * 补法是给判据层自己一份用例（`materials.test.ts`，按判据本身组织），
   * **不是 mock 出来凑数**：`folderDir` 那条包含断言从入口确实进不来（`scope` 过
   * `sanitizeScope`、`folder` 是枚举），但把 `..` 直接交给 `folderDir` 是能真判掉的行为 ——
   * 它是给「以后有人放宽那两条校验」兜底的双保险，现在有人判它。
   * 分支到 100 意味着这一族的每一条 `if` 都有人判。变异核过三条：去掉 scope 的长度上限、
   * 摘掉 `folderDir` 的包含断言、去掉隐藏文件的跳过 —— 各自恰好红一条，其余全绿。 */
  "src/lib/media/materials.ts": {
    lines: 100,
    functions: 95,
    statements: 98,
    branches: 100,
  },
  /* REST 这一条（含 multipart 上传与 500 兜底）按实测登记：判据本身都测到了，
   * 缺的是错误分支与超大上传的回执路径。
   * 这里原有第三份 `routers/material.ts`（95/100/95/80）：那一扇门零消费方，
   * 与本条是同一套判据的重复实现，随台账 E3′ 删除。删它那天本文件的分支覆盖掉到
   * 78.43（`check:all` 当场红）—— 补的是判据层自己的用例（上一条），不是把门找回来；
   * 那句「没去 mock `folderDir` 凑覆盖率」现在要说得更准：**没有 mock**，
   * 是把 `..` 直接交给 `folderDir` 这条真函数判的（入口进不来，判据层可以直接判）。 */
  "src/app/api/materials/route.ts": {
    lines: 85,
    functions: 80,
    statements: 80,
    branches: 75,
  },
  /* ── 体检清单 ⑦ 第四刀 · 产物归属判据（台账 A13，实测满档）──────────
   * 敢设 100 是因为「三族 × 每族的保守侧」这六个分支真的各有用例：
   * 项目格两种（我的 / 别人的）+ 共享区 + 库里没有的目录名、成片格三种
   * （我的 / 别人的 / `_tmp_` 中间目录）+ 无主的 bgm + 查不到的 id、
   * 任务格三种（我的 / 别人的 / 行已删）。少任何一支都会掉下 100 当场红。 */
  "src/lib/media/output-access.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 同上：`matcher` 里那两条产物前缀是**删掉不会有任何用例报错**的一档
   * （通配那条把带点路径全排除了，产物 URL 个个带扩展名），所以把它写成
   * 对 `config.matcher` 的直接断言，并给这一层满档。 */
  "src/proxy.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/appearance.ts": {
    lines: 100,
    functions: 90,
    statements: 95,
    branches: 85,
  },
  /* 统一容器（与 `coverage.include` 同批）。隔离实测四项都 100 ——
   * 它是纯形状组件，没有分支藏在数据里，满档不是凑出来的。 */
  "src/server/api/routers/film.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 首页「模型概览」（与上面 `coverage.include` 同批登记）。
   * 推导函数是纯输入输出、四项皆满；卡片未走到的那一支是「同时有折叠项和
   * 空目录」之外的单条件组合，按实测向下取整到 90 而不是抬成 100。 */
  "src/server/api/routers/model.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/server/api/routers/llm.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 工坊「镜头胶片带」（与上面 `coverage.include` 同批登记）。
   * 状态表是纯查表，四项皆满；胶片带未走到的两支是「场景标题为空」时可访问名
   * 与提示文案的回退 —— 按实测登记 85，不为了凑满去造一个空标题的夹具。 */
  "src/server/api/routers/skill.ts": {
    lines: 90,
    functions: 100,
    statements: 90,
    branches: 90,
  },
  "src/server/api/routers/workflow-model.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/server/api/routers/generate.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* E3 收口这一刀（见 coverage.include 同批注释）：`workflow-detail.ts` 三条
   * procedure 各有一个入口，5 条用例把三条分支（归属塌形 / 三种 NOT_FOUND /
   * 入参转发）都走满了 —— 单跑 `workflow.test.ts` 实测四维 100，就登记 100。 */
  "src/server/api/routers/workflow-detail.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* 视图页签 刀1 的状态模型（与 `coverage.include` 同批）。数值取隔离实测向下
   * 取整到 5：行与函数满档；未走到的几支是「存储里某一项形状不对」的少数回退
   * （语义上已被「任何一处不合法就整份放弃」那组用例覆盖，不为凑分支数造夹具）。 */
  "src/lib/comfyui/desktop-storage-paths*.ts": {
    lines: 95,
    functions: 90,
    statements: 95,
    branches: 85,
  },
  "src/app/\\(main\\)/settings/comfyui-storage-paths-config.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/server/film/compose-steps.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 65,
  },
  "src/app/api/images/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/app/api/film/bgm/route.ts": {
    lines: 95,
    functions: 100,
    statements: 95,
    branches: 75,
  },
  /* 台账 E7 的最后一档媒体源解析。旧值 35/30/35/30 只盖到「本地产物地址」那一支，
   * `http(s)` 拉取、`resolveMediaDataUrl`、`readUpstreamJson` 与两个字段守卫
   * 全是零执行者 —— 本批补齐（26 条）。
   * 数字来自**可复现的下界**：`vitest run --coverage
   * --coverage.include=src/lib/workshop/media-source.server.ts
   * --coverage.all=false src/lib/workshop/media-source.server.test.ts`
   * 实测 95.65/92.1/100/100 → 登记 95/92/100/100（口径同 `src/lib/process/**` 那一档：
   * 说清是哪条命令量的，别让下一个人拿全量数字来比对这一条）。
   * 仍没盖到的两支是**按构造走不到**的兜底：`data URL 解码为空`（`parseDataUrl`
   * 在更早一步就把空载荷判掉）与本地支的「磁盘读失败」。
   * 不为了凑 100 去构造 `base64,====` 那种解析器边角输入，也不 mock 一个读失败的
   * `fs`（那测的是不存在的输入形状；口径同台账 E8 的 `if (!dir)`）。 */
  "src/lib/workshop/media-source.server.ts": {
    lines: 100,
    functions: 100,
    statements: 95,
    branches: 92,
  },
  "src/lib/comfyui/firstframe.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 87,
  },
  /* ⑨ 第六刀 · 产物根搬迁。`output-layout.ts` 四维满档（四个导出各有用例，
   * 含界面用的 `artifactDirDisplay`）。搬迁那份留一档下限：唯一没盖到的是
   * 「旧根本身读不到」（权限 / 正被别的进程删）那条 catch  return（第 84 行）——
   * 造它要在别的用户下跑，不值当；这条路的后果只是「什么都不搬」。 */
  "src/lib/media/output-layout.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/media/artifact-root-migration.server.ts": {
    lines: 95,
    functions: 100,
    statements: 95,
    branches: 90,
  },
  /* 台账 E9 这一刀（与上面 `coverage.include` 同批登记）。数值取**这批用例
   * 实测的下限**（口径同 ⑨ 第五刀那句：只跑这批测出来的是地板，全量只会更高）：
   *   · 清单读取口的 `unreadable` 那一支原本缺的是「抛上来的 Error 没有 code」，
   *     补了一条把 `fs.readFileSync` 换成桩的夹具后四维满档 —— 留一档等于
   *     把「读盘故障冒成冷启动」那格重新打开；
   *   · `src/config/custom-nodes.ts` 也补到满档：缺的三支是注册表吃外部
   *     生成 JSON 时的形状回落（整条为 `null` 的节点、没有端口的节点、
   *     没有 `nodes` 字段的清单），全是解析器版本漂移的真形态，不是凑数。
   * 这一批敢立 100，是因为这四份文件就是这次事故的现场：判据看不见数字
   * 就等于没有判据（`/api/custom-nodes/manifest` 被删掉时全绿）。 */
  "src/lib/comfyui/custom-nodes-manifest.server.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/app/api/custom-nodes/manifest/route.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/config/custom-nodes.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/workshop/draft-integrity.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/log/log-file-client.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/media/video-queue-client.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/core/repository-task.ts": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 87,
  },
};
