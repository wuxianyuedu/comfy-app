## Fixed

- **#1617 覆盖闸的「本笔自身增补」减除修好**：`ownDiffExplains` 取 diff 时经过了为读
  sha / 清单设计的 `.trim()`，而被改文件以空行收尾时 diff 末行是空行上下文——trim 掉
  一格，`git apply -R --check` 报 corrupt patch，减除静默失效，正常提交被误拦成
  「整份退回」。现取 patch 不再裁剪（`git()` 加不裁剪出口），并补「diff 尾部空行」
  回归用例（#4181）。
