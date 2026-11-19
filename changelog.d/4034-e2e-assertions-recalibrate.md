## Fixed

- **GA 每日档「全量E2E」红：10 条断言滞后于现行 UI 契约**（ISSUE #4034，run
  43766927998 · sha abaf15e8；10 failed / 79 passed，失败集中在四族）。应用行为
  本身正常（本地逐族复跑复核过），是 e2e 断言没跟上两笔已落地的界面变更：
  - Base UI 迁移后，侧栏激活态是 `data-active` 属性**在场**（值为空串），不再是
    Radix 的 `data-active="true"` —— overlay-entries-as-views ×4、
    console-preset-layout ×3 改按属性在场断言；
  - #3740 起侧栏常驻项（含首页）不再进顶部「已打开的视图」页签条 ——
    settings-view ×2 仍在按「首页 + 设置」两页签断言；重写为：起步 0 页签、
    开设置后 1 页（设置，瞬时）、「切回首页」改走侧栏首页项、关设置后回 0；
  - 外观分区的圆角档位已改名（尖锐 → 小·12px / 中·16px / 大·20px / 特大·24px），
    且传导锚改为设置页上真实随 `--radius` 变的 `.rounded-lg` / `.rounded-md`
    元素（原 `.rounded-xl` 首个元素与 `--radius` 无关）—— appearance-steps ×1。
