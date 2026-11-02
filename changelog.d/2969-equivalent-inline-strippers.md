## Changed

- **`stripComments` 副本台账面上的第一份"等价内联副本"收进共享件**（ISSUE #2969 期望 1 的第一次落地）：
  `tests/tw4-canonical-ratchet.test.ts:62` 与
  `src/components/studio/workflow-library/WorkflowLibraryLayout.test.tsx:245` 各自写着
  「块注释一跳 + `^\s*//` 一跳」——那与唯一实现 `tests/helpers/strip-comments.ts` 的默认档
  是同一语义，所以这两处换成 `stripComments(...)` 是**零回归**的那一批（其余的要先分类，见下）。

  **判决等价的凭据**（不是"改完没红"这种自证）：改前先跑一次、改后再跑一次，两份文件同一份读数目测相同：

  ```
  $ pnpm exec vitest run tests/tw4-canonical-ratchet.test.ts \
        src/components/studio/workflow-library/WorkflowLibraryLayout.test.tsx
  改前：Tests 30 passed (30)      改后：Tests 30 passed (30)
  ```

  台账那一格（`tests/strip-comments-single-source.test.ts` 6 条）两侧都绿 —— 这两处**从来就不在**
  它的 `LEDGER` 上（它只认 `function stripComments(` 这个名字），所以换掉它们不需要动台账；
  这件事本身就是 #2969 记的那一格缺口：**它们躲过了两根特征串**（名字那根、以及 NAIVE 那根
  —— `definedIn.filter` 的前置过滤把无名字的份直接排除了）。

- **本批只收 2 份，不收其余 10 份**，因为逐份打出剥注释行分类后（读数与名单在 #2969 的评论里）：
  5 份**只剥块注释**（换 helper 会多剥整行 `//`，判决要先量）、
  4 份是**无锚的 NAIVE 形**（要先修形状，其中 `tests/executor-host-spawn.test.ts:87` 还把注释
  掩成等长空格以保偏移 —— 那是第三种语义，得先问"谁在读那个偏移"）、
  1 份带 `(^|[^:])` 护栏（语义安全但与 helper 不等价，不该被"收敛"掉）。
  分类之外再动就是猜，所以停在这一格。

- 一条探针自纠也记在 #2969 的评论里（这里只留一句）：我第一版分类探针把特征串写成**未转义**形态，
  于是 13 份只认出 3 份 —— 报出来的"量少"是我探针的形状错，不是仓里的量变了。
