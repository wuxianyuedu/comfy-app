## Fixed

- 清掉 prettier 那条硬闸的 11 枚基线红（`node scripts/check-format.cjs`：未过 prettier 的文件
  「一个都不许有」，命中即阻断）。挡的不是本批改动 —— 它按 `src/**` 整体触发，所以**任何人
  暂存 src 下的改动都会被这 11 枚拦下**。
- 根因是第 7 刀新增的 `--text-4xs` 档：`prettier-plugin-tailwindcss` 的已知类序里没有它
  （它认 Tailwind 自带刻度与 `tailwind.config`，而 v4 是 CSS-first 的 `@theme`），于是把
  `text-4xs` 排到 class 串最前，11 个用到它的文件当场「未过 prettier」。
  差异只有类名先后：11 个文件 15 行，零功能改动 —— 按 `check-reformat-only.cjs` 那份权威定义
  判过（把改动前整份文件交给 prettier 重排、逐字等于改动后才算纯格式化）。
  另外逐条查过：这 15 行里没有一处把 `text-4xs` 与另一枚字号类写进同一个串，同族冲突无从翻转。
- 形态：**两次提交（6 + 5）**，单次提交的纯格式化文件数不超过那条门禁的阈值 10；这是它自己给的
  修法（「若确实要一次性格式化某批文件，那就单独一个提交/PR 做它」），整批改动不与任何行为改动混。
