## Fixed

- **表单校验归属判据改钉形态不钉名字，规范同批订正（#3566）**：`tests/ui-primitives-coverage.test.ts` 的守卫此前钉着 `RemoteModelDialog.tsx` / `fieldErrors` 这些名字字面量，供应商级重构（#3514）改名后红在 ENOENT 上，而它要守的设计决定（字段级规则住 lib 纯函数、视图不 author 规则）其实没破——每日全量单测因此红了两天无人立案。现改为形态判据：`provider-form` 纯函数模块存在且不碰 React、controller 是弹窗草稿流校验的唯一调用方、弹窗视图（`ProviderModelDialog` / `ProviderDialog`）不 import zod、不引用 `validate*Form`（含把校验函数当引用传出）、只消费转述的 errors；已用两个现实变异验证可打红（视图直调校验 / 视图 import zod ⇒ 红）。
- **规范 16 §16.2.4.8 三处同批订正 + 两处拍板**：落点表从 `*-schema.ts` 改为「lib 域纯函数模块」（`*-schema.ts` 留给 zod schema 模块，`provider-form.ts` 按内容取名）；写明详情面板例外——`ProviderDetail` 失焦保存直调 `validateProviderForm` 允许（调 lib 纯函数 ≠ author 规则，「controller 唯一调用方」约束的是弹窗草稿流防双头）；机器判据一节同步为形态形态。
- **摘除零消费导出**：`remote-model-schema.ts` 的 `validateRemoteModelFields` / `remoteModelFieldSchema`（含整份只测它们的自测文件）——生产零消费、形态已被 `provider-form.ts` 接管；`remoteModelEntryFromDraft` 的入参形状转纯类型 `RemoteModelDraft`（wire-contract 测试的「真桥」不受影响，7+ 条契约用例全绿）。`check-dead-exports` 对「只剩自己的单测」这一档的处理口径维持现状，未新增判据。
