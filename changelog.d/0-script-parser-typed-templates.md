## Fixed

- **`src/lib/workshop/script-parser.ts` 的 `expandIdea` 预制模板数组**：原实现
  把 template 标成 `Array<Partial<Scene> & { action: string; dialogue: string }>`
  —— `Partial<Scene>` 把 `heading` / `location` / `time` / `shotCount` 全打回
  可选（只有 `action` / `dialogue` 手工标 required）。三个字面量对象**都填齐了**
  这六项，`.map` 里 `template.heading!` / `.location!` / `.time!` /
  `.shotCount!` 四行只是把「人眼看到三个字面量都填了」的口头约定翻成 `!`。
  把 template 显式注解为 `readonly Omit<Scene, "id">[]`（模板里没有 `id`、
  由 `uid("scene")` 后填），一次性把「必填 = Scene 除 id 外的全部字段」写进
  类型；四个 `!` 消失，同时 `template.map((template) => ...)` 里遮蔽外层的
  形参改成 `t`。
  `.map` 返回体也**保持逐字段显式**而不是 `{ id, ...t }` 一把梭：Scene 未来
  加字段时，这里少给一个 `tsc` 立刻报缺属性——把「新字段是否需要在预制模板
  里给默认」这道问题留在编译器手里，运行时才不会读到 `undefined`。
