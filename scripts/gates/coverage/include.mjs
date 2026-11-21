/** 覆盖率include 名单（**纯数据**，ISSUE #4612 自 vitest.config.ts 抽离）：vitest.config.ts 只做装配，
 * 数字的登记、口径（§11.7 / §18.6 的「只升不降 + 实测值向下取整到 5 的倍数」）与
 * 「每条门槛都要落到真实文件」的判据（tests/coverage-targets-exist.test.ts）不变。
 * vitest 只对「出现在报告里的文件」判门槛 —— 被 thresholds 点名的每个文件都必须在这里登记。
 * ⚠️ include ⇄ thresholds 是**两处同批改**的成对清单：只写一边 = 门槛静默失效
 * （ui/file-picker.tsx 的前车之鉴）。本文件按 900 行长度硬闸（§12.13）分份存放，
 * 新增条目进哪一份都行（键语义不变），别为省一次查找把它们合并回去。
 */

export const COVERAGE_INCLUDE = [
  "src/server/api/middleware/**",
  "src/server/film/**",
  /* MCP 服务端：17 条工具是**外部 AI 客户端可写的入口**（整幅覆盖草稿角色卡与
   * 分镜并落库），此前这一层既不在覆盖率面上也没有任何执行者。
   * 与下面 `thresholds` 里的同名条目**两处同批**（只写一处 = 门槛静默失效）。 */
  "src/server/mcp/**",
  "src/lib/**",
  /* ⚠️ 这里必须列出**每一个**被 thresholds 点名的 `ui/` 出口 ——
   * 阈值只对「出现在报告里的文件」生效，没进 `include` 的路径是一条
   * **静默失效**的条目（`ui/file-picker.tsx` / `ui/use-flash-state.ts`
   * 就是这样挂了一整轮：门槛写着 95/90/95/100，报告里查无此文件）。
   * 新增 `ui/` 出口门槛时**两处同批改**：本数组 + `thresholds`。 */
  "src/components/ui/file-picker.tsx",
  "src/components/ui/use-flash-state.ts",
  "src/components/ui/expansion-set.ts",
  "src/components/ui/wide-panel.tsx",
  "src/components/ui/progress-bar.tsx",
  "src/components/ui/key-value-rows.tsx",
  "src/components/ui/media-thumbnail.tsx",
  "src/components/ui/media-drag-source.tsx",
  "src/components/ui/use-hotkey.ts",
  "src/components/ui/use-scroll-follow.ts",
  "src/components/ui/form-field.tsx",
  "src/components/ui/use-external-action.ts",
  /* ⚠️ 新增 `ui/` 出口门槛时**两处同批改**：本数组 + `thresholds`。
   * 只写门槛不进 `include` 会让门槛**静默失效**（报告里查无此文件）。 */
  "src/components/ui/use-enter-commit.ts",
  "src/lib/external-open.ts",
  "src/lib/file-io.ts",
  "src/lib/browser-storage.ts",
  /* 本批三条新出口（规范 16 §16.2.4.30 ~ §16.2.4.32）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/lib/async-action.ts",
  "src/lib/query-string.ts",
  "src/lib/media/natural-size.ts",
  "src/lib/media/media-url.ts",
  /* 本批三条新出口（规范 16 §16.2.4.33 ~ §16.2.4.35）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）；
   * `use-item-errors` 是 `ui/` 下的 hook，一并登记。 */
  "src/components/ui/use-item-errors.ts",
  "src/lib/stale-run.ts",
  "src/lib/api-error.ts",
  /* 本批三条新出口（规范 16 §16.2.4.36 ~ §16.2.4.38）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/lib/unique-id.ts",
  "src/lib/comfyui/error-advice.ts",
  /* 本批三条新出口（规范 16 §16.2.4.39 ~ §16.2.4.41）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/components/ui/tree-rows.tsx",
  "src/components/ui/use-item-action.ts",
  "src/components/ui/use-element-box.ts",
  "src/lib/dom-rect.ts",
  /* 本批三条新出口（规范 16 §16.2.4.42 ~ §16.2.4.44）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/lib/next-frame.ts",
  "src/components/ui/use-copy-feedback.ts",
  "src/lib/is-record.ts",
  "src/server/lib/request-body.ts",
  /* 本批三条新出口（规范 16 §16.2.4.51 ~ §16.2.4.53）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/lib/media/mime-ext.ts",
  "src/lib/safe-name.ts",
  /* 通用图片查看器（形态 + 数值）两个出口：前者是弹窗、滚轮锚点与拖拽
   * 平移的组装，后者是缩放档位与倍数夹取。与上面那批同款 ——
   * **两处同批改**（`coverage.include` + `thresholds`），只写门槛不进
   * `include` 会让门槛静默失效。 */
  "src/components/ui/image-viewer.tsx",
  "src/components/ui/use-image-zoom.ts",
  /* 本批三条新出口（规范 16 §16.2.4.54 ~ §16.2.4.56）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/lib/number-format.ts",
  "src/lib/ordered-set.ts",
  "src/lib/media/data-url.ts",
  /* 本批三条新出口（规范 16 §16.2.4.57 ~ §16.2.4.59）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）；
   * `simple-key-handler` 是 `ui/` 下的出口，一并登记。 */
  "src/lib/keyboard.ts",
  "src/components/ui/simple-key-handler.ts",
  "src/lib/case-token.ts",
  /* 本批三条新出口（规范 16 §16.2.4.60 ~ §16.2.4.62）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）。
   * 三个都是纯函数模块（无 React、无 IO），可以逐分支钉死。 */
  "src/lib/path-display.ts",
  "src/lib/dom-props.ts",
  "src/lib/with-timeout.ts",
  /* 本批三条新出口（规范 16 §16.2.4.63 ~ §16.2.4.65）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）——
   * 只写门槛不进 `include` 会让门槛静默失效。
   *   · `clamp` / `upper-token` 是纯函数模块（无 React、无 IO），
   *     可逐分支钉死；
   *   · `app-events` 只有在 jsdom 下才走得到真实分支（`window` 的
   *     存在性判据），用例自带 `@vitest-environment jsdom`。 */
  "src/lib/clamp.ts",
  "src/lib/collections.ts",
  "src/lib/upper-token.ts",
  "src/lib/app-events.ts",
  /* 本批三条新出口（规范 16 §16.2.4.66 ~ §16.2.4.68）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）——
   * 只写门槛不进 `include` 会让门槛静默失效。
   *   · `form-props` / `page-window` 是纯函数模块（无 React、无 IO）；
   *   · `use-throttled-progress` 是 `ui/` 下的 hook 出口（三个入口）。 */
  "src/lib/form-props.ts",
  "src/lib/page-window.ts",
  "src/components/ui/use-throttled-progress.ts",
  /* 本批两条新出口（规范 16 §16.2.4.69 / §16.2.4.71）。
   * 与上面那批同款：**两处同批改**（`coverage.include` + `thresholds`）；
   * `use-busy-action` 是 `ui/` 下的 hook 出口，一并登记。 */
  "src/components/ui/use-reentrancy-lock.ts",
  "src/components/ui/use-refresh-ticket.ts",
  "src/components/ui/use-busy-action.ts",
  /* P82 的合规出口（悬停提示收成一处，规范 16 §16.2.3 / §12.18 补地基）
   * 与它脚下的 `tooltip.tsx`（ISSUE #1295 给它加了视口安全边距，
   * 见规范 §16.8 台账）。与上面那批同款：**两处同批改**。 */
  "src/components/ui/hint.tsx",
  "src/components/ui/tooltip.tsx",
  /* `ui/toggle-group` 的选中档三层是本仓库的定制（规范 16 §16.8），
   * 有用例钉住就得进门槛。同款 **两处同批改**。 */
  "src/components/ui/toggle-group.tsx",
  /* 「一排里选一个」的 chip（ISSUE #1423 / 规范 16 §16.2.4）：
   * 它替掉的是全库 20 处**逐字相同**的选中态三元 —— 那些三元只写了
   * 「未选中之外」的那一半，选中档没钉住悬停值，于是被 `Button` 的
   * `outline` 变体自带的 `hover:text-foreground` 吃掉（划到已选中的
   * chip 上字色翻白）。同款 **两处同批改**（`coverage.include` +
   * `thresholds`）：只写门槛不进 `include` 会让门槛静默失效。 */
  "src/components/ui/select-chip.tsx",
  /* 左轨让位这笔账（阈值算式 + 三档优先推导）与它的窄窗判据出口。
   * 同款 **两处同批改**（`coverage.include` + `thresholds`）：
   *   · `layout-budget` 是纯函数模块（无 React、无 IO），可逐分支钉死；
   *   · `use-narrow-nav` 只有在 jsdom 下才走得到真实分支（`window` 的
   *     存在性判据），用例自带 `@vitest-environment jsdom`。 */
  "src/lib/layout-budget.ts",
  "src/components/ui/use-narrow-nav.ts",
  /* 悬浮元素「拖到哪、下次还在哪」这一笔账的两个出口（ISSUE #1295 /
   * 规范 16 §16.2.4.72）：
   *   · `use-draggable-position` 是拖动 + 位置记忆 + 视口夹取，
   *     用例覆盖到「阈值内算点击 / 超阈值算拖动」「拖出视口被夹住」
   *     「窗口缩小后收紧」「只接主键」；
   *   · `use-viewport-size` 是「视口多大」的唯一读数，用例覆盖到
   *     「首帧 `null`」「resize 跟随」「取值未变不换引用」。
   * 同款 **两处同批改**（`coverage.include` + `thresholds`）——
   * 只写门槛不进 `include` 会让门槛静默失效。 */
  "src/components/ui/use-draggable-position.ts",
  "src/components/ui/use-viewport-size.ts",
  /* 锚定浮层的碰撞边界（气泡被应用级标题行吃掉半个身子的修法）：
   * 算式是纯函数（`~/lib/full-screen-layer` 的 `anchoredOverlayBoundary`），
   * 这里量的是「壳态 / 非壳态 / 首帧」三条判据确实接上了。同款
   * **两处同批改**（`coverage.include` + `thresholds`）。 */
  "src/components/ui/use-overlay-boundary.ts",
  /* API 路由 handler（体检清单 ⑦ 的第一批：闸门与三态契约类）。这一层此前
   * **整层不在覆盖率面上** —— 既不在 `src/lib` 也不在 `src/server` 的通配里，
   * 于是路由的鉴权 / 路径包含 / 状态码契约坏了没有任何数字会动。
   * 与下面的 `thresholds` **两处同批**登记（只写一处 = 门槛静默失效）。 */
  String.raw`src/app/api/generated/\[...path\]/route.ts`,
  "src/app/api/debug/source/route.ts",
  "src/app/api/comfy/stats/route.ts",
  "src/app/api/comfy/queue/route.ts",
  "src/app/api/comfy/ensure/route.ts",
  /* 系统指标收成单点持有者这一刀带出的三个新出口：轮询内核、在线迟滞本体、
   * 指标 store。同款 **两处同批改**（coverage.include + thresholds）：
   * poll-timer 的未覆盖分支是「既不隐藏也不失焦」那条早退，offline-gate 实测满档，
   * comfy-stats-store 未覆盖的只有 SSR 快照那一份。门槛按实测取不高于现状的档。 */
  "src/lib/poll-timer.ts",
  "src/lib/offline-gate.ts",
  "src/lib/comfy/comfy-stats-store.ts",
  /* 体检清单 ⑦ 第二批 · 并到安全台账 A 系列：这一批的用例是「先写断言、
   * 照出越权、顺手修」，所以门槛登记的是**判据本身**而不是新增行数。
   *   · `custom-nodes/route.ts` —— argv 注入闸门（A6）：POST 那几条出口
   *     已逐分支钉住；GET 侧（manifest / report 读取 + 摘要缓存指纹）
   *     的执行者随台账 E7 收口（本批补的 26 条）；
   *   · `routers/project.ts` —— 归属闸门（A3 + 本批新照出的 upsert 越权写）；
   *   · `routers/task.ts` —— 同一族的归属与越界闸门（A2 快照越权读、
   *     A8 产物目录越界），23 条用例已在跑，此前**从未被门槛判过**；
   *   · `media/output-paths.ts` —— 产物布局的唯一定义（A8 收口点），
   *     它同时被落盘侧与读删侧静态 import，分叉一次就是「删不掉的产物」。
   * 与上面那批同款：**两处同批**登记（`coverage.include` + `thresholds`）。 */
  "src/app/api/custom-nodes/route.ts",
  "src/server/api/routers/project.ts",
  "src/server/api/routers/task.ts",
  "src/lib/media/output-paths.ts",
  /* 体检清单 ⑦ 第三批 · 协议白名单收成一处（台账 A5 复算）：
   *   · `url-scheme.ts` 是「这个地址能不能交给外部程序」的唯一判据，
   *     出口（`comfyEmbeddable` 的两个地址 / `llm.baseUrl` /
   *     `openUrlInBrowser`，以及已随炼丹废弃删除的 `setting.trainerUrl`）
   *     都改吃它 —— 每一支都必须有人判；
   *   · `routers/setting.ts` 第一次有执行者（34 条）。
   * 与下面 `thresholds` **两处同批**登记。`open-in-browser.ts` 不单列：
   * 它已在 `src/lib/shell/**` 这一组里，而没覆盖到的分支只有 darwin/linux
   * 两条平台分叉（本机是 win32，跑不到），单列一条只会把「测不到的那支」写进门槛。 */
  "src/lib/url-scheme.ts",
  /* A13 残留② · 字节范围解析（`Range`）收成一处：产物读取口是视频与大图的
   * **唯一**出口，`Range` 的三种结论（整份 / 一段 / 满足不了）在这里判形状，
   * 端点只翻状态码。满档的理由与 `url-scheme.ts` 同一条：它是四条出口共用的
   * 那一句判据 —— 掉一支不是「那一支没测」，而是某一种请求会被答成另一种错。 */
  "src/server/lib/range-request.ts",
  "src/server/api/routers/setting.ts",
  /* 体检清单 ⑨ 第一刀 · 素材库的归属：
   *   · `media/materials.ts` 是 scope 归属与路径清洗的**唯一判据所在**，
   *     所以它的分支必须被数字盯着；
   *   · 这里原本还登记着 `routers/material.ts`：它与 `api/materials/route.ts`
   *     是同一套判据的两扇门，而界面只走 REST 那扇（`media/materials-client.ts`）
   *     —— 零消费方的那扇随台账 E3′ 删除，判据的覆盖面由 REST 这一门 +
   *     `materials.ts` 本身承担，不减反稳。
   * 两条都按**实测**登记（不是回退）；未覆盖的部分主要是 REST 的 500 兜底与
   * 素材列举里的 stat 失败分支，欠账记在 E7 边上。 */
  "src/lib/media/materials.ts",
  "src/app/api/materials/route.ts",
  /* 体检清单 ⑨ 第五刀 · 产物布局收口（台账 A8 第二段）带出的四个入口：
   *   · `film/compose-steps.ts` —— 本批那条真故障的所在地（`clipPathOf` 不剥
   *     `api/` 段 ⇒ 成片合成每条镜头必败），解析改成吃 `output-paths` 的共用判据；
   *   · `app/api/film/bgm/route.ts` 与 `workshop/media-source.server.ts` ——
   *     改之前的共同点是**零执行者**：改了判据却没有一处执行它，就是「修了 ≠ 记了」
   *     那个老形状（§11.2.1 第二条），所以本批各补一组用例；
   *   · `comfyui/firstframe.ts` —— 同一句地址的另一份解析（它剥了 `api/`，
   *     与上面那份结论相反），换共用判据后需要数字看着。
   * 门槛全部取这批用例的实测下限（见对应阈值块里的留痕）。 */
  "src/server/film/compose-steps.ts",
  "src/app/api/film/bgm/route.ts",
  /* E3‴ 第一条 · 本机代理 ComfyUI 媒体字节的落点（`/api/images`）。
   * 这条口此前**根本不存在**：`comfyImageUrl()` 把地址收成一处（那是对的），
   * 而 handler 在基线迁移时没带过来 —— 于是画布 IMAGE 输入的预览、工作流图片
   * 预览、训练素材缩略图全部按空态吞掉。四项皆满是因为该判的四支各有用例：
   * 会话闸（且一次上游都不碰）、三种形状闸（缺名 / 目录成分 / 类别不在枚举）、
   * 上游 404 与别的状态与连不上三种失败各自一个码、响应头必须 private 且不许
   * immutable。少任何一支都会掉下 100 当场红。 */
  "src/app/api/images/route.ts",
  "src/lib/workshop/media-source.server.ts",
  "src/lib/comfyui/firstframe.ts",
  /* ⑨ 第六刀 · 产物根搬出 `public/`（台账 A13 收官）带出的两个新文件：
   *   · `media/output-layout.ts` —— 布局的**形状**（目录名 / 子层 / URL 前缀 /
   *     给人看的相对落点），浏览器安全（不引 `node:path`），界面与
   *     `output-paths.ts` 都吃它。它必须有门槛：这一层存在的唯一理由就是
   *     「界面向用户说落点时不再抄字面量」，抄回去的话不会有任何别的信号。
   *   · `media/artifact-root-migration.server.ts` —— 一次性搬迁历史盘上文件。
   *     它对错的代价不对称（弄丢用户的图 vs 少搬一项），所以「绝不覆盖」
   *     那条必须有数字看着。 */
  "src/lib/media/output-layout.ts",
  "src/lib/media/artifact-root-migration.server.ts",
  /* 首页「本机算力」卡带出的两个新出口：**两处同批**登记。
   *   · `comfy-resource-metrics.ts` —— 显存/内存口径命名的唯一出处，状态栏与
   *     首页卡都读它；它一旦漂移，两处消费点会同时变红（负向验证实测过），
   *     所以这一层必须有数字看着。
   *   · `LocalComputeCard.tsx` —— 「读不到数的三种情形」是这张卡的全部价值，
   *     分支都在 jsdom 用例里走到位。
   * 门槛取实测（两者单跑皆 100/100/100/100，见各自用例）。 */
  "src/components/studio/comfy-resource-metrics.ts",
  "src/components/studio/LocalComputeCard.tsx",
  /* 体检清单 ⑦ 第四刀 · 产物读取口的归属（台账 A13）：
   *   · `media/output-access.ts` 是「这条产物能不能确定属于别人」的唯一判据。
   *     它按落点命名分三族（素材格 / 画布格走项目行、`films` 走出成片行、
   *     其余走任务行），每族一条查询、每条都有一个「查不到就放行」的保守侧
   *     —— 那个侧写坏了不会报错，只会把自己的图打成 404，所以必须满档判定。
   *   · 同批改的 `api/generated/[...path]/route.ts` 已在上面第一批里（满档），
   *     它的用例新增了「拒绝发生在 readFile 之前」与「Cache-Control 必须是
   *     private」两档 —— 后者是这条闸的实际出口：标 `public` 会让共享缓存
   *     把 A 的产物回给 B，判据写得再对也只剩形式。 */
  "src/lib/media/output-access.ts",
  /* `src/proxy.ts` —— 产物读取口的**接线**本身（台账 A13 的最后一环）。
   * 产物落在 `public/generated/` 下，而 `public/**` 由 Next 按静态文件直接发出、
   * 不经过 route handler —— 只在 route 上加闸门时，把 URL 里的 `api/` 去掉就整条
   * 绕过（本机实测：同一份图，静态形状 200、带闸形状 401）。这一层不进覆盖率面，
   * 「闸有没有真的接到请求上」就没有任何数字会动；而它的失效形态是**零报错**。 */
  "src/proxy.ts",
  /* 首页「模型概览」这一刀的两个新文件（**两处同批**登记）。
   * `hooks/use-model-overview.ts` 刻意不登记：它只是把 tRPC 的一行结果转交给
   * `deriveModelOverview`，判断力全在那个纯函数里 —— 给一行接线设门槛，
   * 数字看着严格，实际什么都不守。 */
  "src/components/studio/model-overview-derive.ts",
  "src/components/studio/HomeModelOverview.tsx",
  /* 视图页签 刀2 的页签条（**两处同批**登记）。两个薄 hook
   * （`use-workspace-tabs.ts` / `use-title-bar-tabs-active.ts`）刻意不登记：
   * 规则与判据分别已在 `workspace-tabs.ts` 与壳的 derive 层有主，
   * 给接线设门槛等于替别人记账。 */
  "src/components/studio/ViewTabStrip.tsx",
  /* 体检清单 ⑨ 的零执行者 router（台账 E3 从 7/16 抬到 11/16）：`film` /
   * `model` / `llm` —— 原来那一批里的 `train` 已随功能废弃、文件不在仓库里了，
   * 这条清单里的路径必须都能落到真实文件（`tests/coverage-targets-exist.test.ts`
   * 判），留着指已删模块的条目等于一扇没人判的门。
   * 这一批照出的不是「闸门弱」而是**「闸门 procedure 自己就是死的」**：
   * 第三参在数据层迁移期是 `select?: unknown` + `select as never`，调用点写成旧
   * 工具链的布尔投影 `{ id: true, status: true }` 时编译器一声不响、运行时生成
   * 空投影 → SQL 语法错，于是「取消」这类动作自那次迁移起每次 500 —— 路由没有
   * 执行者，所以没有任何一条红。三条全按实测满档登记（用例把归属、数值/协议/
   * 枚举闸与「拒绝发生在副作用之前」逐分支钉住），掉一支当场变红。 */
  "src/server/api/routers/film.ts",
  "src/server/api/routers/model.ts",
  "src/server/api/routers/llm.ts",
  /* 工坊「镜头胶片带」这一刀的两个新文件（**两处同批**登记）。
   * 状态表是从 `ShotStudio.tsx` 搬过来的：胶片带要用同一份文案，而胶片带会被
   * `ShotStudio` import —— 反向去 ShotStudio 取就是一组循环依赖（`check-circular-deps`
   * 的判据）。搬出来正好补上这份表此前没有的门槛。 */
  "src/components/workshop/shot-status-config.ts",
  "src/components/workshop/ShotFilmStrip.tsx",
  /* 体检清单 ⑨ 第三刀 · 错误信封（台账 E8）带出的三个 router：
   *   · `skill.ts` / `workflow-model.ts` 是「零执行者 router」清单里的两个，
   *     这一刀各给一套用例（重名的 CONFLICT、越权重名的 NOT_FOUND、
   *     幂等早退不该抛错 —— 三个码各不相同才是可分支的界面）；
   *   · `generate.ts` 是因为本刀把它的两处裸 Error 改成 4xx 才进面（改了就要有数字看着）。
   * 数值取**这批用例实测**（`run.ts` 没进来：它的分支大头在别线的工坊编排里，
   * 这一刀的改动只到错误信封，按 85/75 立个门槛等于替别人记账）。 */
  "src/server/api/routers/skill.ts",
  "src/server/api/routers/workflow-model.ts",
  "src/server/api/routers/generate.ts",
  /* 体检清单 ⑨ 第四刀 · E3 收口（台账 E3）带出的一个 router：
   * `workflow-detail.ts` 是 `workflow` 这个聚合 router 拆出去的三个兄弟文件之一，
   * 它的 `detailFull` / `subgraph` 此前**零执行者** —— 而 `workflow.test.ts` 34 条
   * 用例在场，「这个 router 有测试」这句话当时照样全绿（这正是判据升到 procedure
   * 粒度的原因）。同族的另外几个文件（`workflow-list.ts` / `workflow-mutations.ts` /
   * `workflow-local-roots.ts`）不在这一刀的范围：它们的用例早就在场，缺的是门槛登记，
   * 那是 E7 覆盖率欠账的账，不是本批改动的账（口径同上面那句 `run.ts`）。 */
  "src/server/api/routers/workflow-detail.ts",
  /* 视图页签 刀1 的状态模型（**两处同批**登记）。它是纯函数、判断力全在这里
   * （页签身份、开/关/回落、序列化的"整份可用否则整份放弃"），组件侧只是接线。 */
  "src/components/studio/workspace-tabs.ts",
  /* 设置页「实例目录（只读）」这一刀的两个新出口（**两处同批**登记）。
   *   · `comfyui-storage-paths-config` 是六组目录的展示口径（顺序 / 空组 /
   *     覆盖来源），纯函数、无 React；
   *   · `ComfyuiStoragePaths.tsx` 是它的纯展示消费者（分支都在 jsdom
   *     用例里：null 不渲染、斜杠统一、来源与「目录不存在」标注）。
   * ⚠️ 两处都**不在** `src/lib/**` / `src/components/ui/**` 的通配里，
   * 只写门槛不进 `include` 会让门槛静默失效（`ui/file-picker.tsx` 的前车之鉴）。
   * ⚠️ 路由组名 `(main)` 里的括号是 glob 分组语法，必须转义 —— 写成字面量
   * 时条目**静默不匹配**（同 `\\[...path\\]` 那条动态段）。 */
  String.raw`src/app/\(main\)/settings/comfyui-storage-paths-config.ts`,
  String.raw`src/app/\(main\)/settings/components/ComfyuiStoragePaths.tsx`,
  /* 台账 E9 这一刀（自定义节点注册表的灌入链）带出的四个出口，**两处同批**
   * 登记（`coverage.include` + `thresholds`）——只写门槛不进 `include` 会让
   * 门槛静默失效（本仓已经栽过一次：`ui/file-picker.tsx`）。
   *   · `custom-nodes-manifest.server.ts` 是清单「路径 + 指纹 + 三相读法」的
   *     唯一定义，`src/lib/**` 的通配本来就在面上，这里单列是为了给它立门槛；
   *   · `api/custom-nodes/manifest/route.ts` 是浏览器侧**唯一**的灌入源，
   *     它在基线迁移时被删掉而没人红 —— 这一层整此前不在覆盖率面上；
   *   · `src/config/custom-nodes.ts` 与画布那侧的订阅 hook 同理：一个只有
   *     `console.warn` 的空广播，判据看不见数字就不会动。 */
  "src/lib/comfyui/custom-nodes-manifest.server.ts",
  "src/app/api/custom-nodes/manifest/route.ts",
  "src/config/custom-nodes.ts",
  "src/components/studio/canvas/use-custom-nodes-registry.ts",
  /* 台账 F13″ 这一刀的两个新出口（草稿元素级判据 + 它的界面出口），**两处同批**
   * 登记（`coverage.include` + `thresholds`）——只写门槛不进 `include` 会让门槛
   * 静默失效（本仓已经栽过两次：`ui/file-picker.tsx`、上面那批自定义节点出口）。
   *   · `draft-integrity.ts` 是「哪些元素形状不认识」的唯一判据，服务端镜像与
   *     浏览器缓存两扇门共用一份；漏判一个字段就是「脏数据照样喂进 prompt 拼装」；
   *   · `DraftIntegrityHint.tsx` 是它唯一的用户可见出口（硬规则 4）。判据算得再准，
   *     出口没接上就等于「保留原样但没人知道」。 */
  "src/lib/workshop/draft-integrity.ts",
  "src/components/workshop/DraftIntegrityHint.tsx",
  /* 外观偏好（圆角 / 标题字阶）的令牌应用点与持久化形状。
   * 「默认档必须与引入前逐像素相同」这条判据就靠它有数字看着。 */
  "src/lib/appearance.ts",
  /* 项目内视图的统一容器（**两处同批**登记）。收口后「外层滚动 + 居中列 +
   * 宽度档位」这套形状只有这一处，八个视图都只是调用 —— 值得单独有数字看着。 */
  "src/components/studio/ViewContainer.tsx",
  /* 壳内应用级页签容器（**两处同批**登记）。它承载 ISSUE #1244 那两条契约：
   * 可嵌 → 页签里渲染 iframe；不可嵌 → 同一个页签里给可读说明。此前这两条
   * **没有任何自动化看守**（浏览器形态里它不画应用内页签栏，e2e 量不到），
   * 于是「塞了一个注定空白的 iframe」或「说明没人渲染」都不会变红。
   * ⚠️ 不在 `src/lib/**` / `src/components/ui/**` 的通配里，只写门槛不进 `include`
   * 会让门槛静默失效（`ui/file-picker.tsx` 的前车之鉴）。 */
  "src/components/studio/ShellTabs.tsx",
];

/** 与 include 配套的排除项（保持原位语义：测试文件本身不计入分母）。 */
export const COVERAGE_EXCLUDE = ["src/lib/**/*.test.ts"];
