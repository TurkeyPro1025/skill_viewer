//! 原子计数器(pipeline 调用/积分统计)。

use std::sync::atomic::AtomicU64;

#[derive(Default)]
pub struct Counter {
    pub calls: AtomicU64,
    pub credits: AtomicU64,
    pub failures: AtomicU64,
}

impl Counter {
    pub fn calls(&self) -> u64 {
        self.calls.load(std::sync::atomic::Ordering::Relaxed)
    }
    pub fn credits(&self) -> u64 {
        self.credits.load(std::sync::atomic::Ordering::Relaxed)
    }
}
