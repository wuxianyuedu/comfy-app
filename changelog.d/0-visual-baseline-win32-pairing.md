## Fixed

- **像素回归层此前在唯一的开发机上跑不通；现在它跑得通，而且「跑不通」这件事本身有判据**
  （规范 §11.8）。`toHaveScreenshot` 的默认文件名含 `{platform}`，而入库的那套是
  `-linux.png`（CI 还在时录的）。开发机换成 Windows 之后，`pnpm test:visual` 报的不是「跳过」
  而是 `A snapshot doesn't exist at …-win32.png, writing actual`：**判失败，同时把生成的 PNG
  直接写进 `*-snapshots/`**（那里不被 .gitignore 忽略）。表现就是「写着有、其实跑不了」的
  中间态 —— 像素层看着存在，实际在这台机器上一次都没绿过，与 §11.7 要避免的不可信绿灯同形。
- **重录时撞到的真根因：破坏像素可复现性的不是平台，是全局 chrome。** 根布局给每个页面挂着
  `BrowserStatusBar`，里面有**实时帧率与系统时钟**，Next 的 dev 指示器也在左下角；三者都不是
  被测界面却逐帧在变，桌面端 fullPage 因此永远取不到两张稳定截图（`Failed to take two
consecutive stable screenshots`，实测差异约 90 个像素 = FPS 那两位数字）。spec 现在把这类
  chrome 用 `mask` 掉（`unstableChromeMasks`：按 `aria-label` 取状态栏，dev 指示器按存在与否
  追加，`pnpm dev` 与 `pnpm start` 两种 webServer 都能跑）。验收口径随之改成**同一命令连跑
  两次都绿**，而不是 `--update-snapshots` 那一次写成功。
- **口径：像素层保留**（布局 / 配色 / 尺寸这类退化只有像素抓得住，`getComputedStyle` 那条路
  补的是另一张网）。基线按「哪个环境真的执行像素回归，哪个环境有一套」入库：当前是
  `-win32.png` 两张（桌面 + 移动）。原先那两张 `-linux.png` 删除 —— 它们录于全局状态栏出现
  之前、也没有上面的 mask 规则，与现在的 spec 已经不是同一件界面，留着就是让那一档「一跑就红、
  而红指向的动作是重录不是修代码」。恢复 linux 档的姿势写进 §11.8：先用同一份 spec 在那档录出
  成套 PNG，再同批改 `SUPPORTED_PLATFORMS`。
- **新增 `tests/visual-baseline-pairing.test.ts`** 并登记进 `scripts/affected-tests.mjs` 的
  固定守护清单（每次提交都跑）：按 `e2e/visual/*.visual.spec.ts` 自扫（不维护 spec 清单），
  核对三头 —— 每个截图名 × 每个登记平台都有 PNG、PNG 全部被 git 跟踪（磁盘上有而未入库
  = 只在本机绿）、没有未登记的平台后缀与查无此名的孤儿基线。判据先按「看得见全部存量」的口径
  落：加它时实测点名 `login-desktop 缺 win32` / `login-mobile 缺 win32` 两条，重录后归零；
  而「贴回一张旧 linux 基线」这种走回头路的做法会被孤儿那条点名。
- **两处文档与现状对齐**：§11.8 补上「不依赖后端 ≠ 像素可复现」这一条与 mask 写法、把重录
  姿势改成「同一截图名在登记平台里成套提交」；`docs/guides/TESTING.md` 里那句「命名带
  `.visual` 便于 CI 单独筛选」是 CI 下线前的口径（现在没有会自己筛的 CI），改为「跑哪层点
  哪层」并补上基线齐全性与可复现两条约束。
