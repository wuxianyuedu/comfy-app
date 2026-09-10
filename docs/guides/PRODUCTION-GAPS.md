# 生产级缺口清单(Production Gaps)

> 2026-08-30 全库审查(结构/类型/测试/安全/规范)沉淀的未竟事项。
> 每项含优先级与建议路径。完成一项划掉一项。

## P0 — 安全/正确性

- ~~`task.cancel` 越权(任意用户可取消他人任务)~~ **已修复**(08669df,含回归测试)。
- `scripts/parse_custom_nodes.py` 与 `src/generated/` 不在仓库:custom-nodes 路由
  spawn 的解析器必然失败(优雅降级为空)。要么把脚本与产物纳入仓库/构建,要么
  移除该降级路径并改用纯 TS 解析。
- LLM `provider` 字段:garbage 值会静默回退 local 并覆盖 DB 的 remote 配置。
  需要产品决策:收成 enum(行为变化)+ 迁移存量数据。

## P1 — 测试覆盖爬坡(商业级下限)

- [x] ReactFlow Provider 包装方案落地(tests/helpers/react-flow.tsx)+
      CanvasNode/FlowNode 渲染冒烟与折叠交互(7 用例)。表单/生成链路的深度
      行为测试(fetch/poll 生命周期)仍开放。
- [x] `CustomNodesSettings` 主组件拆分后行为测试:组件已按四层范式拆为容器 73 +
      视图 379 + hook 503 + 纯函数模块,并补齐逻辑层行为测试
      (`hooks/use-custom-nodes-settings.test.ts`,17 用例:失败路径必须有可见出口、
      打开才请求、解析收尾时序、派生分组计数)。
- [x] Playwright 框架 + 冒烟 E2E(e2e/smoke.spec.ts:login 渲染/Tab 切换、/ 重定向 workspace;`npm run test:e2e`)。
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
- [ ] `errorSuggestion` 正则规则表外置为数据。
- [ ] 注册表触发式采纳:下次新增节点 kind 时按
      reviews/2026-08-30-canvasnode-review.md 第二节执行顺序走。

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
- [ ] `components/model/model-library.tsx` 与 `studio/ModelLibrary.tsx`
      语义撞车——确认两者职责或合并。

## 规范状态

已固化:12(结构/命名/卫生/防线)、13.5(本地提交门禁)、03 §3.1(v4 规范
类名)、TESTING.md(分层策略/覆盖率棘轮)、reviews/(两轮审查归档)。
待补:无——新缺口按上表滚动进入对应章节。
