## Fixed

- **测试模型页「生成进度（分节点）」：瞬时完成（无进度数字）的节点不再画满格假进度条（#4806）**——这类节点（If/Else Switch、Resolution Selector、Text、Replace Text 等 0s 完成的）现在与缓存跳过节点一致，只显示状态图标与耗时；运行中无读数的节点保留不确定态，有真实进度的节点照旧按 completed/total 画条。#4760 要的「已完成行不要永远扫描」一并满足。
