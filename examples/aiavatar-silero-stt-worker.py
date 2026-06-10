#!/usr/bin/env python3
"""IroHarness-owned AIAvatarKit Silero/OpenAI STT worker.

The worker exposes the IroHarness HTTP streaming STT contract while delegating
voice activity and recognition to AIAvatarKit's SileroStreamSpeechDetector.
"""

import argparse
import asyncio
import base64
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

from aiavatar.sts.stt.openai import OpenAISpeechRecognizer
from aiavatar.sts.vad.stream import SileroStreamSpeechDetector


LOGGER = logging.getLogger("iroharness.aiavatar_silero_stt")


def _audio_bytes(audio: Any) -> bytes:
    if isinstance(audio, str):
        return base64.b64decode(audio)
    if isinstance(audio, dict):
        data = audio.get("dataBase64") or audio.get("audioBase64") or audio.get("audio_data") or ""
        return base64.b64decode(data)
    return b""


class AiAvatarSileroSttRuntime:
    def __init__(
        self,
        *,
        openai_api_key: str,
        openai_model: str,
        language: str,
        sample_rate: int,
        channels: int,
        chunk_size: int,
        segment_silence_threshold: float,
        silence_duration_threshold: float,
        max_duration: float,
        min_duration: float,
        use_vad_iterator: bool,
        flush_silence_ms: int,
        debug: bool,
    ):
        if not openai_api_key:
            raise ValueError("OPENAI_API_KEY is required for aiavatar-silero-openai STT.")

        self.sample_rate = sample_rate
        self.channels = channels
        self.chunk_size = chunk_size
        self.flush_silence_ms = flush_silence_ms
        self._events: dict[str, list[dict[str, Any]]] = {}
        self._lock = threading.Lock()
        self._ready = threading.Event()
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._run_loop,
            kwargs={
                "openai_api_key": openai_api_key,
                "openai_model": openai_model,
                "language": language,
                "segment_silence_threshold": segment_silence_threshold,
                "silence_duration_threshold": silence_duration_threshold,
                "max_duration": max_duration,
                "min_duration": min_duration,
                "use_vad_iterator": use_vad_iterator,
                "debug": debug,
            },
            daemon=True,
        )
        self._thread.start()
        self._ready.wait(timeout=60)
        if not self._ready.is_set():
            raise TimeoutError("Timed out while starting AIAvatar Silero STT runtime.")

    def _append_event(self, session_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            queue = self._events.get(session_id, [])
            self._events[session_id] = [*queue, event]

    def _drain_events(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock:
            events = self._events.get(session_id, [])
            self._events[session_id] = []
            return events

    def _run_loop(self, **config: Any) -> None:
        asyncio.set_event_loop(self._loop)
        recognizer = OpenAISpeechRecognizer(
            openai_api_key=config["openai_api_key"],
            model=config["openai_model"],
            sample_rate=self.sample_rate,
            language=config["language"],
            debug=config["debug"],
        )
        self.detector = SileroStreamSpeechDetector(
            speech_recognizer=recognizer,
            segment_silence_threshold=config["segment_silence_threshold"],
            silence_duration_threshold=config["silence_duration_threshold"],
            max_duration=config["max_duration"],
            min_duration=config["min_duration"],
            sample_rate=self.sample_rate,
            channels=self.channels,
            chunk_size=self.chunk_size,
            use_vad_iterator=config["use_vad_iterator"],
            debug=config["debug"],
        )

        @self.detector.on_voiced
        async def on_voiced(session_id: str) -> None:
            self._append_event(
                session_id,
                {
                    "type": "stt.partial",
                    "text": "",
                    "delta": "",
                    "final": False,
                    "voiced": True,
                    "source": "aiavatar-silero",
                },
            )

        @self.detector.on_speech_detecting
        async def on_speech_detecting(text: str, session: Any) -> None:
            self._append_event(
                session.session_id,
                {
                    "type": "stt.partial",
                    "text": text or "",
                    "delta": text or "",
                    "final": False,
                    "source": "aiavatar-silero-openai",
                },
            )

        @self.detector.on_speech_detected
        async def on_speech_detected(
            data: bytes,
            text: str,
            metadata: Optional[dict[str, Any]],
            recorded_duration: float,
            session_id: str,
        ) -> None:
            self._append_event(
                session_id,
                {
                    "type": "stt.final",
                    "text": text or "",
                    "delta": text or "",
                    "final": True,
                    "duration": recorded_duration,
                    "source": "aiavatar-silero-openai",
                    "audioBytes": len(data or b""),
                    "metadata": metadata or {},
                },
            )

        @self.detector.on_speech_recognition_error
        async def on_speech_recognition_error(error: Exception, session_id: str) -> None:
            self._append_event(
                session_id,
                {
                    "type": "stt.error",
                    "text": "",
                    "final": False,
                    "message": str(error),
                    "source": "aiavatar-silero-openai",
                },
            )

        self._ready.set()
        self._loop.run_forever()

    async def _push_async(self, session_id: str, pcm: bytes) -> list[dict[str, Any]]:
        if pcm:
            await self.detector.process_samples(pcm, session_id)
            await asyncio.sleep(0)
        return self._drain_events(session_id)

    async def _end_async(self, session_id: str) -> list[dict[str, Any]]:
        if self.flush_silence_ms > 0:
            silence_samples = int(self.sample_rate * self.flush_silence_ms / 1000)
            silence = b"\x00\x00" * max(self.chunk_size, silence_samples)
            for offset in range(0, len(silence), self.chunk_size * 2):
                await self.detector.process_samples(silence[offset : offset + self.chunk_size * 2], session_id)
                await asyncio.sleep(0)
        events = self._drain_events(session_id)
        reset = getattr(self.detector, "reset_session_audio_state", None)
        if callable(reset):
            reset(session_id)
        await self.detector.finalize_session(session_id)
        return events

    def push(self, *, session_id: str, pcm: bytes) -> list[dict[str, Any]]:
        future = asyncio.run_coroutine_threadsafe(self._push_async(session_id, pcm), self._loop)
        return future.result(timeout=60)

    def end(self, *, session_id: str) -> list[dict[str, Any]]:
        future = asyncio.run_coroutine_threadsafe(self._end_async(session_id), self._loop)
        return future.result(timeout=60)


def _send_json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def create_handler(runtime: AiAvatarSileroSttRuntime):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path != "/health":
                _send_json(self, 404, {"error": "not_found"})
                return
            _send_json(self, 200, {"ok": True, "provider": "aiavatar-silero-openai"})

        def do_POST(self) -> None:
            if self.path != "/stt":
                _send_json(self, 404, {"error": "not_found"})
                return
            try:
                length = int(self.headers.get("content-length") or "0")
                payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
                session_id = payload.get("session_id") or payload.get("sessionId") or "default"
                if payload.get("type") == "end":
                    events = runtime.end(session_id=session_id)
                else:
                    events = runtime.push(session_id=session_id, pcm=_audio_bytes(payload.get("audio")))
                _send_json(self, 200, {"events": events})
            except Exception as error:
                LOGGER.exception("STT request failed")
                _send_json(
                    self,
                    500,
                    {
                        "events": [
                            {
                                "type": "stt.error",
                                "text": "",
                                "final": False,
                                "message": str(error),
                                "source": "aiavatar-silero-openai",
                            }
                        ]
                    },
                )

        def log_message(self, fmt: str, *args: Any) -> None:
            LOGGER.info("%s - %s", self.address_string(), fmt % args)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "4183")))
    parser.add_argument("--model", default=os.environ.get("OPENAI_STT_MODEL", "gpt-4o-mini-transcribe"))
    parser.add_argument("--language", default=os.environ.get("OPENAI_STT_LANGUAGE", "ja"))
    parser.add_argument("--sample-rate", type=int, default=int(os.environ.get("IROHARNESS_STACKCHAN_AUDIO_SAMPLE_RATE", "16000")))
    parser.add_argument("--channels", type=int, default=int(os.environ.get("IROHARNESS_STACKCHAN_AUDIO_CHANNELS", "1")))
    parser.add_argument("--chunk-size", type=int, default=int(os.environ.get("IROHARNESS_STACKCHAN_SILERO_CHUNK_SIZE", "512")))
    parser.add_argument(
        "--segment-silence-threshold",
        type=float,
        default=float(os.environ.get("IROHARNESS_STACKCHAN_SILERO_SEGMENT_SILENCE_THRESHOLD", "0.05")),
    )
    parser.add_argument(
        "--silence-duration-threshold",
        type=float,
        default=float(os.environ.get("IROHARNESS_STACKCHAN_SILERO_SILENCE_DURATION_THRESHOLD", "0.5")),
    )
    parser.add_argument("--max-duration", type=float, default=float(os.environ.get("IROHARNESS_STACKCHAN_SILERO_MAX_DURATION", "30")))
    parser.add_argument("--min-duration", type=float, default=float(os.environ.get("IROHARNESS_STACKCHAN_SILERO_MIN_DURATION", "0.2")))
    parser.add_argument("--flush-silence-ms", type=int, default=int(os.environ.get("IROHARNESS_STACKCHAN_SILERO_FLUSH_SILENCE_MS", "700")))
    parser.add_argument("--debug", action="store_true", default=os.environ.get("IROHARNESS_STACKCHAN_SILERO_DEBUG") == "1")
    args = parser.parse_args()

    logging.basicConfig(level=logging.DEBUG if args.debug else logging.INFO)
    runtime = AiAvatarSileroSttRuntime(
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        openai_model=args.model,
        language=args.language,
        sample_rate=args.sample_rate,
        channels=args.channels,
        chunk_size=args.chunk_size,
        segment_silence_threshold=args.segment_silence_threshold,
        silence_duration_threshold=args.silence_duration_threshold,
        max_duration=args.max_duration,
        min_duration=args.min_duration,
        use_vad_iterator=os.environ.get("IROHARNESS_STACKCHAN_SILERO_USE_VAD_ITERATOR", "1") != "0",
        flush_silence_ms=args.flush_silence_ms,
        debug=args.debug,
    )
    server = ThreadingHTTPServer((args.host, args.port), create_handler(runtime))
    LOGGER.info("AIAvatar Silero STT worker listening on http://%s:%s/stt", args.host, args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
