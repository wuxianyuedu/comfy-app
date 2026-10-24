//! 统一的「轮询等待」工具（audit §C.4 L5 → ISSUE #2192）。
//!
//! 为什么要有它：壳里曾有六处各自手写的 sleep 轮询循环 —— 各写各的循环上限、
//! 各写各的间隔、没有一处共同的形状；其中一处（首绘看护）出过真实事故：
//! 「URL 还不是应用地址」那一支 `continue` 跳过了循环底部的 sleep，480 次探测
//! 在微秒内烧完，看护在最该在场的时刻提前下班（守着这件事的测试是
//! `first_paint_watch_never_spins_without_sleeping`）。收敛成一处之后，
//! 事故的根源（sleep 与探测分居循环的两头、靠 `continue` 串起来）
//! 从结构上消失：**每一拍先 [`PollClock::tick`]（睡这一拍），再做探测** ——
//! sleep 不可能被任何 `continue` 跳过。
//!
//! 两种等待都装得下（#2192 的收敛约束，缺一就是把某一处的理由改掉）：
//!   · 等**外部状态就绪**（端口通 / 窗口 URL 就位 / 首帧）—— 有墙钟预算，
//!     预算用尽 [`PollClock::expired`] 转 true，循环里打一句超时日志收场；
//!   · 常驻消费**进程内标记**（POSIX focus waiter：SIGUSR1 处理器只置位、
//!     线程轮询落地）—— [`PollClock::forever`] 无预算，永不过期。
//!
//! 退避语义与 Node 侧同一套（`scripts/launcher-core/ready-wait.mjs` 的
//! 「轮询退避」）：前几拍用快间隔（就绪大多发生在前几秒，别让用户多等），
//! 之后用慢间隔；**总预算是墙钟（[`Instant`]），退避不缩短它**。

use std::time::{Duration, Instant};

pub(crate) struct PollClock {
  started: Instant,
  /// 总墙钟预算；`None` = 常驻轮询（不过期）。
  budget: Option<Duration>,
  /// 快间隔（前 `fast_until` 拍）。
  fast: Duration,
  fast_until: u32,
  /// 慢间隔（快段用完之后）。
  slow: Duration,
  /// 已 tick 过的拍数。
  beats: u32,
}

impl PollClock {
  /// 固定间隔 + 墙钟预算（等外部状态就绪的最常见形状：间隔对这件事本来
  /// 就是常数，收进来只为统一形状与预算语义）。
  pub(crate) fn new(budget: Duration, interval: Duration) -> Self {
    Self::with_backoff(budget, interval, u32::MAX, interval)
  }

  /// 两段退避 + 墙钟预算（退避不缩短预算 —— 与 Node 侧同一句语义）。
  pub(crate) fn with_backoff(
    budget: Duration,
    fast: Duration,
    fast_until: u32,
    slow: Duration,
  ) -> Self {
    Self {
      started: Instant::now(),
      budget: Some(budget),
      fast,
      fast_until,
      slow,
      beats: 0,
    }
  }

  /// 常驻轮询（无预算）：等的是进程内标记（POSIX focus waiter），永不过期。
  pub(crate) fn forever(interval: Duration) -> Self {
    Self {
      started: Instant::now(),
      budget: None,
      fast: interval,
      fast_until: u32::MAX,
      slow: interval,
      beats: 0,
    }
  }

  /// 睡过这一拍。**每拍恰好调用一次，且放在循环体最前**（见模块头：
  /// 首绘看护那次事故的结构性解法）。
  pub(crate) fn tick(&mut self) {
    let interval = if self.beats < self.fast_until {
      self.fast
    } else {
      self.slow
    };
    self.beats += 1;
    std::thread::sleep(interval);
  }

  /// 预算用尽了吗（`forever` 恒为 false）。
  pub(crate) fn expired(&self) -> bool {
    self.budget
      .map(|b| self.started.elapsed() >= b)
      .unwrap_or(false)
  }

  /// 预算的秒数（给超时日志用；`forever` 恒 0）。
  pub(crate) fn budget_secs(&self) -> u64 {
    self.budget.map(|b| b.as_secs()).unwrap_or(0)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// 退避不缩短预算：预算是墙钟，拍数减少只减少探测次数。
  #[test]
  fn backoff_keeps_wall_clock_budget() {
    let mut clock = PollClock::with_backoff(
      Duration::from_millis(50),
      Duration::from_millis(1),
      2,
      Duration::from_millis(2),
    );
    let mut beats = 0;
    while !clock.expired() {
      clock.tick();
      beats += 1;
      // 防御：预算语义若坏成「按拍数判」，这里会烧满 u32 拍。
      assert!(beats < 1000, "预算没有按墙钟生效");
    }
    // 50ms 预算、1ms 快拍 ×2 + 2ms 慢拍：拍数必须远小于「全快拍」的 50。
    assert!(beats < 50, "退避没有生效：{beats} 拍");
  }

  /// forever 不过期（POSIX focus waiter 的形状：等的是进程内标记，永不过期）。
  #[test]
  fn forever_never_expires() {
    let mut clock = PollClock::forever(Duration::from_millis(1));
    for _ in 0..3 {
      assert!(!clock.expired());
      clock.tick();
    }
    assert_eq!(clock.budget_secs(), 0);
  }
}
