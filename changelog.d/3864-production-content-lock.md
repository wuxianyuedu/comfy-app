## Fixed

- production 内容列（shots/characters/scriptReview/scriptMarkdown）的服务端多写者「读列→改→写列」统一收进按项目的内容写锁（#3864，审计源 #3848）：新增 `src/lib/production/content-write-lock.ts`；run 引擎逐镜生图/抽卡重出、评审器（文本评审/剧本评审/定向改写/重生成）、人工裁决与评分路由、成片回写 syncFilmToProject 全部改为「慢 IO 在锁外、锁内重读最新列再叠加本次产出」。并发交叠不再互相整列覆盖。
