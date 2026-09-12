<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/guides/PRODUCTION-GAPS.md`。改动请回源文件，再重新生成。 -->

# 生产级缺口清单(Production Gaps)

> 2026-08-30 全库审查(结构/类型/测试/安全/规范)沉淀的未竟事项。
> 每项含优先级与建议路径。完成一项划掉一项。
>
> **巡检约定**：本清单每季度按 [docs/README.md §7](../../README.md) 的季度巡检流程逐条复核，
> 已完成项勾掉、过时项改写成现状或删除、仍开放项保留并指向承接它的 Issue。
> 上次巡检：2026-09-10（逐条复核，差异表见巡检记录）。

## P0 — 安全/正确性

- ~~`task.cancel` 越权(任意用户可取消他人任务)~~ **已修复**(08669df,含回归测试)。
- ~~`scripts/parse_custom_nodes.py` 与 `src/generated/` 不在仓库~~ **已解决**:
  - 解析器本身在仓库:`scripts/parse_custom_nodes.py`(`git ls-files` 可见);
  - `src/generated/` 是**构建产物**(`.gitignore:82` 明确忽略),由构建期生成,
    不需要入库——原条目把「产物不入库」误判成缺口。custom-nodes 路由的
    spawn 路径与优雅降级保留现状。
- ~~LLM `provider` 字段:garbage 值静默回退 local 并覆盖 DB 的 remote 配置~~
  **已解决**(ISSUE #309 P0 批次):`src/server/api/routers/llm.ts:34,75` 收紧为
  `z.enum(["local", "remote"])`,垃圾值在校验层被拒;历史遗留的默认值由
  `schema.ts` 的 `provider` 列默认 `"local"` 承接,不再有静默改写。

## P1 — 测试覆盖爬坡(商业级下限)

- [x] ReactFlow Provider 包装方案落地(tests/helpers/react-flow.tsx)+
      CanvasNode/FlowNode 渲染冒烟与折叠交互(7 用例)。表单/生成链路的深度
      行为测试(fetch/poll 生命周期)仍开放。
- [x] `CustomNodesSettings` 主组件拆分后行为测试:组件已按四层范式拆为容器 73 +
      视图 379 + hook 503 + 纯函数模块,并补齐逻辑层行为测试
      (`hooks/use-custom-nodes-settings.test.ts`,17 用例:失败路径必须有可见出口、
      打开才请求、解析收尾时序、派生分组计数)。
- [x] Playwright 框架 + 冒烟 E2E(`e2e/smoke.spec.ts`:login 渲染/Tab 切换、
      `/` 重定向 workspace)与核心链路 E2E(`e2e/critical-flows.spec.ts`,
      进 `@critical` 门禁)。命令:`pnpm test:e2e`(原记录写作 npm 形式,
      违反 AGENTS 硬规则 1「包管理只用 pnpm」,已于 2026-09-10 巡检修正)。
- [x] 覆盖率棘轮抬升:`src/lib/comfyui/**` 两批模块相继入榜,判断规则与
      调度判决被逐条断言:
      - `lifecycle.ts` 的判决表抽到纯函数模块 `lifecycle-derive.ts`(90% 硬门槛),
        `lifecycle.ts` 本体按实测值设门槛(45/60/45 + 分支 30);
      - 两条 sweeper(`reaper.ts` 70/60)与调度器(`executor-scheduler.ts` 70/50)
        的判决矩阵测试落地后按实测值设门槛。
      新增 `comfyui/**` 模块的测试后,按同样方式把各自门槛加进 §11.7 棘轮表。

## P2 — 架构路线图(见 reviews/2026-08-30-canvasnode-review.md)

- [x] `canvas-types.ts` 收窄 `CanvasNodeData` 索引签名(ISSUE #320):拆成
      `StrictCanvasNodeData`(业务代码用,拼错字段名编译报错) +
      `CanvasNodeData = Strict & Record<string, unknown>`(仅 ReactFlow 类型参数
      位置)+ `asCanvasNodeData()` 单点收口;画布链路 `as unknown as` / `as never`
      清零;两处 Prisma Json 边界改为 Zod 校验。
- [x] `errorSuggestion` 正则规则表外置为数据(**已过时项,已改判为完成**)。
      规则表**已外置**到数据模块
      `src/components/studio/project-canvas/CanvasNode/error-suggestions.ts`
      (`ERROR_SUGGESTION_RULES` 数组 + `pattern` / `suggestion` 数据项),
      `ErrorPanel.tsx` 只消费 `suggestForError()`。原条目按「未做」记录,
      复核后改判为已完成。
- [ ] 注册表触发式采纳(仍开放):下次新增节点 kind 时按
      reviews/2026-08-30-canvasnode-review.md 第二节执行顺序走。
      **性质**:流程性约定(触发条件是「下次新增节点 kind」),无完成态,
      长期保留作为执行提醒;不需要新开 Issue 承接。

## P3 — 卫生/规范执行

- [x] 文件级 `no-explicit-any` 头 59 → 0(895f99c 等)。
- [x] 未使用/单规则可修的 eslint-disable 头清理(5355a2b)。
- [x] lint warning 清零:全库 `eslint . --max-warnings 0` 退出码 0(零错误
      零警告)。**本地 pre-commit 此前只判「无 error」而 CI 判零警告,口径不一致
      ——warning 能在本地进历史、到 CI 才被拦下(复核返工)。**已把 pre-commit
      对齐为零警告口径(ISSUE #322);剩余行内 disable 全部带可核验理由
      (exhaustive-deps 按三分类法逐条判定,prefer-nullish 属「伪建议」类:
      空串在服务端反序列化产物里表示「没有值」,`??` 会改语义)。
- [x] `CustomNodesSettings` 主组件进一步拆分(见 P1 对应条目,容器 73 行)。
- [x] `DynamicWorkflowForm` 已拆为四层(容器 44 + 视图 249 + hook 261 + 纯函数
      105),并补齐逻辑层行为测试(30 用例:行归属、多模式可见性、拖拽重排、
      图片上传、默认值刷新口径,见 ISSUE #319)。`CustomNodesSettings` 同批拆分
      与测试见 ISSUE #318。
- [x] `components/model/model-library.tsx` 与 `studio/ModelLibrary.tsx`
      语义撞车的处置(原条目「确认两者职责或合并」)。
      **结论:确认职责,不合并**——两者服务不同路由、各自独立握手:
      - `components/model/ModelLibrary.tsx` 服务 `/models` 独立页
        (`app/(main)/models/page.tsx` 唯一消费方),面向「模型卡片库」浏览;
      - `components/studio/ModelLibrary.tsx` 服务 `/workspace` 工作室内页签
        (`app/workspace/page.tsx` 经 `studio/index.ts` 动态导入),面向
        「本机 ComfyUI 可用模型按扫描目录分类」。
      两者已各自按规范 §17 四层范式拆分,逻辑分别落在各自的
      `hooks/use-model-library.ts`,消费方互不交叉,无需合并。
      治理记录见 `docs/standards/17-UI与逻辑分离.md` §17.6.2。

## 规范状态

已固化:12(结构/命名/卫生/防线)、13.5(本地提交门禁)、03 §3.1(v4 规范
类名)、TESTING.md(分层策略/覆盖率棘轮)、reviews/(两轮审查归档)。
待补:无——新缺口按上表滚动进入对应章节。
