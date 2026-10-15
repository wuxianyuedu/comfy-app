## Fixed

- **模型库 e2e 筛选档位改按 `radio` 点名（ISSUE #1925 收口时漏改的一处）**：`studio/ModelLibrary` 的类型筛选换 `SelectChip` 之后，语义从 `aria-pressed` 按钮回到 `radiogroup` + `radio`，而 `e2e/model-library.spec.ts` 仍按 `getByRole("button")` 逐档点名 —— 于是「这一屏装配起来了，且筛选档位里『放大』在」这条 `@critical` 在收口提交之后**恒红**（跑一次全量 e2e 就能看见，此前没人跑过那一档）。
  - 修法：把逐档点名限定在 `getByRole("radiogroup", { name: "按类型筛选模型" })` 里按 `radio` 断言，并在注释里写清它为什么是单选语义（规范 16 §16.2.4.75）。
  - 判据：**负对照** —— 把 `SelectChip` 的 `role="radio"` revert 成 `aria-pressed` 按钮后重建产物，这条用例当场红在「缺筛选档位『全部』」，证明它抓的是真语义而不是巧合。
  - 同批复跑：冒烟档 3/3 通过；`@critical` 全量 73 条通过（其中 2 条并发下 flaky，单跑复绿，与本改动无关）。
