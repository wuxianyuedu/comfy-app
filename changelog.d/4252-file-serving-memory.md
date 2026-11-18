## Fixed

- **`/api/logs/history` 不再把整份日志读进内存**（#4252）：只读尾部 8MB 窗口
  （`fs.promises` 句柄定位读），首行残行丢弃并加「仅显示最后 8MB」说明；
  响应形状不变。补契约测试 3 例。
- **`/api/generated` 无 Range 请求改分块流**（#4252）：下载器 / 杀软 / curl /
  预览抓取不带 Range，原实现把整份产物（视频可达数百 MB）一次性
  `Buffer.allocUnsafe` 进内存；现改 1MB 分块的 ReadableStream，Range 窗口
  请求仍走定长缓冲。
