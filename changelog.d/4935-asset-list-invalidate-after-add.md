## Fixed

- **加入资产库成功后，资产库列表立即刷新**（#4935）：`useAddToAssetLibrary`
  成功后只关弹窗、没有失效 `asset.list` 缓存，叠加全局 30s `staleTime`
  （`refetchOnWindowFocus` 已关），切到资产库页会继续显示加入前的旧空列表
  （角标全 0），像「加入了却没进去」。现在写成功即失效列表缓存（与同文件
  删除路径的 `refresh()` 同一纪律），加入后立即可见。
