## Changed

- 按形态扫描又清出三件事的重复实现，各收成一处（ISSUE #672，规范 16
  §16.2.4.36 ~ §16.2.4.38），三条新判据 **P33 / P34 / P35** 一上来就是硬闸：
  - **「给一条新记录分配 id」**（6 处 → 0）：新增 `~/lib/unique-id` 的
    `nextId` / `uniqueStamp` / `randomToken`。收口前六处各写一遍
    「时间戳 + 序号」，分三派 —— 计数器**取模回绕**
    （`(entryId + 1) % 1_000_000`：转一圈之后同一毫秒的两条会拿到同一个 id，
    日志按 id 去重会把新的那条当成旧的丢掉、消息中心「删一条把另一条一起删了」）、
    随机后缀（`.slice(2, 6)` 与 `.slice(2, 7)` 两处长度都不同）、
    裸 `Date.now()` 毫秒数（与 36 进制**字典序不可比**，于是「按 id 排序」
    在一半落点成立、另一半不成立）。出口的序号**不回绕**，
    序号**每前缀一套**，时刻由调用处注入（同一批导入共享一个时刻）。
    另清掉一处**连线 id**（`e_${source}-${target}-${Date.now()}` ——
    同一毫秒连两条同样的线会撞 id，而 React Flow 以 id 为键做边的增删改）。
  - **「ComfyUI 报错 → 可行动建议」**（2 份词表 → 1 处）：新增
    `~/lib/comfyui/error-advice` 的 `adviseOnError` / `adviseWithFallback` /
    `shouldAutoExpandError`（原 `CanvasNode/error-suggestions.ts` 删除）。
    收口前任务历史卡与画布节点错误面板**各写一份正则表**：同一句
    `out of memory` 在两处给出不同建议，而且**告警词表互相漏项** ——
    「队列满了」在画布节点上根本没有建议，「服务忙」在历史卡上也没有。
    出口**未识别时给 `null`、不编造建议**；只有「界面上那一行位置固定」的落点
    （历史卡）才用 `adviseWithFallback`。
  - **「把新节点放进画布」**（4 处 → 0）：新增
    `~/lib/project-canvas/canvas-helpers` 的 `placeCanvasNode`（四步一次给全：
    取落点 → 换算 → 组节点 → 追加；缺省落点走 `viewportCenter()`，
    坐标已在画布坐标系里时走 `flowPosition`）。
    第四条落点（工作流跑完**自动孵化下游节点**）是 P35 判据自己抓出来的 ——
    人工梳理时只找到三处，判据写完 pre-commit 当场报出。它的落点是
    「源节点右侧 340px」，因此出口多出 `flowPosition` 与显式 `id` 两支。
    收口前右键菜单两个入口与媒体拖放 / 「加入画布」按钮各写一遍，
    **视口中心**那句在两处逐字相同、第三处用容器尺寸；而 `use-canvas-drop`
    的注释还把 `screenToFlowPosition` 的入参含义**写反了**（注释说 client
    坐标、代码传的是 flow 坐标）—— 收口后那段注释连同三份「四步」一起消失。
- `check-ui-primitives.cjs` 新增三条硬闸判据（P33 / P34 / P35），
  `HOOKS_ALSO_SCANNED` 补上三条（P33 的存量里有 2 处在 hooks）。
  判据的三条边界都是实测踩出来的：P33 不能只数模板串里的 `Date.now()`
  （SSE 心跳与超时截止会被算上，要求同串另有 id 语义线索）、
  P34 不能只数「建议」二字（「读过原文并原样展示」是对的写法）、
  P35 不能用花括号配对取块（节点对象里必然嵌套 `position: { x, y }`，
  非嵌套匹配会整片漏掉 —— 本轮自己的反面用例先挂了才发现）。
- 两个新出口同批进 `vitest.config.ts` 的 `coverage.include` + `thresholds`
  （门槛按实测值给：两个模块都是 100/100/100/100）。
- `tests/ui-primitives-coverage.test.ts` 补上上一批遗漏的三条出口
  （`use-item-errors` / `stale-run` / `api-error`）—— 那三条当时只补了脚本侧的
  判据与用例，**没补「出口真被用着」这一侧**，窗口期内「抽出出口但没人用」
  没有任何判据；同时把该文件里「文件头必须引用 §16.2.4.x」的正则从
  `16~29` 放宽为任意编号（收窄会让新一批合法引用被判「没说明」）。
