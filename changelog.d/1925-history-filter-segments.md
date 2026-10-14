## Fixed

- 历史页的状态筛选页签在**深浅两套主题下都读不出选中态**（ISSUE #1925，用户截图）。
  根因不是审美，是选中档写了 `bg-primary-solid` —— `primary-solid` 是 `Button` 的
  **`variant` 轴取值**，不是给 `className` 用的类名，样式表里没有这条规则；实测
  渲染出来的是 `py-1.5` 与 `bg-primary-solid` **粘连成一串**（`…py-1.5bg-primary-solid…`），
  于是选中项没有底色，`text-primary-foreground` 的纯白字直接压在页面底色上。
  计数徽标的 `bg-subtle5` 同源，也是同一个不存在的类（同一个 PR 内第二次复现
  「写了一个样式表里没有的类名，全绿、没人报错」这一形态）。
  现在整排交给 `ui/select-chip`（「一排里选一个」的全库唯一实现，规范 16 §16.2.4）：
  选中态有底色 / 字色 / 描边 / 字重四层，且自带与常态同值的 `hover:` —— 不会被
  `Button` 的默认悬停档吃掉；语义也从 `aria-pressed` 形态回到 `radiogroup` + `radio`。

## Changed

- `history-types.ts` 的 `FilterDef.dotCls` 换成语义键 `tone`（`StatusDotState`）。
  此前一个 `.ts` 配置模块直接持有 Tailwind 类名字面量（含绕过语义 token 的
  `bg-gray-400`），配色因此改不动 —— 现在只给语义键，由 `ui/status-dot` 唯一一处
  翻译成颜色（规范 03 §3.6.2）。

## Added

- `HistoryList.test.tsx`：钉住「筛选那一排不再出现那两个幽灵类名」+「选中态四层俱在」
  + 「`FILTERS` 只给语义键」。已做过负对照：旧实现下这五条全红。
