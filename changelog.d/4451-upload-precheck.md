## Fixed

- 三个上传入口（upload / materials / film-bgm）补 `Content-Length` 预拒（共享
  `src/server/lib/upload-limit.ts`）。此前先 `await req.formData()` 把整个 multipart
  **全量缓冲进内存**、之后才检查 `file.size` 上限——误拖一个几 GB 的文件会先按原
  体积分配内存再被拒绝，常驻桌面服务可能直接 OOM，大小上限形同虚设。Content-Length
  是廉价预拒（防正常用户误操作），权威校验仍是解析后的 `file.size`。（#4451）
