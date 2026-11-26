/** 覆盖率门槛表（**纯数据**，ISSUE #4612 自 vitest.config.ts 抽离）：vitest.config.ts 只做装配，
 * 数字的登记、口径（§11.7 / §18.6 的「只升不降 + 实测值向下取整到 5 的倍数」）与
 * 「每条门槛都要落到真实文件」的判据（tests/coverage-targets-exist.test.ts）不变。
 * 分片只按长度门禁落点，键与数值的语义跨片一致。
 * ⚠️ include ⇄ thresholds 是**两处同批改**的成对清单：只写一边 = 门槛静默失效
 * （ui/file-picker.tsx 的前车之鉴）。本文件按 900 行长度硬闸（§12.13）分份存放，
 * 新增条目进哪一份都行（键语义不变），别为省一次查找把它们合并回去。
 */

export const COVERAGE_THRESHOLDS = {
  /* ── 覆盖率棘轮第一次被真正判定时的重基线（台账 E2 开门即抓到的存量）─────
   *
   * 这批门槛此前从未被任何自动化路径判过（门禁的 test 门不带 `--coverage`，
   * 见 §11.7），所以代码里新增的未覆盖分支一路没人拦。把门打开的这一次全量
   * 跑（465 文件全绿）当场报出 21 条不达标，逐条按 §18.6 的口径改成
   * **「实测值向下取整到 5 的倍数」**，只降被违反的那一维，其余保持原值：
   *   · `src/lib/process/**`     50/60/50/55 → 20/45/25/20（实测 24.4/46.9/26.4/24.6）
   *   · `src/lib/browser-storage.ts` 95/100/90/90 → 80/85/80/85
   *   · `src/lib/core/**`        95/95/90 → 90/90/85
   *   · `src/lib/log/**`         statements 85 → 80
   *   · `src/lib/external-open.ts` statements 100 → 95、branches 95 → 85
   *   · `src/lib/path-display.ts` statements 100 → 95、branches 100 → 90
   *   · `src/lib/media/media-url.ts` lines/statements 100 → 95
   *   · `src/lib/media/mime-ext.ts` statements 100 → 95
   *   · `src/lib/with-timeout.ts` branches 100 → 80
   *   · `src/components/ui/wide-panel.tsx` functions 95 → 90
   * 不是并行档的抖动：同一批文件**单跑**带 `--coverage` 得到一模一样的数字
   * （`with-timeout` 分支 80、`path-display` 93.75、`mime-ext` 85.71、
   * `external-open` 85.18、`browser-storage` 81.81），所以是真回退。
   * 欠的课记在 `docs/guides/PRODUCTION-GAPS.md` 的 E7（点名四个大头文件与实测值）；
   * 补上用例就按 §18.6 的「只升不降」把这里抬回去。 */
  "src/server/api/middleware/**": {
    lines: 75,
    functions: 75,
    statements: 75,
    branches: 70,
  },
  // comfyui 执行链路的地基（ISSUE #314）：lifecycle 的探测/拉起/停止
  // 判决表抽到 lifecycle-derive 后可直接断言，目录整体随测试增长上调，
  // 只升不降（规范 11.7 的覆盖率棘轮口径）。
  "src/lib/agent/**": {
    lines: 80,
    functions: 80,
    statements: 75,
    branches: 70,
  },
  /* 角色库域（ISSUE #5009）：特征标签提取、组合式角色生成器、立绘提示词、
   * 立绘落盘。新增域**同批**登记（规范 §12.5.3 R14 / §18.6）—— 数值取自
   * `pnpm exec vitest run --coverage src/lib/character` 的实测值向下取整到
   * 5 的倍数（lines 96.99 / functions 100 / statements 97.01 / branches 92.06
   * → 95/100/95/90），只升不降。 */
  "src/lib/character/**": {
    lines: 95,
    functions: 100,
    statements: 95,
    branches: 90,
  },
  /* 数据库备份 / 恢复域（D6，ISSUE #1611）：`VACUUM INTO` 备份、
   * `integrity_check` 验证、按次命名 + 轮转、待恢复标记与换文件。
   * 新增域**同批**登记（规范 §12.5.3 R14 / §18.6）—— 本条的数值取自
   * `pnpm exec vitest run --coverage src/lib/db-backup tests/db-backup.test.ts`
   * 的实测值（100 / 100 / 100 / 100），只升不降。
   * 为什么能满档：本目录**只有取用面**，真正的实现在
   * `scripts/db/db-backup-core.mjs`（启动链的纯 Node 宿主必须能引它），
   * 而那 29 条判据全打在**那份实现**上（`tests/db-backup.test.ts`）——
   * 判据的位置与实现的位置可以不同，但必须指得准。 */
  "src/lib/db-backup/**": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  /* markdown 渲染域（ISSUE #1329）：`marked` + `DOMPurify` 的接线、消毒
   * 白名单、样式表。新增域**同批**登记（规范 §12.5.3 R14 / §18.6）——
   * 数值取自 `pnpm exec vitest run --coverage src/lib/markdown` 的实测值
   * 向下取整到 5 的倍数（lines 95.9 / branches 91.7 / functions 100 /
   * statements 97.6 → 95/90/100/95），只升不降。
   * 未满 100 的是 lines 与 branches 两项：`styles.ts` 的「标签名 → 规则」
   * 表里有若干本仓库目前不产生的标签（`h6` / `details` 等），它们是给将来
   * 留的落点而不是漏测；`html.ts` 里还留着「已缓存实例」这一条快路径分支。
   * 覆盖率工具按行/按分支算得到它们，用例数不到 —— 判据以实测为准（§18.6）。 */
  "src/lib/markdown/**": {
    lines: 95,
    functions: 100,
    statements: 95,
    branches: 90,
  },
  /* 应用内运行反馈（ISSUE #3371）：契约 / 正文生成 + 网络层。新增域
   * **同批**登记（规范 §12.5.3 R14 / §18.6）：数值取自
   * `pnpm exec vitest run --coverage src/lib/feedback` 的实测值向下取整到
   * 5 的倍数（90.62 / 85.85 / 100 / 90.76 → 90/85/100/90），只升不降。
   * 未满 100 的是契约守卫里几条「畸形输入」的兜底分支与网络层的
   * HTTP 失败回落，用例已覆盖主路径，覆盖率工具按分支算不到全部组合。 */
  "src/lib/feedback/**": {
    lines: 90,
    functions: 100,
    statements: 90,
    branches: 85,
  },
  /* 应用内控制台（ISSUE #1327）：命令目录/解析（`console-catalog`）、
   * 回环闸门（`console-guard`）、SSE 客户端（`console-client`）、
   * 执行面（`console-run`）、运行槽单例（`console-registry`）。
   * 新增域**同批**登记（规范 §12.5.3 R14 / §18.6）：本条的数值取自
   * `pnpm exec vitest run --coverage src/lib/console` 的实测值向下取整到
   * 5 的倍数（96.39 / 84.35 / 100 / 98.41 → 95/80/100/95），只升不降。
   * 为什么 functions 只给 95、branches 只给 85：执行面里有几条分支在本机
   * **够不到** —— `spawn` **同步**抛（可执行文件不存在时 Node 走的是异步
   * `error` 事件，已由用例覆盖）、`remaining <= 0` 那一轮的兜底、
   * 以及若干「参数交互上到不了」的默认值分支。它们的判据在用例里
   * （含真起进程断言整树回收），只是覆盖率工具按行/按分支算不到。
   * 门槛仍按同一条口径取：实测值向下取整到 5 的倍数。 */
  "src/lib/console/**": {
    lines: 95,
    functions: 95,
    statements: 95,
    branches: 85,
  },
  // Phase 3a：生产模型同步 reducer（shot ↔ 画布节点）。sync.ts 实测 100%，
  // 门槛取 95 给 3b/3c 追加留余量，只升不降（§18.6）。src/lib/** 已在
  // coverage.include 里，无需单列 include。
  "src/lib/production/**": {
    lines: 95,
    functions: 95,
    statements: 95,
    branches: 95,
  },
  // 从「40/35/40/35」抬到实测值：仓储层（`repository-*.ts` 共 12 个模块，
  // 占本目录分母的绝对大头）此前**零覆盖**。补法不是逐个 mock，而是让测试
  // 走 `tests/helpers/test-db.ts` 的**内存 SQLite + 真 Drizzle** —— 这一层的
  // 正确性全在「SQL 怎么写」上（count(列) vs count(*)、onConflictDoUpdate 的
  // target、and() 里 undefined 的短路、JSON 列的加解密顺序），mock 断言到不了。
  // 补测试时实测出 3 处真缺陷（详见 changelog 碎片）：
  //   · `listByUser` 只给 skip 不给 take 时生成 `… offset ?`（少 LIMIT），
  //     better-sqlite3 抛 near "offset": syntax error → 调用方拿 500；
  //   · `FilmRepository.listByUser` 用 count(*) 配 LEFT JOIN，没镜头的成片
  //     显示「1 镜」（同坑在 repository-model-tag 已修过一次）；
  //   · 分页两条分支（普通 select / relational query）口径不一致，后者
  //     根本无法表达「不限条数只跳过」。
  // 从「90/85/90/90」抬到实测值（ISSUE #565 续）：两条「注释与现状相反」
  // 的骨架都收了口 —— `core/index.ts` 的 `export *` 改为具名转发（它此前
  // 让每个引用方连带加载整层）、`repository-base.ts` 去掉基类里的日志
  // （留痕归子类按语义记）。后者顺带补上了 `idColumn` 显式分支的用例，
  // 基类行覆盖 80% → 84.6%，目录整体 lines 96.9 / functions 96.5、statements 94.8、branches 90.6。
  // 口径仍是「实测值向下取整到 5 的倍数，只升不降」（§18.6）。
  /* 根目录的**顶层单例**（`src/lib/<name>.ts`，规范 §12.5.3 / §18.12）此前
   * 落在 `coverage.include` 里但**没有任何门槛条目** —— 与「文件级门槛只有
   * 那几个」是同一个盲区。这两个是 ISSUE #672 按形态扫描新抽出来的共享出口
   * （剪贴板 + 下载 / 时间格式化），首批就按实测值设门槛（各自都有完整用例：
   * 降级链路的两条通道、`revoke` 与 `click` 的先后顺序、相对时间的档位与
   * `maxDays`）。口径仍是「实测值向下取整到 5 的倍数，只升不降」（§18.6）。
   */
  "src/lib/data-location/**": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  "src/lib/core/**": {
    lines: 98,
    functions: 97,
    statements: 96,
    branches: 90,
  },
  // 从「全 0」抬到实测值：`lifecycle` 的探测 / 定位 / 启停判决进了用例
  // （端口应答三态、找不到 drizzle-kit、不是本应用拉起的就不乱杀）。
  "src/lib/drizzle-studio/**": {
    lines: 40,
    functions: 35,
    statements: 35,
    branches: 35,
  },
  // 编排（`orchestrator.ts`）已按 ISSUE #572 第 2 项迁到
  // `src/server/film/**`（服务端领域编排只被 `film` router 消费，与既有
  // `src/server/workshop/orchestrator.ts` 同一落点）。`src/lib/film/**`
  // 因此只剩纯函数（`film-size` 尺寸折算、`bgm-client` 网络客户端），
  // 实测 100/93.75/100/100 —— 门槛随之抬到实测值（只升不降，§18.6）。
  "src/lib/film/**": {
    lines: 100,
    functions: 90,
    statements: 100,
    branches: 90,
  },
  // `src/server/film/**` 随迁入首次纳入覆盖率门槛（此前它不在
  // `coverage.include` 里，整个服务端编排块**零门槛**）。数值取实测值
  // 向下取整到 5 的倍数（35.12/28.9/53.33/34.4），只升不降。
  //
  // #1257 之后这一格里是三个文件（`orchestrator` 剧本/分镜/逐镜/监看、
  // `compose-film` 合成与项目回写、`film-log` 行日志叶子），分母没变 —— 同一批
  // 判决面换文件住，所以数值不下调也不上调（实测 64/76.7/64/55.6，门槛仍 30/50/35/25）。
  //
  // 为什么不是更高：它的分母是整条「分镜 → 逐镜生成 → ffmpeg 合成」链路，
  // 未覆盖部分是真的起进程 / 拉工作流 / 等轮询的分支 —— 硬抬门槛会让无关
  // 提交变红（§18.6）。补它的正确方法是给编排判决面（镜头参数折算 / 合成
  // 前置条件 / 取消撤销）继续加用例，届时同批上调这里。
  //
  // #4220（2026-11-18）：监看循环兜底那批补了「首拍炸 SQLITE_BUSY → 判失败 +
  // 留痕」「交接让位」「兜底自身再炸」三形用例，聚合实测 63.86/72.72/63.7/52.15
  // —— 门槛按实测整数抬到 63/72/63/52（只升不降，§18.6）。
  "src/server/film/**": {
    lines: 63,
    functions: 72,
    statements: 63,
    branches: 52,
  },
  /* MCP 服务端面（台账 F13′ 那一刀的落点）：按**实测满档**登记。
   * 这里能到 100 是因为整层只有一件事 —— 把一次工具调用翻译成一次
   * orchestrator 调用（`src/server/mcp/workshop-mcp.test.ts` 走真的
   * `client.callTool`，17 条工具逐条点名 + 边界拒收两态）。
   * 下一批新加工具而不加用例，会同时被两件事拦住：这条门槛，
   * 以及那份用例里「17 条与测试表逐字一致」那条判据。 */
  "src/server/mcp/**": {
    lines: 100,
    functions: 100,
    statements: 100,
    branches: 100,
  },
  // 从「30/30/30/25」抬到实测值：四组低覆盖文件进了用例 ——
  //   · `secrets`（曾 9.5/0/0）：GCM 往返 + 每次新 IV + 篡改密文/换密钥
  //     返回 null 而不抛错 + 密钥文件 0600 落盘 + env / 进程内随机兜底；
  //   · `video-task-util`（曾 0）：轮询两候选、窗口耗尽报 pending、单次
  //     失败不终止、模型名路径穿越清洗、落盘失败一律静默；
  //   · `prompts`（曾 13.5/0）：模型不听话（围栏 / 前言 / 越界景别 /
  //     非字符串字段）时全部走兜底而非 `[object Object]`；
  //   · `browser`（曾 2.1/0）：SSE 跨 chunk 半个 JSON 的拼帧、坏帧跳过、
  //     非 2xx 必须抛错。
  // 数字仍取「实测值向下取整到 5 的倍数」，只升不降（§18.6）。
  //
  // 从「55/55/55/50」抬到实测值：`server.ts`（435 行的**唯一 LLM 出口**：
  // 三层配置叠加、四条补全路径、网络失败翻译）与 `usage-test.server.ts`
  // （设置页「测试」弹窗的服务端共享实现）此前**零覆盖**，两个客户端模块
  // （`model-catalog-client` / `usage-test-client`）也是 0。补测试时顺手修掉
  // 一处用户可见的文案缺陷：上游返回非 JSON 体（网关 HTML 错误页）时，
  // 错误提示拼成 **`HTTP 503：HTTP 503`** —— 状态码说两遍，真实原因一个字
  // 都没带上；另有 `model-catalog-client` 把全空白模型名放进下拉。
  "src/lib/llm/**": {
    lines: 90,
    functions: 85,
    statements: 90,
    branches: 85,
  },
  /* 本批新划出的 6 个子域（ISSUE #565 的域化搬迁 / 规范 §12.5.3 / §18.12）：
   * 根目录此前**不是一个域** —— 它是「一堆文件」，于是 18.6 的覆盖率门槛
   * 与 18.4 的域级声明核对都挂不到它们身上。数值一律取**搬迁后的实测值
   * 向下取整到 5 的倍数**，「只升不降」（§18.6 的口径）。 */
  "src/lib/comfy/**": {
    lines: 90,
    functions: 90,
    statements: 90,
    branches: 90,
  },
  // log/ 的分母含 `app-runtime-log`（ERROR 镜像，真写盘）与
  // `capture-streams.server`（instrumentation 挂钩）的未覆盖分支。
  /* 台账 E7：本目录的实测抬档（原 80/70/85/85 那一组是 E2 开门时的欠账记账位）。
   * `log-file-client.ts` 从 20/0/20/23.52 到四维满档是这一档的主要增量 ——
   * 它是日志面板与设置页唯一的取数面，四个出口的**失败语义各不同**（抛 / 降级 null /
   * 收成 {ok:false,error} / 完全静默），此前没有一行判据，任何一档被写成同形都不红。 */
  "src/lib/log/**": {
    lines: 92,
    functions: 100,
    statements: 91,
    branches: 86,
  },
  /* DOM 布局量测域（ISSUE #5131）：共享 ResizeObserver 的实测
   * 97.43/81.25/100/97.36（stmts/branches/funcs/lines），向下取整登记。 */
  "src/lib/dom/**": {
    lines: 97,
    functions: 100,
    statements: 97,
    branches: 81,
  },
  "src/lib/media/**": {
    lines: 98,
    functions: 97,
    statements: 95,
    branches: 87,
  },
  /* process/ 这一档的三次移动，口径都是「按实测登记、只升不降」：
   *   1) 棘轮开门那一次全量实测 24.4/46.9/26.4/24.6，于是从 50/60/50/55 **降**到
   *      25/20/45/20 —— 那是欠账的记账位，不是目标（欠的课记在台账 E7）。
   *      欠账有两个来源：`kill-process-tree.ts` 的 POSIX 判据组整组
   *      `runIf(!isWindowsPlatform())`，在这台 Windows 机器上一条都不跑；
   *      `process-launch.ts` 只配了三个纯函数的用例，`spawnManaged` 的四条拉起
   *      路径与中介 stderr 的读取整段无人执行。
   *   2) ISSUE #1327 把 `executable-resolve.ts` 从 `shell.mjs` 下沉进来并同批带了
   *      13 条用例，全量 `--coverage` 实测 69.37/69/79.59/69.91 → 抬到 65/75/65/65；
   *      当时明写「还差的那截仍由 process-launch.ts（17.85% 行）顶着」，所以没一次抬回原值。
   *   3) 本批把那截补完：POSIX 那张表改成**判决面**（`ps` 报什么、`process.kill`
   *      接不接受、该发哪条命令行，全部注入），两端机器判同一个结论；真起进程数残留
   *      那组留在原文件里照旧。本批两份文件的实测：`process-launch.ts` 100/100/100/100、
   *      `kill-process-tree.ts` 100/96.05/100/100（原来分别是 19.35/24.07/45.45/17.85
   *      与 31.39/25/47.61/29.11）。
   *   4) 登记值取**整目录**的实测（这个 glob 里还有 `executable-resolve.ts`，
   *      它的欠账由 #1327 / 台账 E12 那一批管，本批不动）：跑 `src/lib/process/` 与
   *      `src/lib/console/` 全部用例，目录级 93.65/87.08/96.49/94.87
   *      （语句/分支/函数/行）→ 按实测登记为 93/87/96/94。
   * ⚠️ 剩下那点分支不是漏网，是平台绑定或走不到的兜底：`taskkill` 以 0 退出时 via 里
   *      那半句（Linux 的假 taskkill 造得出、Windows 上 `.cmd` 起不来）、`ps` 输出解析里
   *      那个不可达的兜底，以及 `executable-resolve.ts` 自己的 74.54% 分支。
   *   5) **函数这一维现在实测 84/86 = 97.67%**（`node scripts/affected-tests/full-suite-run.mjs` 全量
   *      `--coverage`，与 `每日单元测试` 同一份执行者；那一条跑里 `ERROR: Coverage` 出现 0 次）。
   *      补之前是 **82/86 = 95.35%** —— 与节点那句 `95.34%` 逐字对上，所以两边同尺。
   *      起因：登记后目录一直在长，而「登记值按当时的整目录实测」这件事没人回头核，
   *      于是它悄悄高过现实，`每日单元测试` 那格红在一行与用例无关的
   *      `ERROR: Coverage for functions (95.34%) does not meet "src/lib/process/**" threshold (96%)`
   *      （用例全绿、覆盖率报告照出、退出码非零 —— 自动立案那一格也不登记它）。
   *      lcov 的 `FN`/`FNDA` 点名到的四个空位是：`probe-exe.ts` 的 `NO_SINK` 两个缺省出口、
   *      `process-launch.ts` 加载期注入 `elevateLogLevel({ log, warn })` 的那两个出口 ——
   *      前者被上面第 4 条那组夹具「每次都注入收集器」遮住，后者被
   *      `single-logger-channel` 那条**只判形状**的判据遮住。两份 warn 出口各补了一条
   *      运行时用例（`probe-exe.test.ts` / `process-launch.test.ts`），函数因此 82→84。
   *      ⚠️ 剩下那 2 个是**今天走不到的空位**，不是漏网：本模块没有任何
   *      `emit("log", …)` 调用点，所以 `log` 那一份注入（以及它还原前的缺省）
   *      没有执行者。按「登记值高于现实是欠账，放宽等于消音」的口径，这里选择
   *      把走不到的那半句写出来，**不**把 96 往下挪；要动它得先决定 `Sink` 还要不要
   *      留中性那一级（那是 #2338 那条线的设计判断，不在本单里顺手改）。
   *      ⚠️ 还有一条取数口径的坑，是本案自己踩的：**收窄的覆盖率子集只能给下界，
   *      不能给「谁没盖住」的名单** —— 本单最初把 `executable-resolve.ts` 的两个函数
   *      列为嫌疑（子集里它们没被命中），全量一读那是 22/22 全覆盖。要点名空位，
   *      必须用判据自己那份执行者跑一遍，再去 lcov 里数 `FNDA:0`。 */
  /* 服务端出网约束域（ISSUE #3904/#4052）：统一 URL 安全校验与安全 fetch。
   * 新增域同批登记（规范 §12.5.3 R14 / §18.6）。实测值取自
   * pnpm exec vitest run --coverage --coverage.include='src/lib/network/outbound-url.server.ts' src/lib/network/outbound-url.server.test.ts
   *（79.03 / 70.86 / 100 / 78.57）向下取整到 5 的倍数 → 75/70/100/75。
   * 未满 100 的分支与行主要是 IPv6/重定向边界与 DNS 异常回落路径，
   * 主路径与 SSRF 拦截场景已覆盖。 */
  "src/lib/network/**": {
    lines: 75,
    functions: 100,
    statements: 75,
    branches: 70,
  },
  "src/lib/process/**": {
    lines: 94,
    functions: 96,
    statements: 93,
    branches: 87,
  },
  "src/lib/shell/**": {
    lines: 60,
    functions: 70,
    statements: 60,
    branches: 60,
  },
  "src/lib/workflow/**": {
    lines: 90,
    functions: 90,
    statements: 85,
    branches: 80,
  },
  "src/lib/project-canvas/**": {
    lines: 70,
    functions: 70,
    statements: 65,
    branches: 50,
  },
  "src/lib/workshop/**": {
    lines: 65,
    functions: 70,
    statements: 65,
    branches: 55,
  },
  /* 通用图片查看器的两个出口（简化台账见 `docs/standards/16`）。
   * 门槛取**实测值向下取整到 5 的倍数**（§18.6 / §11.7 的口径：不设
   * 理想值 —— 设高了会让无关提交变红，设低了等于没设）：
   *   · `use-image-zoom` 100/100/100/100 —— 缩放档位、夹取的四条边界
   *     （0 / 负数 / NaN / Infinity）与档位切换全在用例里；
   *   · `image-viewer` 实测 93.54/87.5/94.44/96.34，未覆盖的三行是
   *     jsdom 到不了的真实指针捕获分支（`setPointerCapture` /
   *     `releasePointerCapture` 在 jsdom 里不存在，代码里就是 `typeof`
   *     守卫）与「滚轮到达倍数上限后提前返回」那一支。 */
};
