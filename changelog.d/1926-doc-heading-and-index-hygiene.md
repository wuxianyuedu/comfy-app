## Fixed

- **16~18 章的标题层级与 01~15 章对齐：`#` → `##`，全书 288 条标题整体降一级**（ISSUE #1926）。
  此前 01~15 章用 `## N.` 起（无 H1）×15 章，16~18 章用 `# N.` 起（有 H1）×3 章 ——
  同一套文档集在 Markdown 大纲里分成两档，`docs/generated/**` 的两态也因此各长一个样。
  三章各降一级（16 章 286 条、17 章 49 条、18 章 22 条），层级关系本身一条没动。
  - **门禁联动两处**：`scripts/check-ui-customizations.cjs` 的台账标题常量
    `## 16.8` → `### 16.8`（章降级后 §16.8 也跟着降）；`tests/check-ui-customizations.test.ts`
    的夹具文档同批改，否则夹具与判据会各说一套。
  - **顺带修掉一个真 bug**：该脚本判「台账小节到下一个同级标题之间」时，把
    **代码围栏内部**的行也当正文 —— §16.8 的「覆盖前的标准动作」是个 bash 片段，
    里面 `# ③ 命中下表：…` 以 `# ` 开头被当成节尾，台账于是被**截在围栏中间、表格一行都读不到**，
    表现是「13 个带标记的基元，「台账里都没有」」（判据像在乱报，根因在解析）。
    现已跳过围栏内，并补了一条回归用例钉住这个形状。
  - **重号顺带修掉一处**：`launch-and-build.md` 有两个 `#### 7.1.1`（「产物目录占用的通用出口」
    与「产品版本号三处同步」）。后者是 `§7.1.1` 在文档内与台账表里的既有引用目标，
    故前者改 `§7.1.2`（连"「§7.1.2 的判据随之删除」"那处引用一起改），并按号序把
    7.1.1（产品版本号）排到 7.1.2 之前；夹在两者之间的「应用自更新」一节移到 7.1.2 之后。

- **文档集索引漏登记 4 份活文档，`docs/glossary.md` 的一句范围限定也名不副实**（ISSUE #1926）。
  `docs/README.md` §1「文档体系总览」是声明的**唯一入口**，但它漏了四份会被读者真正打开的文件：
  `standards/launch-and-build.md`（启动与构建规范，AGENTS「强制先读」表点名的那一章）、
  `startup-hotreload.md`、`guide-non-developer.md`、`workshop-mcp.md`、`guides/DEV-QUERIES.md`。
  其中 `launch-and-build.md` 还落在**另一个**面上：`scripts/check-doc-references.cjs` 的
  §3.1 校验范围守卫**只扫 `docs/standards/**` 与 `docs/guides/**`**，所以「索引为入口」
  这句话对 `docs/` 根的活文档此前没有任何判据。五处（含 `DEV-QUERIES.md`）已按同一张表补登。

- **`docs/standards/16` 的团队 Registry 一节直接抄了开发机绝对路径**（ISSUE #1926）：
  `D:/dev/Comfy-APP-T3/registry`（目录树、启动命令、批量生成命令三处）。registry 内容
  **本来就在仓库外**（`tools/shadcn-registry/README.md` 写明「换机器 / 换用户时必须同步改逻辑脚本里的路径」），
  抄进文档等于把一个人的机器路径当成事实。现改为占位符 `{{registry.dir}}`，并把它登记成
  一条**新的事实**（`registry.dir`，权威源 `tools/scripts/start-shadcn-registry.ps1` 的 `$RegistryDir`）
  —— 登记表此前只有 `registry.port`，目录那一半从没被核过。`docs/reference-facts.md` 新增 §1.4.1
  写明「这是本仓库唯一一个不在仓库内的路径」，`doc:check` 从此能拦住裸值回潮。

- **一批 Markdown 表格是「错格」的**（ISSUE #1926）：单元格里的 `\|` 漏了转义（`||`、`a | b`
  这类 TypeScript / 正则片段），Markdown 会把它当列分隔符，于是**表头 3 列、行却是 5 列**，
  多出来的内容渲染成一串错位的小格。逐处修正：`docs/DESIGN.md` 的三条「光晕表读完之后的三条诊断」
  原本被写成三个表行（内容是整段叙述，且缺掉该有的列），改为表后的引用块；
  `launch-and-build.md` §7 构建流程表里那格 `@next/bundle-analyzer` 的说明**折成了 6 行**
  （2018 年加进去时就折的），折行在 Markdown 里就是 6 个残行 —— 合回一格；
  `docs/audits/2026-10-12-architecture-risk-review.md` 一处多一个空格子、一处整段叙述被写成表行，
  一并归位。13 处「行内竖线数 ≠ 表头列数」已清零（剩余 0）。
