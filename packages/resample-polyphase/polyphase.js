// Polyphase FIR rational resampling — upsample L, Kaiser-windowed sinc lowpass at
// π/max(L,M), downsample M, computed directly from the phase decomposition (no zero
// stuffing). Streaming variant carries filter history across chunks: chunked output
// is bit-identical to batch, which windowed one-shot interpolators can't offer.

const ZC = 16                         // zero crossings each side of the lowpass, at the lower rate

// Taps per phase: 2·ZC input samples, widened by M/L on downsample so the lowpass at the output's Nyquist keeps
// ZC crossings each side (32 at 44.1→48, 64 at 2:1, 96 at 3:1). At 32 for any ratio, 3:1 had a -35 dB alias floor
const tapsFor = (L, M) => 2 * Math.ceil(ZC * Math.max(1, M / L))

// modified Bessel I0 (series) — Kaiser window support
function i0 (x) {
	let s = 1, t = 1, k = 0
	while (t > 1e-12 * s) { k++; t *= (x / (2 * k)) ** 2; s += t }
	return s
}

const gcd = (a, b) => b ? gcd(b, a % b) : a

/** Prototype lowpass decomposed into L phases of `taps` taps: h[p][k] = proto[k·L + p]. */
function design (L, M, taps) {
	let n = taps * L, D = taps >> 1
	// centered on L·D, the delay the read compensates: at (n − 1) / 2 every output would land 1/(2L) input samples
	// early, half a sample at 2:1. Tap n (= 2·L·D) falls off the end, where the window is 1/I0(β)
	let c = L * D
	let fc = Math.min(1, L / M) / L       // cycles/sample at the L·fs rate
	let beta = 8.6                        // ~85 dB stopband
	let ib = i0(beta)
	let proto = new Float64Array(n)
	for (let i = 0; i < n; i++) {
		let x = i - c
		let sinc = x === 0 ? 1 : Math.sin(Math.PI * fc * x) / (Math.PI * fc * x)
		let r = (i - c) / c
		proto[i] = fc * L * sinc * i0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / ib
	}
	let phases = []
	for (let p = 0; p < L; p++) {
		let h = new Float32Array(taps)
		for (let k = 0; k < taps; k++) h[k] = proto[k * L + p]
		phases.push(h)
	}
	return phases
}

// outputs m0 … m0 + n − 1 of a chunk whose first sample is input c: output m the taps of phase m·M mod L over the
// inputs from its base down. The phase and the base's place in the chunk (o) carried from one output to the next in
// small integers: m·M passes 2^31 in minutes, and an index that is not one costs every tap
function fir (data, c, hist, phases, taps, D, L, M, m0, n) {
	let out = new Float32Array(n), o = (Math.floor(m0 * M / L) + D - c) | 0, p = (m0 * M % L) | 0
	for (let j = 0; j < n; j++) {
		let h = phases[p], sum = 0
		// every tap within this chunk: read straight from it; else some are in the history, or before the start
		if (o >= taps - 1) for (let k = 0; k < taps; k++) sum += h[k] * data[o - k]
		else for (let k = 0; k < taps; k++) {
			let rel = o - k
			if (rel + c < 0) break
			sum += h[k] * (rel >= 0 ? data[rel] : hist[taps + rel])
		}
		out[j] = sum
		p += M
		if (p >= L) { let s = (p / L) | 0; o += s; p -= s * L }
	}
	return out
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
	let taps = from === to ? 0 : tapsFor(L, M), D = taps >> 1   // D: group-delay compensation, input samples
	let phases = taps ? design(L, M, taps) : null
	let hist = new Float32Array(taps)      // last `taps` input samples seen
	let consumed = 0                       // input samples consumed so far (absolute)
	let m = 0                              // next global output index

	// output m: phase p = m·M mod L, taps read absolute inputs (base+D−k), k = 0..taps−1,
	// where base = floor(m·M / L); D recenters the causal window (group-delay comp).
	// Outputs while base < avail: m up to ⌈(avail − D)·L / M⌉, the first `keep` of them made
	function run (data, avail, keep = Infinity) {
		if (!phases) return Float32Array.from(data)
		let n = Math.max(0, Math.ceil((avail - D) * L / M) - m)
		let out = fir(data, consumed, hist, phases, taps, D, L, M, m, Math.min(n, keep))
		m += n
		if (data.length >= taps) hist.set(data.subarray(data.length - taps))
		else { hist.copyWithin(0, data.length); hist.set(data, taps - data.length) }
		consumed += data.length
		return out
	}

	return {
		write: (chunk) => run(chunk, consumed + chunk.length),
		flush () {
			let expect = Math.round(consumed * L / M)
			// the outputs up to the input's end alone: those after it would read past the padding
			return run(new Float32Array(taps), consumed + taps + D, Math.max(0, expect - m))
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
