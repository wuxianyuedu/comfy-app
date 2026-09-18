import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "~": path.resolve(import.meta.dirname, "src"),
      // server-only 包在 vitest node 环境会抛错（它就是干这个的）；
      // 数据访问层的硬约束在 Next 构建期仍然生效，测试里换空实现。
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/stubs/server-only.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    globals: false,
    setupFiles: ["tests/setup.ts"],
    // 覆盖率棘轮策略(2026-08-29):已覆盖目录按真实水平设硬门槛,随测试增长上调;
    // 新目录覆盖后加入下表。全库 3% 的整体数字仅作信息参考,不设全局门槛。
    coverage: {
      provider: "v8",
      // 三种格式各有明确用途，别按「没人看就删掉」精简：
      //   text          —— 人读（终端日志）；
      //   json-summary  —— 本地看目录汇总；
      //   lcov          —— 机器读的那份。平台侧流水线曾用 `testing:coverage` 插件
      //                    读 `coverage/lcov.info`（ISSUE #623 后该流水线已删除，
      //                    见 docs/standards/13 §13.5.3）。保留 lcov 是因为它是
      //                    「覆盖率接任何外部工具」的通用入口，且删掉会让
      //                    日后重启上报时重新踩一遍「插件找不到报告文件」那个坑
      //                    ——当时的现场是插件 1.8s 就退出，而报错完全指不出是
      //                    reporter 少配了一项。
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/server/api/middleware/**", "src/server/film/**", "src/lib/**"],
      exclude: ["src/lib/**/*.test.ts"],
      thresholds: {
        "src/server/api/middleware/**": {
          lines: 75,
          functions: 75,
          statements: 75,
          branches: 70,
        },
        // comfyui 执行链路的地基（ISSUE #314）：lifecycle 的探测/拉起/停止
        // 判决表抽到 lifecycle-derive 后可直接断言，目录整体随测试增长上调，
        // 只升不降（规范 11.7 的覆盖率棘轮口径）。
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
        "src/lib/comfyui/executor-scheduler.ts": {
          lines: 70,
          functions: 70,
          statements: 70,
          branches: 50,
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
        "src/lib/agent/**": {
          lines: 80,
          functions: 80,
          statements: 75,
          branches: 70,
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
        "src/lib/core/**": {
          lines: 95,
          functions: 95,
          statements: 90,
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
        // 为什么不是更高：它的分母是整条「分镜 → 逐镜生成 → ffmpeg 合成」链路，
        // 未覆盖部分是真的起进程 / 拉工作流 / 等轮询的分支 —— 硬抬门槛会让无关
        // 提交变红（§18.6）。补它的正确方法是给编排判决面（镜头参数折算 / 合成
        // 前置条件 / 取消撤销）继续加用例，届时同批上调这里。
        "src/server/film/**": {
          lines: 30,
          functions: 50,
          statements: 35,
          branches: 25,
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
        /* 本批新划出的 6 个子域（ISSUE #565 的域化搬迁 / 规范 §12.5.3 / §18.14）：
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
        "src/lib/log/**": {
          lines: 85,
          functions: 85,
          statements: 85,
          branches: 70,
        },
        "src/lib/media/**": {
          lines: 80,
          functions: 75,
          statements: 75,
          branches: 70,
        },
        // process/ 的 `kill-process-tree` 大部分分支要真杀进程（平台相关），
        // 实测 52/61 —— 门槛按实测值设，补判决面（而非真起进程）时同批上调。
        "src/lib/process/**": {
          lines: 50,
          functions: 60,
          statements: 50,
          branches: 55,
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
      },
    },
  },
});
