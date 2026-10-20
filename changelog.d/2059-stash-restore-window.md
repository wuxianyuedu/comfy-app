## Fixed

- **`restoreGeneratedFile` 头上的承诺比实现宽**（ISSUE #2059 的续，`tests/storybook-tsc-input.test.ts`）：
  它写的是「放回不了就按本机现生成一份 —— 一次判据不该把开发期输入弄丢」，而那条现生成
  **只挂在「暂存点不存在」那一支**。同卷时 `rename` 一步到位没有窗口；走 copy 退路时是
  先 `rmSync(生成件)` 再 copy，中间两侧都是空的 —— copy 那一跳中途抛（`ENOSPC` / `EACCES`）
  就既没放回、也不会去重生成，输入当场丢了。现在这一跳包 `try/catch` 落到
  `writeStorybookAppOrigin`，且重生成**落到传进来的那个路径**而不是在函数里重算一遍
  `ROOT/GENERATED_REL`（两处各算一份的漂移形态就是「测的时候写进仓库、跑的时候写到别处」）。
  ⚠️ 严重性说清：`sameVolume` 守卫之后节点走的是 rename，**这条窗口目前打不到** ——
  修的是承诺与实现的一致性，不是正在发生的坏。

- **同一文件里三处「曾经真、现在不真」的诊断**（都是 #2061 把槽根改成按 store 所在卷推导之后
  失效的）：`generatedStashFile` 头上那句「必须在仓库内、与仓库**同一卷**」、④ 那句报错
  「暂存点必须与仓库同卷」、以及 `moveFileAcrossVolumes` 与它上面那段 describe 里
  「节点上 workspace 与 `node_modules` 不同卷」的现在时表述。现在统一成：
  **优先同卷；跨卷由 `moveFileAcrossVolumes` 退成 copy —— 但仍在仓库内、不入库、不被遍历**，
  并写明节点上现在走的是 rename、那两条兜底判据测的是「形状兜底还在」而不是
  「正在被走到的那条路」。

- ④ 的暂存点形状里那条 `path.parse(stash).root === path.parse(ROOT).root` 一并换掉：
  stash 由 ROOT 拼出来，这条**恒真**，而一条恒真的断言不是判据（只会教会人忽略红）。
  换成可证伪的那条 —— 暂存点必须由传进来的 `root` 派生（照 `os.tmpdir()` 写死的实现
  在单卷机器上永远绿，而它正是当年把这台机器的开发期输入删掉的那一版）。

- 判据：`tests/storybook-tsc-input.test.ts` 新增三条（挪回中途抛 ⇒ 现生成一份且暂存目录收干净 /
  挪得动 ⇒ 放回的是暂存那一份而不是重生成的另一份 / 暂存点不存在 ⇒ 走既有那一支）。
  **变异自证过**：把 `try/catch` 退回旧形状，正是第一条红（`ENOSPC` 冒出来）、另两条照绿。
