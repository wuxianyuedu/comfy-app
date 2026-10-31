## Fixed

- **受影响用例门的第二批残余噪音**（ISSUE #2844）：#2823 那张清单只收「被测源码的
  stderr 错误」（ECONNREFUSED/:3000、canvas-sync、a11y 故障故事），而实构建
  （cnb-hkh-1k68d3ms7）里还漏着另一族——**测试夹具自己 spawn 的子进程输出与探针抬头**
  （走 stdout）：git autocrlf 传输警告、`git worktree add` 进度行、负向用例按设计造的
  git 失败与 Playwright 失败抬头、`ci-env-probe` 裸段名（[ports]/[python]/[schema]/
  [browser]）、`ci-install-deps` 判据被夹具 exercise 的原话、storybook 加载
  `.storybook/main.ts` 的 extensionless 警告块、孤立 `x` 行（两次实构建都在场、源未定位，
  按观察形态收）。新增第二张清单 `FIXTURE_NOISE_PATTERN`（与第一批分开列，每条能指到
  出处），照旧只滤回吐屏、不滤 junit（vitest 自写、保全量），反向判据钉「带内容的探针
  行是真读数，不因段名前缀误删」。
