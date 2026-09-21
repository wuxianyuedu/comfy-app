## Changed

- **「同一个动作有几份实现」第十七批（ISSUE #672）**：三条按**形态**扫出来的
  账各收成一处实现，三条判据（P62/P63/P64）一上来就是**硬闸**。
  - **「把一组 props 转成另一个键的 props」**（42 处）→ `~/lib/form-props`：
    `textHandler` / `checkedHandler` / `numberHandler` / `bindKey` /
    `readTextInput` / `digitsOnly`。差别不在「怎么写这一行」，而在
    **取哪个字段**（`value` vs `checked`）、**转换放在哪**（过滤规则散在视图里）、
    以及**键名靠人眼对齐**（写错一个字符就静默写到另一个字段上）。
    写实现时被自己的用例抓出一处语义：`Number("")` 是 **`0`** 不是 `NaN`，
    不判空串就等于「清空输入框 = 设为 0」。
  - **「给一个列表做分页 / 窗口切片」**（三种方向相反的窗口）→
    `~/lib/page-window`：`tailPages` / `countAfterPage` / `tailWindow` /
    `chunkRange`。边界处理此前各异且全是静默的（空列表让 `end` 变负、
    页码越界不钳回、`pageSize` 为 0 给出 `Infinity` 页）；两处逐字相同的
    `slice(-300)` 里那个 `300` 谁都没说为什么是 300。
    实测还踩到一处：`Number.isFinite(x) ? … : 默认` 会把 `Infinity` 一起归成
    第 0 块，而它是「明确越界」不是「算不出来」。
  - **「把一次进度回调节流后写进 state」**（6 处）→
    `~/components/ui/use-throttled-progress`：`useThrottledProgress`（单值）/
    `useThrottledProgressMap`（按条目）/ `createThrottleGate`（只借闸门）。
    `watchTask` 的 `onProgress` 是**高频**回调（SSE 每帧一次），
    六处**没有一处节流**、没有一处同值短路、也没有一处带卸载守卫。
  - 判据侧：三条都按**形态**取锚点，每条都配反面用例。用 `git archive master`
    逐落点回放过（P62 命中 37 / P63 命中 9 / P64 命中 8），改后均为
    **0 处 / 0 文件**；`P63` 的 `.slice(-N)` 刻意要求**接收者像集合**
    （`id.slice(-4)` 是取短码，不是尾部窗口）。
  - 三个出口同批登记 `DOMAIN_EXEMPT`、`coverage.include` 与 `thresholds`
    （门槛按实测值：三者均 100%），并在
    `tests/ui-primitives-coverage.test.ts` 从**另一侧**钉住「出口真被用着」。
