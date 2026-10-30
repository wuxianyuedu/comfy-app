## Fixed

- **`eslint.config.js` 里那句「lint 扫哪些目录」的复述补上了 `.storybook`（ISSUE #2614）**：
  头注 ② 那行抄成 `eslint src tests scripts e2e tools *.config.*`，而 `package.json` 的 `lint`
  实际是 `eslint src tests scripts e2e tools .storybook *.config.{js,mjs,cjs,ts}`。
  后果不是漏判，而是**误判成漏判**：那一行的读者（#2614）据此得出「`.storybook/**` 在扫描面里、
  却不在规则面里」，而规则面里 `.storybook/**/*.{ts,tsx,mts,cts}` 是**第 134 行显式列着的**
  （`git log -S` 追到 `b9cbd762`，2026-10-03，注释还写明「点目录不在 glob 的默认展开范围里，
  不列就是 tsc 与 eslint 的双重盲区」——列它正是为了拆掉那个盲区）。

  复核读数（都在 `master` 上跑的，不是读代码）：

  - `pnpm exec eslint .storybook --format json` ⇒ 被报 10 份文件、**0 条**。这一条单独**不能**当结论
    （「0 命中」与「没有规则生效」长得一模一样），所以按单子自己给的复现办法打了一次变异：
    在 `.storybook/` 下放一份含未使用变量的样本 ⇒ **1 条命中**
    `@typescript-eslint/no-unused-vars: 'neverRead' is assigned a value but never used.`
    探针同批删除，`git status` 复查零残留。⇒ 单子里那句「同一份样本放两个目录、前者 0 命中」没复现。
  - 调用点确实只有一处口径：`.githooks/pre-commit:461` 的 B 组是 `sh -c 'pnpm run lint'`
    （标签自己写着「范围见 package.json lint」）、`scripts/quality-gate.mjs:108` 是 `args: ["run", "lint"]`。
    没有任何一处另拼目录清单 ⇒ 「扩面」这一步**没有可扩的**。
  - 另一处复述 `docs/standards/13-提交与-code-review.md:4453` **本来就带着** `.storybook`
    ⇒ 本批之后两处复述一致，唯一的旧的那份是新改的这一行。

  所以这批改的是**声明**，不是行为（行为一直是对的）。按单子列的两条路读：第 1 条（扩面）已在
  `b9cbd762` 做过、现存量实测 0 条；第 2 条（从 `lint` 里摘掉 `.storybook`，理由是「扫了不判比不扫更危险」）
  前提被上面那次变异推翻。另在注释里补了一句「这一行只是复述，承重的那份在 `package.json`」——
  声明与实现分家这一族的本仓老账：**旧的那句声明自己会长出一张新单**。
