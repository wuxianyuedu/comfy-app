## Changed

- **圆角刻度收成一处定义，默认档落到整数 ladder**（docs/DESIGN.md §Shapes）。
  `--radius` 基数从 `0.75rem`(12px) 改成 `1rem`(16px)，`@theme inline` 的系数从
  `0.6 / 0.8 / — / 1.4 / 1.8 / 2.2 / 2.6` 改成 `0.5 / 0.75 / — / 1.25 / 1.5 / 1.75 / 2`
  ⇒ 默认档实测 **8 / 12 / 16 / 20 / 24 / 28 / 32px**（原来是 7.2 / 9.6 / 12 / 16.8 /
  21.6 / 26.4 / 31.2 这串小数）。`@theme` 里那四行 `--radius-sm…xl: 8/12/16/20px`
  删除 —— 它们与 `@theme inline` 同名、后者获胜，从来没生效过，注释说 16px 而渲染
  12px。影响面：全仓 Tailwind 半径类 785 处（`rounded-lg` 365 处 12→16 是主力）、
  `ui/input-group.tsx` 的 `calc(var(--radius) - 3px)` 9→13px、`ui/sonner.tsx` 的
  `--border-radius` 12→16px。登录页 2 张 `toHaveScreenshot` 基线重录（重录前确认
  差异只有 47/46 像素且只在圆弧上）。

## Fixed

- **设置页的「圆角」档跟着整条刻度上移**（`src/lib/appearance.ts`）：四档值改为
  12 / 16 / 20 / 24px，默认档 = 基数 16px，标签里的 px 与实际渲染的基数一致（旧表
  标签写的是基数值，而卡片走 `rounded-xl`，所以标 12px 时卡片实际是 16.8px）。
  默认档 id 仍是 `md`，老用户存的 `"xl"` 仍指向最高档 —— 整条刻度等比上移，档位间
  的相对关系保持。

## Added

- **T4 圆角刻度判据**（`tests/theme-token-single-source.test.ts`）：`@theme` 里不许
  再长出 `--radius-*`；七档必须由 `var(--radius)` 派生；基数 × 系数必须等于设计意图
  那串整数；设置页默认档的值必须等于基数（否则「没设置过」与「选了默认档」会渲染出
  两套圆角）。解系数的正则配一条反向验证，防判据自己空转。
- **`--container-*` 三档登记进 T1 白名单**：宽度收口那一刀把 `max-w-narrow` /
  `-medium` / `-wide` 写进了 `globals.css` 却没登记命名空间，master 基线上
  `tests/theme-token-single-source.test.ts` 因此是红的（该文件不在 pre-commit 的固定
  结构用例清单里，而 `globals.css` 不被任何东西 import，增量选例也选不到它）。
