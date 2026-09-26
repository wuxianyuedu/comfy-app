## Fixed

- **视图层 2 处 `<label>` 迁基元**（P78 六批）：
  - `mode-contract/dialog/ModeContractEditorView.tsx:185` —— 「必备」
    Checkbox 行的 label（同 `#1030 #1032 #1035 #1038 #1040` 那批 label
    包 Checkbox+文本的形态），→ `<FieldLabel>`；
  - `CustomNodesSettings/NodesTab.tsx:39` —— 「自定义节点目录」是
    **没有关联控件的视觉小节标题**（同段右侧只有一个「只读」状态徽章、
    下方是路径列表、不存在 `<input>` 让 `<label htmlFor>` 关联）。
    这类形态按 shadcn `forms.md` 应走 `<h4>` 或
    `<FieldLegend variant="label">`（FieldLegend 有 legend/label 两档，
    label 档就是"字段组的小标题"、不强制 `<fieldset>`）。选
    `FieldLegend variant="label"` 保留原文案与字号，同时把它归入
    `~/components/ui/field` 一族。

  基线 **89 → 87**（P78 累计 33 → 14）。
