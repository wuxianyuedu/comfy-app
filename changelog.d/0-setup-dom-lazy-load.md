## Changed

- **`tests/setup.ts` 不再对每一份用例都载 DOM 测试栈**（jest-dom 匹配器 +
  `@testing-library/react` 的自动卸载 + jsdom 缺口处置器挪进 `tests/setup.dom.ts`，
  按「那一刻有没有 `document`」条件加载）。这是「每日全量那一跑只有一半时间在跑断言」
  这条账上的第一刀，动的是**每一份文件的固定装载**而不是任何一条用例。
- 读数（同一份配置、同一批 60 份**最便宜**的 node 档文件，断言合计只有 1.4s）：
  `Duration 25.69s (setup 70%, import 24%, transform 4%, tests 1%)` →
  `Duration 13.22s (import 73%, transform 14%, setup 8%, tests 3%)`，
  60/60 全绿。也就是这一批上 94% 的墙钟本来花在每份文件的固定装载，其中最大一块
  是 node 档**用得上也等于零**的那份 DOM 栈；乘数是 node 档的文件数（全仓 782 份
  用例里 `.test.ts` 占 628 份）。
- ⚠️ **刻意没有按 project 分配 `setupFiles`**，尽管那是更自然的写法。原因是一条
  会被静默漏掉的归属：带 `// @vitest-environment jsdom` 文件头的那些 `tests/**`
  用例**不在 DOM project 里**（由 node 档 include、靠文件头改环境）。按 project 分
  会让这一批拿不到 RTL 卸载与缺口处置器，而后者恰好在自己的用例里断言「接线没断」——
  红起来看着像处置器坏了，真原因是分配漏了一类文件。按 `document` 判没有这一格。
- 判据：`tests/global-setup-cleanup.test.ts` 原来只判「RTL 卸载真的注册上了」，
  现在加两条**反向**的（并把探针跑在三份文件上）。这条线之所以必须有判据：
  **谁把 DOM 栈写回静态 import，不会有任何一条用例报错** —— 多载一份匹配器不改变
  任何断言，只让每份文件重新交一次那 0.2s。所以探针正面断言 DOM 档拿得到
  `toBeInTheDocument`，反面断言 node 档**拿不到**它。
- 量具自己先自证过：把 `setup.ts` 改回静态 import 跑一遍，红的那一条正是新增的
  node 档探针（`expected [Function expect] to not have property "toBeInTheDocument"`），
  另两条照旧绿 —— 判据指向的是这次改的那一格，不是一把钝器。
