## Added

- **`~/components/ui/settings-card.tsx` 的 `SettingsCard`** —— 设置页 11 段落
  共用的「有标题的卡片」的唯一出口。此前 `app/(main)/settings/components/SettingsPrimitives.tsx`
  里定义了一份 `Card({ title, children })`（`<section>` + `<h2>{title}</h2>`），
  项目里 `~/components/ui/card.tsx` 装了但 0 引用。同一件事在**视图层**与
  **基元层**各存在一份、且视图层那份是绕开 shadcn 官方基元的自绘实现。

  本件是 shadcn `Card` 的**薄封装**（不是平行实现）——底色 / 圆角 / 边框 /
  padding / 深浅两态全部来自官方 `Card + CardHeader + CardTitle + CardContent`
  组合；对外只暴露 `{ title, children, className }` 三个 prop、把「标题
  必给」这一层结构固定下来。项目侧的 `bg-surface-1` / `text-ink` 是**本域
  卡片**的语义色（选用的仍是 token、不是覆盖），符合 shadcn `styling.md`
  「className for layout, not styling；语义 token 之间可以按域选」的口径。

## Changed

- **10 个 settings section 的 `<Card>` 迁到 `<SettingsCard>`**：
  `AppUpdateSection` / `AppearanceSection` / `ComfyuiSection` /
  `DatabaseSection` / `ExitSection` / `LlmLocalSection` / `LlmRemoteSection`
  / `LogCategorySection` / `UpdateCheckSection`。import 从
  `./SettingsPrimitives` 改到 `~/components/ui/settings-card`。

- **`SettingsPrimitives.tsx` 里的 `Card` 定义删除**：搬至 `ui/settings-card.tsx`
  之后，本目录不再自绘卡片。同文件保留 `Field`（走 FormField，是表单行）、
  `StatusButton`（走 ui/button + 状态行排布契约）、`AnsiLogText`、
  `FieldImagePreview` 四件——它们与 Card 无耦合、仍是本目录的局部 primitives。

- **顺带删掉两条 `dark:` 手写覆盖**（原 `<section>` 上的）：
  `dark:bg-surface-1/60` 与 `dark:shadow-none dark:shadow-black/2`。
  shadcn `styling.md` 原则 4：`No manual dark: color overrides. Use semantic
  tokens`。`--color-surface-1` 在 `globals.css` 已定义浅/深两态（#f7f8fa /
  #16161c），再加一层 `/60` 透明度是让深色底色透出更底层的模糊、属"手写
  dark: 微调 token"；`dark:shadow-none dark:shadow-black/2` 两条 shadow 前
  缀同类互相冲突，且 tailwind 产序不确定，实际行为靠后一条胜出。新件里
  backdrop-blur 保留、`shadow-sm shadow-black/5` 两态都挂（`--color-card`
  / `--color-border-subtle` 已由 globals.css 处理深浅两态）。视觉走查：
  设置页 11 段落在浅/深两态下与迁移前一致（浅态**完全**一致；深态少了原
  来 `/60` 那层"透过模糊可见底层"的效果——那条本身就是靠手写 `dark:` 破
  坏语义 token 的、去掉它才是合规方向）。

## 自查

- [x] pre-commit 29 道全绿
- [x] `changelog.d/0-settings-card-to-ui.md` 碎片
- [x] 11 sections import 全改（`grep "SettingsCard" src/app/(main)/settings/**/*.tsx` 命中数与 Card 老命中数对齐）
- [x] `SettingsPrimitives.tsx` 不再导出 Card、`Field`/`StatusButton` 等未受影响
- [x] 注释中文；R10 通过；prettier 通过
