import "server-only";

/** 上传体的 multipart 开销余量：boundary 与字段头合计远小于 64KB。 */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/** Content-Length 预检（#4451）。
 *
 *  真正的权威校验是解析后的 `file.size`；这一层挡的是「拖一个几 GB 的文件进来，
 *  undici 先把整个 multipart **全量缓冲进内存**、然后才轮到大小检查」的 OOM 形态
 *  ——校验发生在缓冲之后，上限就形同虚设。`Content-Length` 是客户端可伪造的头，
 *  所以它只是廉价的预拒（防正常用户的误操作），不替代解析后的权威校验。
 *  三个上传入口（upload / materials / film-bgm）共用这一份判据。 */
export function contentLengthOverLimit(req: Request, maxFileBytes: number): boolean {
  const raw = req.headers.get("content-length");
  if (raw === null) {
    return false;
  }
  const total = Number(raw);
  return Number.isFinite(total) && total > maxFileBytes + FORM_OVERHEAD_BYTES;
}
