## Fixed

- 成片不再丢弃工坊已定稿的分镜图（#5141）：`createFilmFromProject` 把 `Shot.imageUrl`
  接进成片镜头的 `params.firstFrame`；新增 `src/server/film/first-frame.ts` 作为唯一落点，
  把 `/api/generated/...` 产物地址落盘读字节、上传进 ComfyUI input 目录，换成上传后的
  文件名再下发 `LoadImage`（非产物地址原样返回）。同批补转换与编排用例。
