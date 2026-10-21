## Fixed

- **出厂载荷那一层开始真数产物：`build-desktop.mjs` 装配剪枝后、`tauri build` 前同批调用
  `check-standalone-contents.cjs`**（台账 R5-01 / ISSUE #1953）。此前 `pnpm build` 收尾那次数的是
  `.next/standalone` 与**组装前**的中间态，而整树解引用拷贝、白名单剪枝、§分发卫生、§首启建表、
  §载荷实体化（上提 + 删 `.pnpm`）全部发生在**之后**——真正被 `bundle.resources` 装进安装包、
  编译期内嵌进 exe 的 `src-tauri/static` 那一份从来没被数过（AGENTS 硬规则 18「产物要数两层」
  的第二层是空的）。现在一次完整出厂构建的日志里会看得到「standalone + static」两次计数。
  接线形态由 `tests/dist-artifact-hygiene.test.ts` 锁住（调了、数的是 static 那一份、排在 sidecar 之前）。
- **投毒验收有了可执行形态**：同文件新增「往 static 里放一个 `db.sqlite` → 两条违规一起点名」
  （顶层白名单外条目 + 开发库文件，合法态先立、不是恒红）——判据「认得出投毒」这一半从此每次
  提交都跑。
- **出厂构建那一半也已执行（2026-10-21 同批取证）**：一次完整 `node scripts/build-desktop.mjs`
  的日志里看到两对计数 —— 第 1 步 `pnpm build` 内 `[standalone] 2590 文件` + `[static] 0 文件`
  （旧行为：装配前 static 还不存在，那一层从未被数），2.6 步 `[standalone] 2590 文件` +
  **`[static] 3763 文件`**（装配 + 剪枝 + 实体化之后的真实载荷）。前置是体积预算先认账：
  那 +543 B 的例外流程认账同日由 #2091（ISSUE #2082）落在主干上（基线抬到
  `gzip 2277.2 KB / 221 文件`，锚点 `d752ed11` 主干可达，另附判据的归因通道修复）；
  本线在本检出跑的同一手续读数与之一致，用于把全链取绿。
- 本条是**就地重做**而非取回：2026-10-15 那次「已实施并投毒验收」的改动停在 stash
  （`wip-r5-desktop-count-*`），而该 stash 在本机四个检出一件都不存在（`git stash list` 全空），
  分支 `fix/desktop-payload-count-after-assembly` 本地与远端也都没有。照台账描述重写的这份
  没有继承那一次的验收过程，投毒用例与接线判据都是本次新写的证据。
