## Fixed

- **屏级标题字阶档的页头断言按现状重算**（`WorkflowLibraryLayout.test.tsx`）：h1 收进
  `u-title-page` 档之后，用例还在断言旧的 `font-title text-ink shrink-0 text-lg`
  —— 改结构时没重算断言，红在「页头把筛选包成一组」那条上（隔离跑也红，不是并发假红）。
  现在断言当前形态 `font-title u-title-page shrink-0`，顺手把「字阶档就是要收掉逐处
  手写 `text-lg` / `text-ink`」这件事写进注释，避免下一个人在这里补回旧类名。
