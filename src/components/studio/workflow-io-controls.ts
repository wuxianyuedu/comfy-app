/**
 * 工作流 IO 控件类型的**叶子**模块。`ControlKind` 是动态表单为条目渲染哪种控件的判别联合，
 * 原本内联在主模块 `workflow-io.ts` 且同被主模块与 `workflow-io-groups.ts` 消费；反向 `import`
 * 会形成 §12.7 禁止的循环（`check-circular-deps` 连 `import type` 也算边），故沉成叶子拉直方向。
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
