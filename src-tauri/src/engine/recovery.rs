//! Engine crash recovery: bounded auto-restart with backoff.
//!
//! When `llama-server` exits unexpectedly while serving (a crash, not a
//! requested unload), the runner must not silently leave the engine dead,
//! and must not restart it forever either. This module is the pure policy
//! behind that behaviour:
//!
//! - Up to [`MAX_CRASH_RESTARTS`] consecutive restarts, then stop and report.
//! - Exponential backoff between attempts ([`backoff_for_attempt`]):
//!   500 ms, 1 s, 2 s, capped at 8 s, so a crash-looping binary does not
//!   hot-spin the process table.
//! - Every decision carries a user-visible status message: the UI always
//!   shows "restarting (attempt N of 3)" or "stopped after 3 attempts",
//!   never a silent death.
//!
//! The policy owns no process, no clock, and no Tauri state: the runner
//! actor (see `INTEGRATION-productivity.md`) feeds it `ChildCrashed`
//! observations via [`CrashRecoveryTracker`] and executes the returned
//! decision. A successful health check resets the counter through
//! [`CrashRecoveryTracker::record_healthy`], so three crashes spread
//! across a week do not exhaust the budget — only three *consecutive*
//! crashes give up.

use std::time::Duration;

/// Maximum consecutive unexpected exits before the engine gives up.
/// A crash during startup (before first healthy) does not use this budget:
/// it is a start failure, reported immediately as `Failed`.
pub const MAX_CRASH_RESTARTS: u32 = 3;

/// Backoff before the first restart attempt.
pub const RECOVERY_BASE_BACKOFF_MS: u64 = 500;

/// Backoff ceiling: no restart waits longer than this.
pub const RECOVERY_MAX_BACKOFF_MS: u64 = 8_000;

/// What the runner should do after an unexpected engine exit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecoveryDecision {
    /// Restart the same target after `delay`. `attempt` is 1-based.
    Restart { attempt: u32, delay: Duration },
    /// Do not restart: the consecutive-crash budget is exhausted.
    /// `attempts` is the number of restarts already tried.
    GiveUp { attempts: u32 },
}

/// Pure: the backoff before restart attempt `attempt` (0-based: attempt 0
/// is the first restart). Exponential (`base * 2^attempt`) capped at
/// [`RECOVERY_MAX_BACKOFF_MS`], with saturating arithmetic so a huge
/// attempt number cannot overflow.
pub fn backoff_for_attempt(attempt: u32) -> Duration {
    // 2^attempt, saturating: attempts >= 64 would overflow a u64 shift,
    // so they saturate at u64::MAX before the cap below applies.
    let multiplier = if attempt >= 64 {
        u64::MAX
    } else {
        1u64 << attempt
    };
    let ms = RECOVERY_BASE_BACKOFF_MS
        .saturating_mul(multiplier)
        .min(RECOVERY_MAX_BACKOFF_MS);
    Duration::from_millis(ms)
}

/// Pure: the decision after `consecutive_crashes` unexpected exits in a
/// row, against a budget of `max_restarts`. The first crash (count 0)
/// restarts; once `max_restarts` restarts have already been tried, give up.
pub fn decision_after_crash_with(consecutive_crashes: u32, max_restarts: u32) -> RecoveryDecision {
    if consecutive_crashes < max_restarts {
        RecoveryDecision::Restart {
            attempt: consecutive_crashes + 1,
            delay: backoff_for_attempt(consecutive_crashes),
        }
    } else {
        RecoveryDecision::GiveUp {
            attempts: max_restarts,
        }
    }
}

/// Pure: the decision with the default budget ([`MAX_CRASH_RESTARTS`]).
pub fn decision_after_crash(consecutive_crashes: u32) -> RecoveryDecision {
    decision_after_crash_with(consecutive_crashes, MAX_CRASH_RESTARTS)
}

/// Pure: user-visible status while a restart is pending. Never empty, and
/// always carries the attempt count so the UI can show progress.
pub fn restarting_message(attempt: u32, max_restarts: u32, reason: &str) -> String {
    format!("Engine crashed ({reason}) — restarting (attempt {attempt} of {max_restarts})…")
}

/// Pure: user-visible terminal status once the budget is exhausted.
pub fn gave_up_message(attempts: u32, reason: &str) -> String {
    format!(
        "Engine stopped after {attempts} restart attempts ({reason}). Start it again from Settings or send a new message to retry."
    )
}

/// Counts consecutive unexpected exits and turns each one into a
/// [`RecoveryDecision`] plus its user-visible message. The runner holds
/// one tracker per engine lifetime; a healthy load resets it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CrashRecoveryTracker {
    consecutive_crashes: u32,
    max_restarts: u32,
}

impl Default for CrashRecoveryTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl CrashRecoveryTracker {
    /// A tracker with the default restart budget.
    pub fn new() -> Self {
        Self {
            consecutive_crashes: 0,
            max_restarts: MAX_CRASH_RESTARTS,
        }
    }

    /// A tracker with an explicit budget (tests / future tunables).
    pub fn with_max_restarts(max_restarts: u32) -> Self {
        Self {
            consecutive_crashes: 0,
            max_restarts,
        }
    }

    /// Consecutive unexpected exits seen since the last healthy load.
    pub fn consecutive_crashes(&self) -> u32 {
        self.consecutive_crashes
    }

