## Added

- **内嵌中文标题字面（设计契约「待定 3」的签字落地）**：`public/fonts/SarasaGothicSC-Bold.ttf`
  + `@font-face`。这条的前提实测过：**`--font-title` 的首选 `Sarasa Gothic SC` 从来没在
  任何机器上生效过** —— 本机系统级（`C:\Windows\Fonts`，563 个文件可读）与用户级字体目录
  都没有它，`next/font` 也只加载了 Geist，所以那 15 处 `font-title` 一直在渲染
  Geist + 系统 CJK。「装机才回退」这个直觉是错的，回退是当前唯一形态。
- **只嵌 Bold 一档**（23,892,196 字节）：`font-title` 的全部落点都是 700（`font-bold`
  或 `.u-title-page`，后者写着 `font-weight: 700`），没有 600 档在用；完整 CJK 每个
  weight 都是 ≈23 MB，多嵌一档就是再搬 23 MB 进产物与安装包。许可 **SIL OFL 1.1**，
  全文按 OFL 的再分发条件放在 `public/fonts/OFL-Sarasa-Gothic.txt`。
- **字体走 git-lfs，并补上本仓库缺的那两条接线**。这一步不是「加一行 .gitattributes」
  就完事，实测有两个坑会让它静默失效：
  ① 本仓库 `core.hooksPath=.githooks` **整目录覆盖** `.git/hooks`，而 LFS 的上传靠
  `pre-push` 钩子 —— git-lfs 装在 `.git/hooks/` 的那份一概不会被调用。探针实测：
  隔离仓库（默认 hooks 目录）里 push 会打印 `Uploading LFS objects: 100%`，而本仓库的
  `.githooks/` 里原本只有 `pre-commit` 一个文件。⇒ 新增 `.githooks/pre-push`（随仓库
  分发，新克隆 `pnpm install` 后即生效，不靠每个人本机 `git lfs install`）。
  ② `filter.lfs.*` 通常写在**全局**配置里，新克隆没有 ⇒ `.gitattributes` 的规则落空，
  `*.ttf` 按**原字节**进历史（23 MB 摘不干净，只能重写共享远端）。⇒ 在
  `scripts/install-git-hooks.mjs` 里加第三步顺带接线 `git lfs install --local --manual`
  （`--manual` 是刻意的：不让它往 `.githooks/` 写自己那套钩子；失败只提示、不阻断安装，
  与既有的 eslint 缓存指纹、Storybook 生成件同构）。
- **执行者**：`tests/embedded-title-font.test.ts` 并进 `FIXED_STRUCTURAL_TESTS`。判四环
  （`.gitattributes` 路由、pre-push 那行是**活命令**不是注释、postinstall 里那步是独立
  语句、`@font-face` 的 family 与 `--font-title` 首选同名且文件真在）+ index 里存的确实是
  指针且指针 `size` 与工作树字节数一致 + 许可全文在位。按「在场判据要解析」的教训配了
  反向对照：把钩子那行加 `# ` 注释掉必须判不出来。
  **它第一次跑就抓到我自己两个错**：许可标题按记忆写成全大写那一版（实际文本是
  `SIL Open Font License v1.1`）；`@font-face` 的 `url` 是**站点根**路径，磁盘上在
  `public/` 下，我少拼一层会误判「文件不在」。
- **端点能力实测**（决定走 A 的前提，不是推测）：隔离仓库里推 3 KB 探针 →
  提交对象是 `oid sha256…/size 4079` 的指针、push 打印上传成功、**全新克隆回读拿到
  4079 字节原文**且 `git lfs ls-files` 标为已下载 ⇒ CNB 侧 LFS 存储可用。探针分支
  已删除。仓库当前 `.git` = 88.6 MB，此前**没有任何**被跟踪的字体二进制，所以不存在
  「新旧两套口径混用」的迁移问题。
- **代价（要认的）**：安装包与 standalone 会各多约 23 MB —— `public/` 已在
  `STANDALONE_ALLOWED_TOPLEVEL` 与 `STATIC_ALLOWED_TOPLEVEL` 两张顶层白名单里，
  所以不需要新增条目、也不动产物层那道默认拒绝；但 #1323 把 standalone 从 19274 个
  文件削到 2504 个的那条线，从此多了一个 23 MB 的单文件载荷。首帧观感用
  `font-display: swap` 处理（回退栈先画、字面到货再换）。
- 契约 `docs/DESIGN.md` 的「待定 3」同步改成已签字+已落地，并订正我上一条报告里一处
  不严谨：`NotoSansSC-VF.ttf` 确实在本机字体目录里，但我**没有区分**它是 Windows 自带
  还是后来装的 —— 所以「换成系统 Noto 是零成本可靠方案」那句不成立；中文 Windows
  必然自带的是微软雅黑，而它**本来就在**回退栈里。也就是说只有内嵌才真正保证观感。
