use std::io::{self, BufRead};

use iroharness_realtime_core::{
    BargeInGate, LatencyTracker, RealtimeBus, RealtimeEventKind,
};

fn escape_json(value: &str) -> String {
    value
        .chars()
        .flat_map(|character| match character {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect::<Vec<_>>(),
            '\n' => "\\n".chars().collect::<Vec<_>>(),
            '\r' => "\\r".chars().collect::<Vec<_>>(),
            '\t' => "\\t".chars().collect::<Vec<_>>(),
            other => vec![other],
        })
        .collect()
}

fn string_field(line: &str, field: &str) -> Option<String> {
    let needle = format!("\"{}\"", field);
    let start = line.find(&needle)?;
    let after_field = &line[start + needle.len()..];
    let colon = after_field.find(':')?;
    let after_colon = after_field[colon + 1..].trim_start();
    if !after_colon.starts_with('"') {
        return None;
    }
    let mut escaped = false;
    let mut value = String::new();
    for character in after_colon[1..].chars() {
        if escaped {
            value.push(character);
            escaped = false;
            continue;
        }
        if character == '\\' {
            escaped = true;
            continue;
        }
        if character == '"' {
            return Some(value);
        }
        value.push(character);
    }
    None
}

fn bool_field(line: &str, field: &str) -> Option<bool> {
    let needle = format!("\"{}\"", field);
    let start = line.find(&needle)?;
    let after_field = &line[start + needle.len()..];
    let colon = after_field.find(':')?;
    let after_colon = after_field[colon + 1..].trim_start();
    if after_colon.starts_with("true") {
        return Some(true);
    }
    if after_colon.starts_with("false") {
        return Some(false);
    }
    None
}

fn event_kind(event_type: &str) -> RealtimeEventKind {
    match event_type {
        "audio.received" | "realtime.listening" => RealtimeEventKind::AudioReceived,
        "stt.partial" => RealtimeEventKind::SttPartial,
        "stt.final" => RealtimeEventKind::SttFinal,
        "llm.first_token" => RealtimeEventKind::LlmFirstToken,
        "tts.first_audio" => RealtimeEventKind::TtsFirstAudio,
        "tts.audio" => RealtimeEventKind::TtsAudio,
        "tts.interrupted" | "realtime.interrupted" => RealtimeEventKind::TtsInterrupted,
        "realtime.barge_in" => RealtimeEventKind::BargeIn,
        _ => RealtimeEventKind::DeviceState,
    }
}

fn main() {
    let stdin = io::stdin();
    let mut bus = RealtimeBus::new(256);
    let mut barge_in = BargeInGate::default();
    let mut latency = LatencyTracker::new();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(value) => value,
            Err(error) => {
                println!(
                    "{{\"type\":\"error\",\"message\":\"{}\"}}",
                    escape_json(&error.to_string())
                );
                continue;
            }
        };
        let op = string_field(&line, "op").unwrap_or_else(|| "unknown".to_string());
        let core_id = string_field(&line, "coreId").unwrap_or_else(|| "realtime-core".to_string());
        let event_type = string_field(&line, "type").unwrap_or_default();

        match op.as_str() {
            "publish" => {
                bus.push(core_id.clone(), event_kind(&event_type), &line);
            }
            "mark" => {
                if let Some(name) = string_field(&line, "name") {
                    latency.mark(name);
                }
            }
            "startSpeaking" => {
                barge_in.start_speaking();
            }
            "finishSpeaking" => {
                barge_in.finish_speaking();
            }
            "shouldInterrupt" => {
                if bool_field(&line, "result").unwrap_or(false) {
                    barge_in.observe_stt_partial("external-barge-in");
                }
            }
            _ => {}
        }

        println!(
            "{{\"type\":\"ack\",\"op\":\"{}\",\"coreId\":\"{}\",\"eventType\":\"{}\",\"events\":{},\"interrupted\":{}}}",
            escape_json(&op),
            escape_json(&core_id),
            escape_json(&event_type),
            bus.snapshot().len(),
            barge_in.interrupted()
        );
    }
}
