## Fixed

`<FormField>` 的标签 ⇄ 控件接线只在 render-prop 形态下成立，plain-children
形态下 `htmlFor` 指向一个 DOM 里不存在的 id —— 点标签不聚焦、控件没有可访问名
（规范 §16.2.4.26.1）。收口 22 处真控件站点到 render-prop，并给这条边界一个
执行者（`scripts/check-form-field-wiring.cjs`，棘轮）。
