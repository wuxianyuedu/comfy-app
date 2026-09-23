## Added

- **`check-ui-primitives.cjs` 新增 P68「视图层手写 `<input>` / `<textarea>`」
  与 P69「视图层手写 `<input type="checkbox|radio">`」两条棘轮判据**
  （§16.2.3 / §12.18 · P67 系列的**视图层对偶**）：P67 是 ui/ 层判据
  （UI_ONLY_RULES，只扫 `src/components/ui/**`），P68/P69 是视图层判据
  （默认作用域 view + app + server，`ui/` `hooks/` `lib/` 走原有 EXEMPT_DIRS
  短路）。
  - **P68** 锚点：显式 `type="text|number|password|url|email|search|tel"`
    的 `<input>`（`type` 属性可能换行、用 `[\s\S]{0,80}` 窗口匹配）或
    `<textarea>`；已 import `~/components/ui/{input,textarea,number-field}`
    的文件短路清零。`<input>` 无 `type`（默认 text）与 `type="file"` 都不
    计入：前者实测视图层没出现（都写了显式 type）、判据先保守；后者由
    P7（file-picker 硬闸）管，不重复。
  - **P69** 锚点：`type="checkbox|radio"` 的 `<input>`；已 import
    `~/components/ui/{checkbox,radio-group}` 的文件短路清零。
  - main() 的「改法」提示同步加了 P68/P69 两行。
  - 基线冻结剩余视图层落点：**P68 = 13 处 / 13 文件**（`workshop/*` 6 ·
    `studio/*` 7）、**P69 = 6 处 / 6 文件**（`studio/*` 5 · `workshop/*` 1），
    合计 19 处。后续按域分片治理（workshop 域一 PR、studio 域一 PR、
    login/model 一 PR），每降一处 `--update` 收紧。

## Changed

- **`settings/` 目录 9 处 raw `<input>` 全部迁到 shadcn 基元**
  （P68/P69 治理首域，也是本 PR 冻结基线**之前**的清理）：
  - **4 处 Input**（迁 `~/components/ui/input` 的 `<Input>`）：
    - `SettingsPrimitives.tsx:108` 通用 Field 里的 `<input>` —— 截图里
      「全局默认温度」那格的「双层紫」（Chrome UA focus ring + 自定义
      `focus:border-primary` 叠加）就是这条；换成 shadcn `<Input>` 之后
      焦点档走 `focus-visible:border-ring + focus-visible:ring-3
focus-visible:ring-ring/50`（同一 `--ring` token、只在键盘聚焦时
      出现），一层协调 ring、不再叠 UA ring。
    - `RemoteModelDialog.tsx:111, 126, 227` 三处（接口地址 / API Key
      password / 模型名称）。
    - `LlmLocalSection.tsx:271` 任务温度 `type="number"` 步进器（`w-24`
      右对齐档）。
  - **5 处 Checkbox**（迁 `~/components/ui/checkbox` 的 `<Checkbox>`）：
    - `ComfyuiSection.tsx:126, 140`（comfyui-autostart /
      auto-sync-local-workflow）
    - `ExitSection.tsx:25, 49`（exit-kill-comfyui / exit-kill-ollama）
    - `UpdateCheckSection.tsx:49`（local-update-check-enabled）
    - base-ui Checkbox 的 `onCheckedChange` 签名是
      `(checked: boolean | string, event) => void`，回调里 `next === true`
      归成 boolean 再回传 controller；`id` + `<label htmlFor>` 关联保留。
    - 原 `className="accent-primary size-4"` 是浏览器原生 checkbox 的
      着色档，换成基元后走 shadcn Checkbox 默认（`size-4` + `border-input`
      - `data-checked:bg-primary` + `CheckIcon` 内嵌 indicator），深色
        主题下与整站焦点档一致、跨浏览器渲染统一。
  - **外部行为与视觉**：`Field` 的 props 契约不变（`label` / `value` /
    `onChange` / `type` / `placeholder`），消费点 0 改动；Checkbox 五处
    的 `id` 与 `<label htmlFor>` 关联保留，读屏器行为不劣化。

- **`tests/check-ui-primitives.test.ts`**：
  - 新增 P68 4 例（正向 `<input type=text>` 命中 / `<textarea>` 命中 /
    import `ui/input` 清零 / `ui/` 基元自身 raw `<input type=file>` 天然
    豁免）；
  - 新增 P69 2 例（正向 `<input type=checkbox>` 命中 / import `ui/checkbox`
    清零）；
  - P62Ok fixture 顺带加一行 `import { Checkbox } from
"~/components/ui/checkbox"` 让新加的 P69 短路（fixture 原意是验
    `checkedHandler` 走 form-props 出口不被 P62 计、与 P69 无关；fixture
    只跑 check-ui-primitives.cjs、不跑 eslint，未使用的 import 不报警）。
