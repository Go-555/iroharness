use std::collections::VecDeque;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RealtimeEventKind {
    AudioReceived,
    SttPartial,
    SttFinal,
    LlmFirstToken,
    TtsFirstAudio,
    TtsAudio,
    TtsInterrupted,
    DeviceState,
    BargeIn,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeEvent {
    pub kind: RealtimeEventKind,
    pub session_id: String,
    pub sequence: u64,
    pub payload: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AudioChunk {
    pub session_id: String,
    pub sequence: u64,
    pub sample_rate_hz: u32,
    pub channels: u16,
    pub pcm: Vec<i16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DeviceCommandKind {
    State,
    Speech,
    Interrupt,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceCommand {
    pub kind: DeviceCommandKind,
    pub target: String,
    pub payload: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LatencyMeasure {
    pub name: String,
    pub duration: Duration,
}

#[derive(Debug)]
pub struct RealtimeBus {
    next_sequence: u64,
    events: VecDeque<RealtimeEvent>,
    max_events: usize,
}

impl RealtimeBus {
    pub fn new(max_events: usize) -> Self {
        Self {
            next_sequence: 0,
            events: VecDeque::with_capacity(max_events),
            max_events,
        }
    }

    pub fn push(
        &mut self,
        session_id: impl Into<String>,
        kind: RealtimeEventKind,
        payload: impl Into<String>,
    ) -> RealtimeEvent {
        let event = RealtimeEvent {
            kind,
            session_id: session_id.into(),
            sequence: self.next_sequence,
            payload: payload.into(),
        };
        self.next_sequence += 1;
        if self.max_events > 0 && self.events.len() == self.max_events {
            self.events.pop_front();
        }
        if self.max_events > 0 {
            self.events.push_back(event.clone());
        }
        event
    }

    pub fn snapshot(&self) -> Vec<RealtimeEvent> {
        self.events.iter().cloned().collect()
    }
}

#[derive(Debug, Default)]
pub struct BargeInGate {
    speaking: bool,
    interrupted: bool,
}

impl BargeInGate {
    pub fn start_speaking(&mut self) {
        self.speaking = true;
        self.interrupted = false;
    }

    pub fn finish_speaking(&mut self) {
        self.speaking = false;
    }

    pub fn observe_stt_partial(&mut self, text: &str) -> bool {
        if self.speaking && !text.trim().is_empty() {
            self.interrupted = true;
            self.speaking = false;
            return true;
        }
        false
    }

    pub fn interrupted(&self) -> bool {
        self.interrupted
    }
}

#[derive(Debug)]
pub struct LatencyTracker {
    started_at: Instant,
    marks: Vec<(String, Instant)>,
}

impl Default for LatencyTracker {
    fn default() -> Self {
        Self::new()
    }
}

impl LatencyTracker {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
            marks: Vec::new(),
        }
    }

    pub fn mark(&mut self, name: impl Into<String>) {
        self.marks.push((name.into(), Instant::now()));
    }

    pub fn measure_from_start(&self, name: impl Into<String>) -> Option<LatencyMeasure> {
        let metric_name = name.into();
        self.marks
            .iter()
            .find(|(mark_name, _)| *mark_name == metric_name)
            .map(|(mark_name, at)| LatencyMeasure {
                name: mark_name.clone(),
                duration: at.duration_since(self.started_at),
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bus_keeps_bounded_events() {
        let mut bus = RealtimeBus::new(2);
        bus.push("s1", RealtimeEventKind::AudioReceived, "a");
        bus.push("s1", RealtimeEventKind::SttPartial, "b");
        bus.push("s1", RealtimeEventKind::SttFinal, "c");

        let snapshot = bus.snapshot();
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].sequence, 1);
        assert_eq!(snapshot[1].payload, "c");
    }

    #[test]
    fn barge_in_gate_interrupts_speaking_on_partial_text() {
        let mut gate = BargeInGate::default();
        gate.start_speaking();

        assert!(gate.observe_stt_partial("wait"));
        assert!(gate.interrupted());
    }
}
