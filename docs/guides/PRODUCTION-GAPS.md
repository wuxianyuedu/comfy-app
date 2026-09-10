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
- [ ] `CustomNodesSettings` 主组件(1116 行)拆分后行为测试。
- [x] Playwright 框架 + 冒烟 E2E(e2e/smoke.spec.ts:login 渲染/Tab 切换、/ 重定向 workspace;`npm run test:e2e`)。
- [x] 覆盖率棘轮抬升:`src/lib/comfyui/**` 首批入榜——`lifecycle.ts` 的判决表
      抽到纯函数模块 `lifecycle-derive.ts`(90% 硬门槛),`lifecycle.ts` 本体按
      实测值设门槛(45/60/45 + 分支 30)。executor 家族与 reaper 的契约测试见
      ISSUE #315 承接,补齐后继续上调。

## P2 — 架构路线图(见 reviews/2026-08-30-canvasnode-review.md)

- [ ] `canvas-types.ts` 收窄 `CanvasNodeData` 索引签名,消除 `as unknown as`
      双断言与 `as never`(类型化战役已把 any 清零,这是最后一步)。
- [ ] `errorSuggestion` 正则规则表外置为数据。
- [ ] 注册表触发式采纳:下次新增节点 kind 时按
      reviews/2026-08-30-canvasnode-review.md 第二节执行顺序走。

## P3 — 卫生/规范执行

- [x] 文件级 `no-explicit-any` 头 59 → 0(895f99c 等)。
- [x] 未使用/单规则可修的 eslint-disable 头清理(5355a2b)。
- [ ] 34 个 lint warning 清零(alt-text/no-img-element/exhaustive-deps/
      unused-vars;exhaustive-deps 已有三分类文档,按类处置)。
- [ ] `DynamicWorkflowForm`(958)与 `CustomNodesSettings` 主组件(1116)
      进一步拆分(结构性提醒由 pre-commit 持续输出)。
- [ ] `components/model/model-library.tsx` 与 `studio/ModelLibrary.tsx`
      语义撞车——确认两者职责或合并。

## 规范状态

已固化:12(结构/命名/卫生/防线)、13.5(本地提交门禁)、03 §3.1(v4 规范
类名)、TESTING.md(分层策略/覆盖率棘轮)、reviews/(两轮审查归档)。
待补:无——新缺口按上表滚动进入对应章节。
