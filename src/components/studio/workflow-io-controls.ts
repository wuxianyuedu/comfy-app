/**
 * 工作流 IO 控件类型的**叶子**模块。
 *
 * `ControlKind` 是动态表单为一个条目渲染哪种控件的判别联合。原本内联在主
 * 模块 `workflow-io.ts`,同时被主模块与 `workflow-io-groups.ts` 消费——
 * 直接反向 `import from "./workflow-io"` 会形成 §12.7 禁止的循环
 * (`check-circular-deps` 不看 `import type`,AST 上有 import 边就算环)。
 * 沉到独立叶子文件才能真正把方向拉直:
 *   controls ← groups、controls ← 主,单向、无回环。
 */

/** 动态表单该为某个条目渲染哪种控件。 */
export type ControlKind =
  | "textarea"
  | "text"
  | "int"
  | "float"
  | "switch"
  | "image"
  | "link" // non-editable connection type (MODEL / CLIP / LATENT / …)
  | "select"; // COMBO with a resolved candidate list (SelectMenu dropdown)
