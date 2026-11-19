## Fixed

- `/api/film/bgm` 的落盘两步（mkdir / writeFile）包进 try/catch，失败走本路由族
  统一的 `apiErrorBody` JSON（500）——此前磁盘满 / 杀软锁文件 / 权限变化会冒出裸
  500 HTML 页，前端 `readApiError` 解析失败、看不到可行动原因；`/api/helper/install`
  的 `readFileSync` 同批补同类收口。（#4454）
