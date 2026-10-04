## Fixed

- **`master` 基线带着两条红，本批顺手收掉（不是本 PR 引入的）**。
  复算证据：在 `5ad0eaf7`（本分支的上游提交）上原样跑即红，与本次「过时做法」扫描无关。
  按规范 [§13.6.2](../docs/standards/13-提交与-code-review.md) 的处置口径单列一条记录 + 单独提交。

  1. **`tests/theme-token-single-source.test.ts`（硬闸类，挡所有人）**：
     上一个提交（`5ad0eaf7`）往 `src/app/globals.css` 加了 `--container-narrow/medium/wide`
     三个宽度档位，却没有把新命名空间登记进该用例的 `KNOWN_PREFIXES` —— 于是「源码里
     没有未登记的裸自定义属性」这条当场判红。修法是把 `--container-` 作为**Tailwind v4
     命名空间**登记（与 `--spacing-*` 生成间距类同理，它生成 `max-w-*`），而不是塞进
     `LITERAL_ALLOWED`（那三个值不是「别名写死字面量」，是刻度的本体）。
  2. **`src/lib/media/materials.test.ts` 的排序断言依赖机器时钟**：
     「cross 模式」那条用 `put()` 连写 `mine.png` / `shared.png` 却没给 `mtimeMs`，
     而聚合按 `updatedAt` 降序 —— 粗粒度时钟 / 快速文件系统上两次写入会拿到**相同**
     mtime，降序退化成「谁先谁先」，实测同一份代码在容器里顺序会翻。按本文件 `put()`
     自己的约定（`mtimeMs 固定排序方向（不靠机器时钟）`）显式钉住两个时刻，
     断言回到它真正要测的「共享区 + 本项目这一组内容」。
