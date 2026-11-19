## Fixed

- **CHANGELOG 合并的重跑幂等与原子写**（ISSUE #3856）：`merge-changelog-fragments`
  原先「写 CHANGELOG → 删碎片」两阶段各自直写，写成功、删碎片失败（Windows 文件
  占用 EPERM）后重跑会把同一条目**再贴一遍**。现在：碎片正文已在账上即跳过（重跑
  幂等）；CHANGELOG 先写临时文件再 `rename` 原子替换（不留半截账本）；碎片删除带
  `force`，单片被占用不再让整段收尾炸掉。
