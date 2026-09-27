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
	// where base = floor(m·M / L); D recenters the causal window (group-delay comp)
	function run (data, avail) {
		if (!phases) return Float32Array.from(data)
		let out = []
		while (Math.floor(m * M / L) + D < avail) {
			let up = m * M
			let base = Math.floor(up / L) + D
			let h = phases[up % L], sum = 0
			for (let k = 0; k < taps; k++) {
				let idx = base - k
				if (idx < 0) break
				let rel = idx - consumed
				sum += h[k] * (rel >= 0 ? data[rel] : hist[taps + rel])
			}
			out.push(sum)
			m++
		}
		if (data.length >= taps) hist.set(data.subarray(data.length - taps))
		else { hist.copyWithin(0, data.length); hist.set(data, taps - data.length) }
		consumed += data.length
		return Float32Array.from(out)
	}

	return {
		write: (chunk) => run(chunk, consumed + chunk.length),
		flush () {
			let expect = Math.round(consumed * L / M)
			let pad = new Float32Array(taps)
			let tail = run(pad, consumed + taps + D)
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
