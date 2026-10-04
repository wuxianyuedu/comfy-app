## Changed

- **画布节点卡角改成派生式**：新增 `--radius-node: calc(var(--radius) - 2px)`，
  把抄在 4 个文件里的 `rounded-[14px]` / `rounded-b-[14px]`（8 处代码 + 3 处注释）
  换成 `rounded-node` / `rounded-b-node`。默认基数下仍是 14px（逐像素相同），但
  设置页的圆角档现在能传到节点卡 —— 此前它是总闸旁边的一个旁通。与
  `ui/input-group.tsx` 的 `calc(var(--radius) - 3px)` 同一族写法。
- **两处「等于档位值的字面圆角」换回类名**：`rounded-[16px]` → `rounded-lg`（3 处，
  `HomePage`）、`rounded-[20px]` → `rounded-xl`（1 处，登录页卡片）。
- **设置页那句假承诺改掉**（`AppearanceSection`）：原文「正文固定 13px，不随这一档
  变化」，实测 `body` 是 preflight 的 **16px**、全站没有 13px 基准（正文主力是
  `text-sm`/14px，微标签是 `text-2xs`/`text-3xs`）。改成「正文与小号文字保持原尺寸，
  不随这一档变化」——不承诺一个不存在的数字。同一条错误陈述在 `globals.css` 与
  `src/lib/appearance.ts` 的注释里各有一份，一并改准并写下「界面文案不要再写具体 px」。

## Added

- **调用侧判据三条 + 一条负控制**（`tests/design-md-contract-sync.test.ts`，在
  pre-commit 固定清单里，每次提交都跑）：
  ① 任何 `rounded-[<字面 px>]` 只要等于某档的**当前渲染值**就红（那种写法此刻像素
    正确、但脱离设置页的总闸）；② 调用点字面圆角 / 字面字号各走棘轮，基线为本轮
    实测的 21 / 302，只许降；③ `@theme` 的 `--text-*` 档名必须是 t-shirt 形状 ——
    起因是实测 `cn("text-ink-muted","text-micro")` 会把颜色那条吃掉（`cn()` 把不
    认识的 `text-<名字>` 归进颜色组），豁免清单里登记 `section` / `page` / `stage` /
    `hero` 四颗历史名并注明「只经 `.u-title-*` 在 CSS 里用，别进 JSX」；
  ④ 负控制证明三种形状都真能被抓（正则漂了判据会静默全绿）。
- **圆角刻度的解析口径抽成单一实现** `tests/helpers/radius-scale.ts`：定义侧（T4）
  与调用侧（本批新增）读同一张「基数 × 派生表」，支持 `× N` 与 `± Npx` 两族写法，
  两份解析器迟早会漂（规范 §12.18）。

## Fixed

- T4 的解析器扩展后补一条判据：`--radius-node` 必须由 `--radius` 派生、默认渲染
  14px，且**不等于任何一档标准刻度**（否则该用档位而不是另立一格）。
  `tests/theme-token-single-source.test.ts` 45 条全绿。

## 刻意没做

- **状态点发光的裸值不改**：实测 `rgba(52,211,153,0.8)` 是 `#34d399`（emerald-400）
  而 `--color-success` 是 `#0ea472`；`rgba(251,113,133,0.8)` 是 `#fb7185` 而
  `--color-destructive` 是 `#e7000b` —— 当「免费清理」改过去会同时改色相与强度。
  已带证据记进 `docs/DESIGN.md` Known Gaps，标 needs-design-decision。
- `rounded-[2/3/4/5/11/18px]` 这 21 处小件字面圆角留在棘轮基线里（各有角色，
  需要逐个判断并档还是命名），不机械就近取整。
