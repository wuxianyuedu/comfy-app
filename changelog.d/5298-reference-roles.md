## Added
- 参考图职责化（ISSUE #5298，借鉴 Higgsfield「一张参考只负责一件事」）：`Shot.referenceRoles` 与 `referenceImages` 逐槽对应，职责为 identity/texture/background/wardrobe/prop；老草稿没有职责自动归 identity，上限仍 16。逐镜生图把镜头参考图与角色表演参考合并成带职责的列表，并在提示词附「槽位 ↔ 职责 ↔ 图片编号」对照，便于核对上传槽位。补 8 条纯函数用例，产品阶段④口径同步更新。