    /// Records one unexpected exit. On `Restart` the counter advances;
    /// on `GiveUp` it stays at the budget so further crashes keep giving
    /// up until a healthy load resets it.
    pub fn record_crash(&mut self, reason: &str) -> (RecoveryDecision, String) {
        let decision = decision_after_crash_with(self.consecutive_crashes, self.max_restarts);
        match decision {
            RecoveryDecision::Restart { attempt, .. } => {
                self.consecutive_crashes += 1;
                (
                    decision,
                    restarting_message(attempt, self.max_restarts, reason),
                )
            }
            RecoveryDecision::GiveUp { attempts } => (decision, gave_up_message(attempts, reason)),
        }
    }

    /// Records a healthy load: the engine is serving again, so the
    /// consecutive-crash counter resets to zero.
    pub fn record_healthy(&mut self) {
        self.consecutive_crashes = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_doubles_then_caps() {
        assert_eq!(backoff_for_attempt(0), Duration::from_millis(500));
        assert_eq!(backoff_for_attempt(1), Duration::from_millis(1_000));
        assert_eq!(backoff_for_attempt(2), Duration::from_millis(2_000));
        assert_eq!(backoff_for_attempt(3), Duration::from_millis(4_000));
        // 500 * 2^4 = 8000 = cap; anything larger saturates at the cap.
        assert_eq!(backoff_for_attempt(4), Duration::from_millis(8_000));
        assert_eq!(backoff_for_attempt(10), Duration::from_millis(8_000));
        assert_eq!(backoff_for_attempt(u32::MAX), Duration::from_millis(8_000));
    }

    #[test]
    fn decision_restarts_until_budget_then_gives_up() {
        assert_eq!(
            decision_after_crash(0),
            RecoveryDecision::Restart {
                attempt: 1,
                delay: Duration::from_millis(500),
            }
        );
        assert_eq!(
            decision_after_crash(1),
            RecoveryDecision::Restart {
                attempt: 2,
                delay: Duration::from_millis(1_000),
            }
        );
        assert_eq!(
            decision_after_crash(2),
            RecoveryDecision::Restart {
                attempt: 3,
                delay: Duration::from_millis(2_000),
            }
        );
        assert_eq!(
            decision_after_crash(3),
            RecoveryDecision::GiveUp { attempts: 3 }
        );
        // Past the budget stays GiveUp: no infinite restart loop.
        assert_eq!(
            decision_after_crash(99),
            RecoveryDecision::GiveUp { attempts: 3 }
        );
    }

    #[test]
    fn decision_honours_custom_budget() {
        assert_eq!(
            decision_after_crash_with(0, 1),
            RecoveryDecision::Restart {
                attempt: 1,
                delay: Duration::from_millis(500),
            }
        );
        assert_eq!(
            decision_after_crash_with(1, 1),
            RecoveryDecision::GiveUp { attempts: 1 }
        );
        // A zero budget never restarts.
        assert_eq!(
            decision_after_crash_with(0, 0),
            RecoveryDecision::GiveUp { attempts: 0 }
        );
    }

    #[test]
    fn messages_carry_attempt_counts_and_reason() {
        let restarting = restarting_message(2, 3, "segfault");
        assert!(restarting.contains("attempt 2 of 3"));
        assert!(restarting.contains("segfault"));
        let gave_up = gave_up_message(3, "segfault");
        assert!(gave_up.contains("3 restart attempts"));
        assert!(gave_up.contains("segfault"));
        assert!(gave_up.contains("Start it again"));
    }

    #[test]
    fn tracker_restarts_three_times_then_gives_up() {
        let mut tracker = CrashRecoveryTracker::new();
        for expected_attempt in 1..=3 {
            let (decision, message) = tracker.record_crash("boom");
            assert_eq!(
                decision,
                RecoveryDecision::Restart {
                    attempt: expected_attempt,
                    delay: backoff_for_attempt(expected_attempt - 1),
                }
            );
            assert!(message.contains(&format!("attempt {expected_attempt} of 3")));
            assert_eq!(tracker.consecutive_crashes(), expected_attempt);
        }
        let (decision, message) = tracker.record_crash("boom");
        assert_eq!(decision, RecoveryDecision::GiveUp { attempts: 3 });
        assert!(message.contains("stopped after 3 restart attempts"));
        // Further crashes keep giving up: no silent restart past the budget.
        let (decision, _) = tracker.record_crash("boom");
        assert_eq!(decision, RecoveryDecision::GiveUp { attempts: 3 });
    }

    #[test]
    fn tracker_resets_on_healthy() {
        let mut tracker = CrashRecoveryTracker::new();
        let _ = tracker.record_crash("boom");
        let _ = tracker.record_crash("boom");
        assert_eq!(tracker.consecutive_crashes(), 2);
        tracker.record_healthy();
        assert_eq!(tracker.consecutive_crashes(), 0);
        // Full budget available again after a healthy load.
        let (decision, _) = tracker.record_crash("boom");
        assert_eq!(
            decision,
            RecoveryDecision::Restart {
                attempt: 1,
                delay: Duration::from_millis(500),
            }
        );
    }

    #[test]
    fn tracker_with_zero_budget_never_restarts() {
        let mut tracker = CrashRecoveryTracker::with_max_restarts(0);
        let (decision, _) = tracker.record_crash("boom");
        assert_eq!(decision, RecoveryDecision::GiveUp { attempts: 0 });
    }
}
