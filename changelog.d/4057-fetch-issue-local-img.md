## Fixed

- **`ship --fetch-issue` 落盘的 issue.md / comments.md 里图片看不了**（ISSUE #4057）。
  链接改写只匹配 `imgs/issues/...` 尾段，站点前缀 `https://<站点>/-/` 被留在原地，
  拼出「看似合法实则 404」的地址（如 `https://cnb.cool/<slug>/-/imgs/<文件名>.png`）。
  - 修法：改写按**完整 URL**（可带 scheme + 站点前缀）匹配，整条换成本地相对路径
    `imgs/<文件名>`——图片已由 `get-imgs` 下载进同目录，本地打开 md 即可渲染；
    评论里的图片同批处理。
  - 同一张图以不同形态（带域名 / 裸尾段）出现时按尾段去重，只下载一次。
  - 用例：`tests/ship-fetch-issue.test.ts` 新增「带站点前缀的完整链接整条换成本地
    路径」纯函数锁 + 全链断言升级（落盘 md 不得再出现 `https://cnb.cool`）。
