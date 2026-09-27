## Fixed

- **`FilmStudio.tsx` 9 处原色板就地处置**（P79 四批 · 累计 46 → 37）：
  - **brand violet→primary 三处**（focus border/ring + 单档 accent-color · 与
    项目 `--color-primary: #7c5cfc` 同族 · 视觉近似）：
    - 输入框 focus border/ring（两处 `focus:border-violet-500/50
      focus:ring-violet-500/20` → `focus:border-primary/50 focus:ring-primary/20`）
    - `<Checkbox className="accent-violet-500">` → `accent-primary`
  - **状态 emerald→success 两处**（对齐 §3.6.2「统一状态映射」· SUCCEEDED/DONE
    → success）：
    - 字幕轨 clip 的 `bg-emerald-400/15 ring-emerald-400/25` → `bg-success/15
      ring-success/25`
    - 底部状态栏"本地已连接"圆点 `bg-emerald-400 shadow-emerald-400/40` →
      `bg-success shadow-success/40`
  - **brand 渐变与 timeline playhead 红 · 5 处包 p71-allow**（JSX 顶层位
    的例外声明 · 需要 #1072 的解锁）：
    - 影片进度条 `<ProgressBar fillClassName="bg-linear-to-r from-violet-500
      to-fuchsia-500" />` 整段包 allow（brand 双色渐变、单档 token 化会失去
      渐变识别度）；
    - Timeline Playhead 竖线 + 顶部把手（两处 `bg-red-400/80`）包 allow
      （红是视频剪辑行业的播放头视觉惯例、**非错误状态色**、走 `bg-destructive`
      会被误读成「这里出错了」）。

  基线 **50 → 41**（P79 累计 67 → 37）。
