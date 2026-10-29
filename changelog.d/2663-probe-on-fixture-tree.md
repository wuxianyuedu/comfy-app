## Fixed

- **反向验证探针不再往真实入库文件里注代码 —— 改跑夹具树，一段「被别人读成事实」的窗口
  从此不存在（ISSUE #2663）**：`tests/client-bundle-node-builtins.test.ts` 里那两格
  「入口集覆盖全 `src/**`」与「客户端图要穿过 `"use client"` 声明」此前是
  `writeFileSync(<真实文件>, 'import fs from "node:fs";\n' + original)` → 扫一次 →
  `finally` 还原。还原那一半 #2593 已经管住了（凭据是进用例前的字节，不是 git 索引），
  **但读的那一侧管不住**：vitest 按文件并行，`tests/lib-node-only-declarations.test.ts`
  在同一时刻扫的是同一棵真实树，于是它把别人的探针读成仓库事实 —— 当场现场是 PR #2661
  的 build `cnb-c25-1k62nch99` 报 `× src/lib/shell/shell-tabs-store.ts`，而那份文件在
  `master` 上只有 `import { create } from "zustand"`；**同一分支一个字没改、只重派生一次
  流水线就绿**（`cnb-8h5-1k62o407o`）—— 红不跟着改动走，只跟着调度时机走。

  窗口不是理论上的：一次全量扫描实测 **958ms / 931ms**（同进程连跑两次，本机 ReFS），
  每次探针都在那儿摆着一份「真实文件里有个 `node:fs`」的状态。

  两格都改到 `createGateRepo`（`tests/helpers/gate-repo.ts`，§11.16.1 那份共享夹具）
  搭的树上：判别位由夹具**自己造出那一形**，而不是往别人的真文件上借。
  **没有**选「独占 / 串行 / `--no-file-parallelism`」那类做法 —— 那些只把窗口调窄，
  第三份读同一棵真实树的用例出现时照撞（规范 §11.19 那条「并发与真实资源的隔离要一起改」
  是同一件事的另一半）。真实树的锚点改成**只读**两行（那份 lib 侧 `"use client"` 模块
  与 `src/trpc/react.tsx` 确实存在），判别位不是编出来的这件事仍然有出处。

  **两枚新探针各做了变异实测**（打在被测语义上，不是打在自己身上）：
  ① 把扫描器的入口集退回「只收 `src/app` / `src/components`」⇒ 只有第一格红
  （`… 只从 src/app|components 收集入口会漏掉它们（夹具里那个 lib 侧入口就是判别位）：
  expected undefined to be defined`），其余 3 条绿；
  ② 把 `isServerBoundary()` 改成「任何声明都是边界」（也就是把 `"use client"` 当停止点）
  ⇒ 只有第二格红，其余 3 条绿。两次都还原后 `git status` 只剩这份用例自己。

  同批量了一次「还有谁在写真实入库文件」（本单第 2 条期望）：改完之后 `tests/**` 里
  **还剩一族** —— `tests/check-doc-references.test.ts` 的 `PROBE_TARGETS` 七份文档
  （`AGENTS.md`、`docs/reference-facts.md`、`docs/standards/13-…`、两份 `DEV-QUERIES`、
  一份临时规范、一份碎片），它按 #2593 用字节快照还原，而**读侧窗口同样存在**且已量到
  一位并发读者：`tests/comment-language.test.ts:454-472` 直读真实
  `docs/reference-facts.md` 的 `comment.language.asciiOnly` 那一行。那是另一件事，
  另开一单（见 #2663 评论里的读数），本批不顺手改 —— 它写的是文档、判的是 `doc:check`
  的整仓扫描面，搬到夹具树是另一个尺寸的改动。
