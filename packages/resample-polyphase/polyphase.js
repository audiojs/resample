// Polyphase FIR rational resampling — upsample L, Kaiser-windowed sinc lowpass at
// π/max(L,M), downsample M, computed directly from the phase decomposition (no zero
// stuffing). Streaming variant carries filter history across chunks: chunked output
// is bit-identical to batch, which windowed one-shot interpolators can't offer.

const TAPS = 32                       // per phase — 16 zero crossings each side
const D = TAPS >> 1                   // group-delay compensation, input samples

// modified Bessel I0 (series) — Kaiser window support
function i0 (x) {
	let s = 1, t = 1, k = 0
	while (t > 1e-12 * s) { k++; t *= (x / (2 * k)) ** 2; s += t }
	return s
}

const gcd = (a, b) => b ? gcd(b, a % b) : a

/** Prototype lowpass decomposed into L phases of TAPS taps: h[p][k] = proto[k·L + p]. */
function design (L, M) {
	let n = TAPS * L
	let c = (n - 1) / 2
	let fc = Math.min(1, L / M) / L       // cycles/sample at the L·fs rate
	let beta = 8.6                        // ~85 dB stopband
	let ib = i0(beta)
	let proto = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let x = i - c
		let sinc = x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x)
		let r = 2 * i / (n - 1) - 1
		proto[i] = fc * L * sinc * i0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / ib
	}
	let phases = []
	for (let p = 0; p < L; p++) {
		let h = new Float32Array(TAPS)
		for (let k = 0; k < TAPS; k++) h[k] = proto[k * L + p]
		phases.push(h)
	}
	return phases
}

/**
 * Streaming rational resampler — write(chunk) returns output ready so far, flush()
 * drains the tail. Chunked concatenation ≡ batch output exactly.
 * @param {object} opts — { from, to } sample rates
 */
export function stream ({ from, to } = {}) {
	if (!(from > 0) || !(to > 0)) throw new RangeError('resample: from/to must be positive sample rates')
	let g = gcd(Math.round(from), Math.round(to))
	let L = Math.round(to) / g, M = Math.round(from) / g
	let phases = from === to ? null : design(L, M)
	let hist = new Float32Array(TAPS)      // last TAPS input samples seen
	let consumed = 0                       // input samples consumed so far (absolute)
	let m = 0                              // next global output index

	// output m: phase p = m·M mod L, taps read absolute inputs (base+D−k), k = 0..TAPS−1,
	// where base = floor(m·M / L); D recenters the causal window (group-delay comp)
	function run (data, avail) {
		if (!phases) return Float32Array.from(data)
		let out = []
		while (Math.floor(m * M / L) + D < avail) {
			let up = m * M
			let base = Math.floor(up / L) + D
			let h = phases[up % L], sum = 0
			for (let k = 0; k < TAPS; k++) {
				let idx = base - k
				if (idx < 0) break
				let rel = idx - consumed
				sum += h[k] * (rel >= 0 ? data[rel] : hist[TAPS + rel])
			}
			out.push(sum)
			m++
		}
		if (data.length >= TAPS) hist.set(data.subarray(data.length - TAPS))
		else { hist.copyWithin(0, data.length); hist.set(data, TAPS - data.length) }
		consumed += data.length
		return Float32Array.from(out)
	}

	return {
		write: (chunk) => run(chunk, consumed + chunk.length),
		flush () {
			let expect = Math.round(consumed * L / M)
			let pad = new Float32Array(TAPS)
			let tail = run(pad, consumed + TAPS + D)
			return tail.subarray(0, Math.max(0, expect - (m - tail.length)))
		},
	}
}

/**
 * @param {Float32Array} data — mono PCM
 * @param {object} opts — { from, to } sample rates
 * @returns {Float32Array} resampled copy, length round(n·to/from)
 */
export default function polyphase (data, opts = {}) {
	let s = stream(opts)
	let a = s.write(data), b = s.flush()
	let n = Math.round(data.length * (opts.to / opts.from))
	let out = new Float32Array(n)
	out.set(a.subarray(0, Math.min(a.length, n)))
	if (a.length < n) out.set(b.subarray(0, Math.min(b.length, n - a.length)), a.length)
	return out
}
