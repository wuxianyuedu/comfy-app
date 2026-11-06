## Changed

- **B5 子批 11：20 份 / 42 处 `typescript/no-unsafe-type-assertion` 清零**（判决面删掉这 20 份路径行）。
  本批全部在 `ui/`：`json-viewer` / `use-hotkey` / `input-group` / `toggle-group` /
  `sidebar` / `sonner` 等生产基元，以及 14 份组件与 hook 用例、2 份 story。
  修法仍是「运行时校验 + 类型守卫」：
  - `json-viewer`：文本节点 `instanceof Text`、高亮目标 `instanceof HTMLElement`、
    搜索递归值校验；匹配计数循环改 `indexOf` 条件式，去掉新增的抑制注释。
  - `use-hotkey`：宿主收窄成 `EventListener` 并 `instanceof KeyboardEvent`。
  - 样式自定义属性（`--gap` / `--sidebar-width` / `--skeleton-width` / toast 样式）：
    改为 `CSSProperties & { "--x": … }` 的变量赋值，不再断言。
  - `sonner` 主题、`table.stories` 的 `BadgeTone`：白名单 + `Object.hasOwn` 谓词。
  - 测试侧：`vi.fn<签名>()`、`instanceof HTMLElement` 早抛、`MediaQueryList` / `DOMRect`
    真类型替身、事件用 `new KeyboardEvent`、JSON 载荷 `isPlainRecord` 校验。
- 语义未变：合法输入结果一致；畸形载荷按既有回落。
- 台账：B5 行改「清账中（子批1–11：220 份 / 452 处已清）」。

Refs #3181
