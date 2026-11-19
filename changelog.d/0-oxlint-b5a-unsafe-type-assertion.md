## Changed

- **B5 子批 1：20 份 / 49 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  修法统一是「运行时校验 + 类型守卫」：`.storybook` 的场景注册表在取值处用标注赋值放宽成
  `Record<string, X>`（注册表本身的字面量键保留，拼错名字仍在 tsc 红）；`JSON.parse` 结果先落
  `unknown` 再用 `isRecord` / `Array.isArray` 逐层取；Playwright `evaluate` 里的 DOM 断言改成
  `instanceof` 收窄或直接删除（`getComputedStyle` / `getBoundingClientRect` / `contains` 本就收
  `Element`）；`.mjs` 的 JSDoc 强转改成 `typeof` / `in` 收窄与局部守卫函数。
- 断言语义未变：字段缺失仍由原有 `expect` 判红，没有兜成绿；`.mjs` 脚本的人读话术与退出码口径未动。
- 台账：B5 行改「清账中（子批1：20 份 / 49 处已清）」。
- 清账总账：#3181（本批挂 `Refs`）。

Refs #3181
