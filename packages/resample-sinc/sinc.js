// Windowed-sinc (Lanczos, 32-tap) resampling with kernel widening on downsample —
// aliases are suppressed by the widened kernel, no separate lowpass needed.
// Ported from the audio-core interpolator (same math, standalone API).

const HALF = 16
const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)

export default function resample (data, { from, to } = {}) {
	if (!(from > 0) || !(to > 0)) throw new RangeError('resample: from/to must be positive sample rates')
	if (from === to) return Float32Array.from(data)

	let rate = from / to                    // input samples per output sample
	let n = Math.round(data.length * to / from)
	let out = new Float32Array(n)
	let scale = rate > 1 ? 1 / rate : 1     // widen kernel when downsampling (anti-alias)

	for (let i = 0; i < n; i++) {
		let pos = i * rate
		let base = Math.floor(pos), frac = pos - base
		let sum = 0, w = 0
		for (let t = 1 - HALF; t <= HALF; t++) {
			let idx = base + t
			if (idx < 0 || idx >= data.length) continue
			let x = (t - frac) * scale
			let k = sinc(x) * sinc(x / HALF)
			sum += data[idx] * k; w += k
		}
		out[i] = w !== 0 ? sum / w : 0
	}
	return out
}
