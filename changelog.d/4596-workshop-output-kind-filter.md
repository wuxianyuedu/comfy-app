## Fixed

- 工坊产物回调的媒体过滤过宽（#4596）：四处调用点各自写「排除另一种媒体」的宽过滤
  （`kind !== "video"` / `kind !== "image"`），而产物事件的 `kind` 还有 `other`
  （ShowText 类输出节点、未知 `{filename}` 数组）——后到的 text/other 产物会把已写入的
  `imageUrl` / `clipUrl` 覆盖成 txt/杂项地址：画廊与镜头卡显示坏图，成片合成的镜头素材
  被污染。收成唯一判据 `isWantedOutput(target, out)`（按「命中本媒体」精确收），
  五处调用点统一改吃它，并补 image/video × other 的判据用例。
