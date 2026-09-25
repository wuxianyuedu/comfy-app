## Fixed

- **步骤日志的去重是全量扫描、且单行日志数组无上限（`src/components/studio/project-canvas/stepLogCache.ts`）**：
  `appendStepLog` 用 `prev.logs.some(...)` 判重 —— 每条新日志都把整组扫一遍，一个几百行的
  任务整体是 O(n²)；而 `logs` 数组本身也没有行数上限（只有「任务条目数」的 LRU）。
  现在判重只看尾部 64 条（日志按时间追加，重复的那条必定紧跟在它自己之后），
  并给单个任务的日志行设了 2000 行上限（面板本来就只显示尾部 300 行）。
