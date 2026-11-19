## Fixed

- **「只剥块注释」那三份副本换成唯一实现**（ISSUE #2969 期望 1 的第三批：
  `tests/container-single-access.test.ts`、`src/components/studio/ViewTabStrip.test.tsx`、
  `src/components/ui/dialog-width.test.ts`）。分类表原本把它们记成「少剥一档（换 helper 会多剥整行
  注释，判决要先量）」——现场量出来不是那一回事：**不跟引号状态的块注释正则至今还在吃真代码**。
  量具 = 同一棵 src/ 树上逐行比对「只剥块」与 helper 默认档的行集合，取「旧档少、新档多」的那些行：

  ```
  $ node .git/probe-2969-kept.mts        # 只读，不改任何文件
  旧档吃掉而新档留下的行：23 份文件、共 199 行
     42 行 src/lib/comfyui/proc-detect.test.ts        例：import net from "node:net";
      8 行 src/lib/llm/video-task-util.ts             例：headers: { Accept: "*/*" },
      5 行 src/server/lib/request-body.ts             例：import "server-only";
      2 行 src/components/studio/hooks/use-model-library.test.ts
         例：http.all("*/api/trpc/*", …)
  ```

  落点是 `accept: "image/*"`、`Accept: "*/*"` 这类**串里的斜杠紧跟星号**：旧形把它当成块注释起点，
  一路吃到下一个真正的闭合，中间那些行对判据不存在。对 `container.resolve` 这种「不许出现 X」的
  判据，那就是**假绿**的通道。

  **双向变异证明**（打在该判据的真实面 src/** 上，`sha1sum` 核对还原）：往 `src/lib/api-error.ts`
  末尾放三行 ——

  ```ts
  const probeGlob = "image/*";
  const probeLegacy = container.resolve("projectRepository");
  /* 收尾 */
  ```

  旧剥法：2 passed（**假绿** —— 那一次 `container.resolve` 被当成注释吃掉了）；
  换成唯一实现：1 failed，报错逐字点名 `src/lib/api-error.ts`。

- `tests/reaper-side-effect.test.ts` 的那一份属于**语义不同**那一堆，只做了一半收敛：它的第二跳是
  整行注释（与默认档同语义，故并入 helper），第三跳是**把字符串字面量掩成空串** —— helper 没有那一档，
  这是本判据独有的（它的报错文案自己就是一个含 `startReaper()` 的字符串，不掩会把自己数成违规）。
  掩位那一跳留在调用方，不为了"看起来只有一份实现"而把它塞进共享件。

- 判决面不变：这四份用例改前改后同为 `Tests 23 passed (23)`；`eslint` 退 0；
  `tsc --noEmit` 只剩主干上那 6 条 `scripts/ci-heavy-gates.mjs`（本批零新增）。
