## Added

- **GA 每日镜像档补「环境证据」诊断步（失败时）**（ISSUE #3333）：连续多天红在不同重格
  （全量E2E / API 文档生成与自检 / 单元测试）的现场里，环境杀只能停在「最大嫌疑」——
  hosted runner 的内核 OOM 行不会自己进 step 日志，dmesg 在 ubuntu-24.04 镜像上要 sudo。
  新步骤排在「单元测试」之后、覆盖率报告之前，`if: failure()` 兜住全部会红的格
  （一个诊断点，不按重格复制三份；绿的那一跑一个字节都不付）：`sudo dmesg -T` 过滤
  OOM / killed 形状的行（无命中时明说「内核没记 OOM」，不冒充第二格红）+ `free -h`
  内存读数。把 OOM 从猜测变成读数，再谈要不要按负载分档处置。
- `tests/no-platform-ci-config.test.ts` 新增 1 条钉形状：诊断步存在、位置在「单元测试」
  之后「覆盖率报告」之前、`if: failure()`、带 dmesg 与 free -h 两项读数。
