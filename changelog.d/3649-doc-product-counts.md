## Fixed

- **产品需求文档的「功能域数 / 编号化需求条数」不再是第二份手抄值（ISSUE #3649）**：
  `docs/README.md` 写「14 个功能域 76 条」、`docs/product/README.md` 写「17 个功能域」，
  而分域总表实际是 17 个功能域 100 条需求 —— 两处口径不一致，且抄错了没有任何判据会发现。
  - **两个数改成现场口径**（17 个功能域 / 100 条编号化需求），两处一致。
  - **数字从此有执行者核对**：`pnpm doc:check` 按 `feature-catalog.md` 的分域总表现场
    提取计数并逐处核对（事实 key `product.domains.count` / `product.requirements.count`，
    登记表见 `docs/reference-facts.md` §1.7）—— 改了总表却没改这两处数字，判据当场报错。
  - **判据「会红」有用例钉住**（`tests/product-doc-counts.test.ts`）：把索引文档里的数字
    改坏后判据必须当场变红；另钉住总表本身的结构不变量（域小节与表内域缩写一一对应、
    需求编号不重复）。
