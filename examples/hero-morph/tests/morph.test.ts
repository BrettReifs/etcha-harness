import { test } from 'node:test'
import assert from 'node:assert/strict'
import { complete, MORPH_DURATION, sample, transitionTo } from '../src/state.ts'
import { attachment, interpolateVertices, PARTS, RINGS, SEGMENTS, surface, vertices } from '../src/shape.ts'

test('equipment targets, timing, clamps and reduced motion are deterministic', () => {
  const t = transitionTo(0, 'seed', 100, false)
  assert.equal(t.duration, MORPH_DURATION)
  assert.equal(sample(t, 0), 0)
  assert.equal(sample(t, 100 + MORPH_DURATION / 2), 0.5)
  assert.equal(sample(t, 2000), 1)
  assert.equal(complete(t, 949), false)
  assert.equal(complete(t, 950), true)
  assert.equal(sample(transitionTo(0.2, 'none', 10, true), 10), 0)
})

test('interruptions reverse from the exact current shape without a jump', () => {
  let t = transitionTo(0, 'seed', 0, false)
  const middle = sample(t, 400)
  t = transitionTo(middle, 'none', 400, false)
  assert.equal(sample(t, 400), middle)
  assert.ok(sample(t, 450) < middle)
  assert.equal(sample(t, 2000), 0)
  const repeated = transitionTo(1, 'seed', 0, false)
  assert.equal(repeated.duration, 0)
  assert.equal(sample(repeated, 0), 1)
})

test('all six parts deform with fixed finite topology and reversible endpoints', () => {
  for (const part of PARTS) {
    const base = vertices(part, 0)
    const seed = vertices(part, 1)
    assert.equal(base.length, (RINGS + 1) * (SEGMENTS + 1) * 3)
    assert.equal(base.length, seed.length)
    assert.notDeepEqual(base, seed)
    assert.ok([...base, ...seed].every(Number.isFinite))
    const result = new Float32Array(base.length)
    interpolateVertices(base, seed, 0.5, result)
    for (let i = 0; i < result.length; i++) assert.ok(Math.abs(result[i]! - (base[i]! + seed[i]!) / 2) < 1e-6)
    interpolateVertices(base, seed, 1, result)
    assert.deepEqual(result, seed)
    interpolateVertices(base, seed, 0, result)
    assert.deepEqual(result, base)
  }
})

test('attachments follow the deformed surface throughout the morph', () => {
  for (const amount of [0, 0.1, 0.5, 0.9, 1]) {
    for (const [name, part, v, angle] of [
      ['leftEye', 'head', 0.53, -0.29], ['rightEye', 'head', 0.53, 0.29],
      ['mouth', 'head', 0.42, 0], ['badge', 'body', 0.65, -0.38],
    ] as const) {
      const point = attachment(name, amount)
      const expected = surface(part, v, angle, amount)
      assert.ok(Math.abs(point[0] - expected[0]) < 1e-8)
      assert.ok(Math.abs(point[1] - expected[1]) < 1e-8)
      assert.ok(Math.abs(point[2] - expected[2] - 0.025) < 1e-8)
    }
  }
})
