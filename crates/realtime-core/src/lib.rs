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

impl RealtimeEventKind {
    pub fn from_code(code: u32) -> Self {
        match code {
            0 => Self::AudioReceived,
            1 => Self::SttPartial,
            2 => Self::SttFinal,
            3 => Self::LlmFirstToken,
            4 => Self::TtsFirstAudio,
            5 => Self::TtsAudio,
            6 => Self::TtsInterrupted,
            7 => Self::DeviceState,
            8 => Self::BargeIn,
            _ => Self::DeviceState,
        }
    }
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

#[derive(Debug)]
pub struct RealtimeCore {
    bus: RealtimeBus,
    barge_in: BargeInGate,
    latency: LatencyTracker,
}

impl RealtimeCore {
    pub fn new(max_events: usize) -> Self {
        Self {
            bus: RealtimeBus::new(max_events),
            barge_in: BargeInGate::default(),
            latency: LatencyTracker::new(),
        }
    }

    pub fn publish_kind(&mut self, kind: RealtimeEventKind) -> u64 {
        let event = self.bus.push("rust-realtime-core", kind, "");
        event.sequence
    }

    pub fn events_len(&self) -> usize {
        self.bus.snapshot().len()
    }

    pub fn mark_now(&mut self, name: impl Into<String>) {
        self.latency.mark(name);
    }

    pub fn start_speaking(&mut self) {
        self.barge_in.start_speaking();
    }

    pub fn finish_speaking(&mut self) {
        self.barge_in.finish_speaking();
    }

    pub fn observe_stt_partial_len(&mut self, text_len: usize) -> bool {
        if text_len == 0 {
            return false;
        }
        self.barge_in.observe_stt_partial("partial")
    }

    pub fn interrupted(&self) -> bool {
        self.barge_in.interrupted()
    }
}

#[no_mangle]
pub extern "C" fn iroharness_realtime_core_new(max_events: usize) -> *mut RealtimeCore {
    Box::into_raw(Box::new(RealtimeCore::new(max_events)))
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_free(core: *mut RealtimeCore) {
    if !core.is_null() {
        drop(unsafe { Box::from_raw(core) });
    }
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_publish(
    core: *mut RealtimeCore,
    event_kind_code: u32,
) -> u64 {
    match unsafe { core.as_mut() } {
        Some(core) => core.publish_kind(RealtimeEventKind::from_code(event_kind_code)),
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_events_len(core: *const RealtimeCore) -> usize {
    match unsafe { core.as_ref() } {
        Some(core) => core.events_len(),
        None => 0,
    }
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_start_speaking(core: *mut RealtimeCore) {
    if let Some(core) = unsafe { core.as_mut() } {
        core.start_speaking();
    }
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_finish_speaking(core: *mut RealtimeCore) {
    if let Some(core) = unsafe { core.as_mut() } {
        core.finish_speaking();
    }
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_observe_stt_partial_len(
    core: *mut RealtimeCore,
    text_len: usize,
) -> bool {
    match unsafe { core.as_mut() } {
        Some(core) => core.observe_stt_partial_len(text_len),
        None => false,
    }
}

#[no_mangle]
pub unsafe extern "C" fn iroharness_realtime_core_interrupted(core: *const RealtimeCore) -> bool {
    match unsafe { core.as_ref() } {
        Some(core) => core.interrupted(),
        None => false,
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

    #[test]
    fn native_core_c_abi_keeps_realtime_state() {
        let mut core = RealtimeCore::new(2);

        assert_eq!(core.publish_kind(RealtimeEventKind::AudioReceived), 0);
        assert_eq!(core.publish_kind(RealtimeEventKind::SttPartial), 1);
        assert_eq!(core.events_len(), 2);

        core.start_speaking();
        assert!(core.observe_stt_partial_len(4));
        assert!(core.interrupted());
    }
}
