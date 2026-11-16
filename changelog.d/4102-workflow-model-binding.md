## Changed

- **工作流库：模型标签绑定唯一性 + 标签库按模式计数**（ISSUE #4102）。
  ① 一条工作流只绑**一个**模型标签（绑定弹窗由多选改单选）；同一
  「标签 × 模式」只能被一条工作流占用 —— 服务端在 `workflow.update` 里按
  「该工作流生效模式 × 标签已被谁占用」拦截（CONFLICT，报错点名占用的工作流），
  同标签、模式不相交的多条工作流互不冲突，换绑 / 清空排除自身。
  ② 模型标签库界面每个标签显示「N 个模式」与逐模式胶囊（不再显示
  「N 个工作流」），悬停胶囊显示占用它的工作流名与本地 / 在线来源；
  `workflowModelTagRepository.listByUser` 随附每标签的模式占用明细，
  新增 `listBindingsByTagName` 供冲突校验。
  ③ 工坊封装页签的「X/Y 个对外口已落到端口」改为「已落点 X/Y 个契约口」
  并附悬停说明（分母 = 该模式契约口总数，含可选与自定义口）。
  回归：`workflow.test.ts` 唯一性四格、`repository.test.ts` 模式明细两格、
  `MetaEditor.test.tsx` 单选 / 冲突就地展示、`ModelTagManager.test.tsx`
  模式计数与悬停明细。
