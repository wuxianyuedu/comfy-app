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

- **第一批只收 2 份，不收其余 10 份**，因为逐份打出剥注释行分类后（读数与名单在 #2969 的评论里）：
  5 份**只剥块注释**（换 helper 会多剥整行 `//`，判决要先量）、
  4 处是**无锚的 NAIVE 形**（要先修形状，其中 `tests/executor-host-spawn.test.ts` 还把注释
  掩成等长空格以保偏移 —— 那是第三种语义，得先问"谁在读那个偏移"，这一句在第二批里量掉了，
  见下面 `## Fixed` 第二条）、
  1 份带 `(^|[^:])` 护栏（语义安全但与 helper 不等价，不该被"收敛"掉）。
  分类之外再动就是猜，所以第一批停在这一格。

- 一条探针自纠也记在 #2969 的评论里（这里只留一句）：我第一版分类探针把特征串写成**未转义**形态，
  于是 13 份只认出 3 份 —— 报出来的"量少"是我探针的形状错，不是仓里的量变了。

## Fixed

- **那 4 处无锚行跳全部换成唯一实现**（ISSUE #2969 期望 1 的第二批；`console-route-gates.test.ts`
  一处、`workflow-editor-topbar-config.test.ts` 两处、`log-run-layout.test.ts` 一处）。旧形的缺陷是
  **从字符串里的第一个双斜杠一路吃到行尾**，所以「不许出现 X」那一类断言对「X 写在同一行引号之后」
  是瞎的。现量差异（只读探针，量具 = 逐行比对旧形与 helper 的非空行集合，9 份真实接收者）：
  `src/lib/drizzle-studio/lifecycle.ts` 的
  `export const DRIZZLE_STUDIO_HOST = "https://local.drizzle.studio";` 被旧形削成半行 ——
  也就是那一圈 `includes("session-banner") === false` 的面上确实有一段它永远看不见的代码位。
  其余 8 份接收者在本仓今天的形态下判决无差（把"无差"报出来，是为了不假装它到处都在咬人）。

  **双向变异证明**（都打在真实读面上：改的是被扫的那份源文件，不是用例里的夹具；每步 `sha1sum`
  与快照逐字核对后还原）：

  | 接收者 | 注入的被禁写法（藏在同一行 URL 之后） | 旧剥法 | 换成 helper 后 |
  | --- | --- | --- | --- |
  | `src/app/api/console/run/route.ts` | `const MAX_COMMAND_CHARS = 99;` | 7 passed（假绿） | 1 failed |
  | `WorkflowEditorInner.tsx` | `setState({ ioPreviewOpen: true })` | 41 passed（假绿） | 1 failed |
  | `src/lib/drizzle-studio/lifecycle.ts` | `noteSession("session-banner")` | 1 passed（假绿） | 1 failed |
  | `scripts/dev.mjs` | 把 `maybeSpawnExecutorHost(…)` 整块移到起 Next 的 `spawnSync` 之后 | 4 passed（假绿） | 1 failed |

- **`tests/executor-host-spawn.test.ts` 那份"掩成等长空格以保偏移"的语义查清了，并且它守的判据原来是坏的**：
  读它偏移的是同文件里那两条「宿主调用排在起 Next 之前」——拿 `topLevelCallAt()` 在**剥后文本**里
  取的下标去比 `source.indexOf(锚点)` 在**原文**里取的下标。掩位的意图（等长）实测从来不成立，因为
  行注释那一跳是把字符删掉的：`scripts/dev.mjs` 里那次调用原文下标 5143，掩位法给的是 4254。
  修法不是去补那个等长假设，而是让两个下标**同源**（锚点也从那份剥后文本上取），于是掩位这一层
  复杂度整个消失。上表最后一行就是这个不同源比较的现场：调用被搬到 Next 之后，旧写法照样念绿。

- 判决面不变的凭据：这 4 份用例文件改前改后同一读数 `Tests 85 passed (85)`（4 个文件一起跑），
  与台账/探针自证两份合跑为 `100 passed (100)`；`eslint` 退 0；`tsc --noEmit` 只剩主干上那 6 条
  `scripts/ci-heavy-gates.mjs`（本批零新增）。
