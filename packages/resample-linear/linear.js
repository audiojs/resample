// Linear-interpolation resampling — cheap, real-time.
// No anti-alias filter: use @audio/resample-sinc when downsampling.

export default function resample (data, { from, to } = {}) {
	if (!(from > 0) || !(to > 0)) throw new RangeError('resample: from/to must be positive sample rates')
	if (from === to) return Float32Array.from(data)

	let rate = from / to
	let n = Math.round(data.length * to / from)
	let out = new Float32Array(n)

	for (let i = 0; i < n; i++) {
		let pos = i * rate
		let base = Math.floor(pos), frac = pos - base
		let a = data[base] ?? 0
		let b = base + 1 < data.length ? data[base + 1] : a
		out[i] = a + (b - a) * frac
	}
	return out
}
