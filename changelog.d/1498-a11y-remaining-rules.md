## Fixed

- **`jsx-a11y` 剩下的 7 条规则逐条裁决，并把「没人决定过」立成判据（ISSUE #1498）**：
  上一轮把 `recommended` 全开之后，还有 **7 条不在官方两份配置里**。本轮逐条实测并裁决 ——
  其中 4 条是官方**做过决定**的（`accessible-emoji` / `no-onchange` / `label-has-for`
  标❌废弃、`anchor-ambiguous-text` 明写 `off`），尊重它、不开；
  另 3 条**既非废弃、也非明写 off**（`lang` / `no-aria-hidden-on-focusable` /
  `prefer-tag-over-role`）—— 它们只是被插件那两份**手写的静态清单**漏掉了，
  「该不该开」从来没有人决定过。
  - `lang` 与 `no-aria-hidden-on-focusable` **开**：全仓实测 0 处，是零成本的真判据
    （防的是「新增一处写错」，不是「现存有多少」）；
  - `prefer-tag-over-role` **不开**（实测 27 处全是有意取舍：Base UI 的复合控件 pattern、
    shadcn 修 Safari 列表语义的 `role="list"`、`role="status"` 的 live region，换成它建议的
    原生标签会把控件改坏），并登记进台账；**但它照出了一个真缺陷族** ——
    `role="radiogroup"` 声明了却没有方向键契约，已收口。

- **设置页外观分区的单选组补齐键盘契约（`AppearanceSection`）**：此前手写
  `role="radiogroup"` + `role="radio"` 挂在 `<Button>` 上 —— 读屏知道「这是个单选组」，
  Tab 进得来、聚焦得到，但**组内方向键没反应**，两个项还都留在 Tab 序列里。
  改用 `ui/radio-group` 基元（Base UI `RadioGroup` / `Radio.Root` + `render`），
  方向键「移动 + 选中」与 roving tabindex 由基元给；主题卡与「圆角 / 标题字阶」档位行
  两处一并收口。新增 `AppearanceSection.test.tsx` 4 条钉住契约（**改回手写形态会红**）。

## Added

- **`check-a11y-rules.cjs` 新增第五向：官方两份配置谁都没提到、又未被标记废弃的规则，
  本仓必须有一笔裁决**（开着，或在台账 `dialect` 里登记「为什么不开」+「谁在守它」）。
  废弃状态**从插件的 `meta.deprecated` 读**，不在判据里抄废弃名单。
  这是原来那个洞的另一面 —— 此前只堵了「官方 `recommended` 里被悄悄关掉」，
  「压根没被列进任何一份配置」一直敞着。门禁自测 7 → 10 条。
