## Added

- **`~/components/ui/select-menu` 的 `SelectMenu` 扩 a11y 属性转发口**：
  `SelectMenuProps` 新增 `id` / `aria-label` / `aria-labelledby` /
  `aria-describedby` / `aria-invalid` / `title` 六个可选 prop，全部 spread
  到底层 `SelectPrimitive.Trigger`（真正可交互的按钮元素）。此前调用点在
  原生 `<select>` 上天然吃这些属性（尤其 `<FormField>` 的 render prop
  `{(a11y) => <select {...a11y}>…}`）、迁 SelectMenu 需要显式开这一层。
  `title` 也一并转（虽然不推荐用它替代 Tooltip · 存量调用点保留行为）。

## Fixed

- **`app/(main)/settings/components/LlmLocalSection.tsx:134` 最后一处
  原生 `<select>` 迁 `<SelectMenu>`**（P76 五批 · 累计 1 → **0**）：
  `<FormField>` render prop 里的「当前模型」下拉、`{...a11y}` spread 现在
  完整落到 SelectMenu Trigger、`<label htmlFor="ollama-current-model">`
  仍能关联。options 从 `ollamaModels.map(m => m.name)` 派生、labels 缺省
  回退 value。`textHandler` wrapper 一并去掉。

## Changed

- **P76 从棘轮升为硬闸**（加进 `HARD_GATE_RULES`）：
  #1001 引入时视图层实测 **11 处**（10 文件），五批治理（#1057 #1059
  #1062 #1064 + 本 PR）全部走 `~/components/ui/select-menu` 的 `<SelectMenu>`
  基元清零 → 本 PR 升为硬闸。新增视图层裸 `<select>` 直接阻断。剩余若确有
  非走 SelectMenu 不可的特殊形态（比如原生 `<select>` 的 `size=` 多行选中
  语义），走 `EXEMPT_FILE_PATTERNS` 按文件粒度登记 + 说明理由。

  与 **P70**（space-y/x→gap）· **P72**（模态可访问名）· **P79**（浅色原色板）·
  **P80**（w-N h-N→size-N）同族：判据引入 → 分片治理清零 → 独立 PR 升硬闸。

## 自查

- [x] pre-commit 29 道全绿
- [x] `changelog.d/0-select-menu-a11y-and-p76-hardgate.md` 碎片
- [x] baseline total 2 → 2（P76 条目已从 files 剥离、余下 P77/P78 各 1 处保留棘轮）
- [x] LlmLocalSection 的 `useEffect` / 保存流程未动、只是渲染层换件
- [x] 视觉略漂到 SelectMenu 统一观感（用户已确认允许 · 后续走查）
