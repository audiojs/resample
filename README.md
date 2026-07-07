# @audio/resample

> Sample-rate conversion. All planned.

| Package | What |
|---|---|
| `@audio/resample-sinc` | windowed-sinc, anti-aliased |
| `@audio/resample-linear` | linear interpolation, real-time |
| `@audio/resample-polyphase` | polyphase FIR, streaming rational rates |

A tested implementation exists in the `audio` package (sinc ↑↓ + linear: pitch preserved, round-trip energy 0.0% loss, anti-alias verified at Nyquist) — extract, don't rewrite. `pcm-convert`'s sampleRate is metadata-only today (its backlog wants this). Differential-test vs libsamplerate. Streaming atoms feed the voice-agent 48↔16/24 kHz path (OpenAI Realtime / LiveKit / Pipecat plumbing).
