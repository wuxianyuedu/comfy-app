# CanvasNode 代码审查归档(2026-08-30)

> 对象:`src/components/studio/project-canvas/CanvasNode/CanvasNode.tsx`(拆分后主组件,~1260 行)。
> 外部审查意见 6+2 条,本文逐条给出核实结论与处置。**结论先行:6 条中 2 条驳回
> (与 React 官方语义相悖),2 条采纳落地,1 条部分采纳,1 条归入路线图。**

## 逐条判定

| # | 审查主张 | 核实结论 | 处置 |
|---|---------|---------|------|
| 1 | render 里 setState 的"React 19 pattern"有隐患,应改 useEffect | **驳回。** 两处实例(L74/L144)均带 prev 守卫,是 react.dev《You Might Not Need an Effect》明确推荐的"prop 变化时调整状态"模式:render 阶段 setState 会**丢弃当前渲染并立即重渲**,不产生额外 DOM 提交;审查所称"每帧多一次 re-render"不成立(status 不变时 if 守卫直接短路)。反倒是审查建议的 `useEffect` 方案会造成"错误面板展开态晚一帧收起"的可见闪烁——官方文档正是以这一点作为反例推荐 render 方案。| **保留原样**;在 02-性能规范 §2.4 补充说明防止未来误改 |
| 2 | runGenerate 巨闭包每 render 重建,应 useCallback | **部分成立但不值得做。** 函数引用确实每次重建,但其闭包依赖(`d`、`wfIO`、`seededFor`…)每次 patch 都变,useCallback 的依赖数组同样每次失效——引用稳定性在不把数据流迁入 store 前无法达成。且消费方 `ImageGenerationPanel`/`ContentAssetBody` 未 memo,父渲染时它们本就重渲。| **归入路线图**(store 化后才有意义),见下 |
| 3 | patch 每次 render 都是新的,应 useCallback | **采纳。** 零风险纯稳定化:`useCallback([id, setNodes])`,ReactFlow setter 恒定,选中态切换等无关重渲染时 patch 引用稳定。| ✅ 已落地 |
| 4 | wfList/modelTagLib 每节点各自拉取,20 节点 = 40 次相同请求 | **采纳,是最实质的性能问题。** 已改为模块级 in-flight 去重:并发挂载共享同一 Promise(2 次请求),**刻意不做 TTL 缓存**——新建工作流后,后挂载节点必须看到最新列表,TTL 会把变更挡在过期数据外。| ✅ 已落地 |
| 5 | as 断言泛滥(`as unknown as`/`as never`) | **成立,归入路线图。** 根因是 `CanvasNodeData` 索引签名过宽 + 后端字段结构与前端类型有缝;收窄需要动 `canvas-types.ts` 并梳理后端契约,超出本次行为保持式清理的范围。| ✅ 已落地(ISSUE #320):拆 `StrictCanvasNodeData` + ReactFlow 兼容类型 + `asCanvasNodeData()` 收口;画布链路断言清零,两处 Prisma Json 边界改 Zod 校验 |
| 6 | errorSuggestion IIFE 每 render 跑正则,应 useMemo | **采纳(低成本)。** progress 高频更新期间同一 `d.error` 会反复跑 5 组正则;`useMemo([d.error])` 消除。| ✅ 已落地 |
| 7 | reconcile effect 在 taskId 变化时不会取消前一个请求,可能双 patch | **驳回。** `cancelled` 标志的清理函数在**任何依赖变化时**都会先执行(React effect 语义),in-flight 回调被 `if (cancelled) return` 双重守卫(await 前后各一次),结果必被丢弃。网络请求本身未 abort 但无副作用。| 保留原样 |

## 已落地修改(本次提交)

1. `patch` → `useCallback([id, setNodes])`(问题 3)。
2. `errorSuggestion` → `useMemo([d.error])`(问题 6)。
3. wfList/modelTagLib 模块级 in-flight 去重(问题 4):`sharedListsInflight` +
   `WfListItem`/`TagLibItem` 类型上提;注意实现细节——in-flight 的清理
   (`finally` 置空)必须挂在**派生链**上,直接对存储引用 `.then` 会把它
   void 化,导致晚到的订阅者拿不到数据。

## 路线图(记录在案,未做)

- `runGenerate`/`patch`/`wfIO` 迁入组件级作用域 store(同 `workflow-stores.tsx`
  的 createStore 工厂模式),届时 runGenerate 才能获得真正稳定的引用;
- ~~`canvas-types.ts` 收窄 `CanvasNodeData` 索引签名,消除 `as unknown as` 双断言~~ ✅ ISSUE #320;
- `errorSuggestion` 的正则规则表外置为数据(便于新增错误形态)。

## 二、注册表方案(Strategy/Registry)评审(同日追加)

外部第二份方案:CanvasNodeTypeDef 接口 + NODE_REGISTRY + node-defs/\*.ts +
primitives/ 语义化壳(Node.Root/Header 命名空间)+ 60 行薄壳主组件。

**判定:方向正统(Radix/Headless 确为此模式),但与本项目领域模型存在两处硬
冲突,现在不全盘采纳;触发式增量采纳。**

| 提案要点 | 判定 | 依据 |
|---|---|---|
| 扩展 NODE_META → CanvasNodeTypeDef(category/isRunnable/Body 映射) | ✅ 触发式采纳 | 注册表已存在 70%:`canvas-types.ts:246 NODE_META`(Record<NodeKind,{label,icon,color,desc,typeChar}>);缺 category/Body 映射 |
| 声明式静态端口 `inputs?: NodePortDef[]`,框架自动渲染 Handle | ❌ 永久拒绝 | 本画布端口是**节点实例状态**的函数:OutputRowPort 由 `wfIO`(绑定工作流的运行时 IO 映射)驱动,绑定工作流 A/B 端口数不同;折叠态另有圆柱锚点几何。静态 per-kind def 无法表达——要表达就得把 def 变成 (node)=>PortDef[] 函数,等于把组件逻辑搬进注册表,负迁移 |
| `run: (ctx) => Promise` 进 def | ⏸ 条件采纳 | 生成流程跨 kind 共享 poll/对账/错误上下文机制(use-generate 已是共享引擎);现在按 kind 拆 run = 复制引擎,零收益。先有引擎,def.run 才是薄封装 |
| Node.Root/Header 命名空间原语 | ⏸ 低优先级 | CanvasNodePrimitives.tsx 已集中壳组件;命名空间化是纯风格收益 |
| "600 行 → 60 行" | ❌ 误估 | 复杂度守恒:薄壳把体量转移进 node-defs 与 Body;收益是组织性,不是行数 |
| "未用节点可 tree-shake" | ❌ 不成立 | 运行时 Record 查表,属性引用齐全,bundler 摇不掉对象属性 |

### "加新节点"的真实成本基线(今天)

7 个文件的声明式触点:kind 联合(canvas-types)、NODE_META、defaultData、
CanvasContextMenu、use-canvas-drop、ResultCard、canvas-render-chain——多为
小型声明,不是方案暗示的"5-6 处 if/else 逻辑"。触发热后按 ✅ 项收编,可降至 ~4。

### 触发条件与执行顺序

下次需要新增节点 kind(如 audio/3D)时:

1. 先把 NODE_META 扩成 CanvasNodeTypeDef(新 kind 按 def 文件写,旧 kind 顺手迁);
2. CanvasContextMenu/use-canvas-drop 改读注册表(7 触点 → ~4);
3. Body 逐 kind 抽出(新 kind 直接按 Body 写);**端口渲染保持 wfIO 驱动,不进 def**;
4. def.run 仅作共享引擎(use-generate)的薄封装。

## 三、origin/dev 合并评审(同日)

3 个提交(工作流库左右分栏重构/剧本 Markdown 编辑器/PyInstaller 启动器),+3122/−1443。

- **合规信号**:新文件命名全合规(Pascal 组件/kebab 模块/scripts py);any/disable 仅 1 处、console 1 处。
- **冲突**:workflow.ts 单文件 16 处(我方 lint 修复 vs dev 重构)——按 dev 重构版解决,门禁复检补质量。
- **发现并修复**:dev 带入 2 个新的文件级 no-explicit-any 头(workflow-preview.ts 22 处/workflow.ts 85 处),已按战役标准类型化清零(107→0)。
- console.warn 在客户端错误路径可接受(喂 LogPanel 捕获)。
- dev 新模块(workflow-preview 331 行/ScriptMarkdownEditor 539 行)暂无测试,列入覆盖爬坡。
