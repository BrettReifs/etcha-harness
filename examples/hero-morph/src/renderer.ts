import * as THREE from 'three'
import { createHero } from './assets.ts'
import { complete, sample, transitionTo } from './state.ts'
import type { Equipment } from './state.ts'

export type RenderStatus = 'loading' | 'ready' | 'unavailable' | 'lost'

export function mountHero(host: HTMLElement, onStatus: (status: RenderStatus) => void) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  let reduced = motion.matches
  let equipment: Equipment = 'none'
  let transition = transitionTo(0, equipment, performance.now(), reduced)
  let disposed = false
  let offscreen = false
  let pageSuspended = false
  let lost = false
  let raf = 0
  let frames = 0
  let status: RenderStatus = 'loading'
  let renderer: THREE.WebGLRenderer | undefined
  const hero = createHero()
  const scene = new THREE.Scene()
  scene.add(hero.group)
  scene.add(new THREE.HemisphereLight('#fffcf1', '#8d8294', 2.7))
  const key = new THREE.DirectionalLight('#fff5dc', 3.4)
  key.position.set(-3, 6, 5)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 40)
  camera.position.set(0, 2.5, 9)
  camera.lookAt(0, 2.1, 0)
  function setStatus(next: RenderStatus) {
    status = next
    onStatus(next)
  }
  function visible() {
    return !document.hidden && !offscreen && !pageSuspended
  }
  function stop() {
    cancelAnimationFrame(raf)
    raf = 0
  }
  function schedule() {
    if (!disposed && renderer && !lost && visible() && !raf) raf = requestAnimationFrame(draw)
  }
  function draw(now: number) {
    raf = 0
    if (disposed || !renderer || lost || !visible()) return
    hero.update(sample(transition, now), equipment === 'seed')
    try {
      renderer.render(scene, camera)
      frames++
      if (status !== 'ready') setStatus('ready')
      if (!complete(transition, now)) schedule()
    } catch {
      lost = true
      setStatus('unavailable')
    }
  }
  function settle() {
    transition = transitionTo(transition.target, equipment, performance.now(), true)
    hero.update(transition.target, equipment === 'seed')
  }
  function resize() {
    if (!renderer || disposed) return
    const { width, height } = host.getBoundingClientRect()
    if (!width || !height) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // Keep the wider leaf arms within the portrait fitting room.
    camera.position.z = Math.max(9, 4.7 / camera.aspect)
    camera.updateProjectionMatrix()
    schedule()
  }
  function visibility() {
    if (!visible()) {
      stop()
      settle()
    } else schedule()
  }
  function preference() {
    reduced = motion.matches
    if (reduced) {
      stop()
      settle()
      schedule()
    }
  }
  function contextLost(event: Event) {
    event.preventDefault()
    lost = true
    stop()
    settle()
    setStatus('lost')
  }
  function contextRestored() {
    lost = false
    setStatus('loading')
    resize()
    schedule()
  }
  function pagehide(event: PageTransitionEvent) {
    if (event.persisted) {
      pageSuspended = true
      visibility()
    } else dispose()
  }
  function pageshow() {
    pageSuspended = false
    visibility()
  }
  const observer = new ResizeObserver(resize)
  const intersection = new IntersectionObserver(entries => {
    offscreen = !entries[0]?.isIntersecting
    visibility()
  })
  canvas.addEventListener('webglcontextlost', contextLost)
  canvas.addEventListener('webglcontextrestored', contextRestored)
  document.addEventListener('visibilitychange', visibility)
  motion.addEventListener('change', preference)
  window.addEventListener('pagehide', pagehide)
  window.addEventListener('pageshow', pageshow)
  setStatus('loading')
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' })
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    resize()
    observer.observe(host)
    intersection.observe(host)
  } catch {
    setStatus('unavailable')
  }
  function dispose() {
    if (disposed) return
    disposed = true
    stop()
    observer.disconnect()
    intersection.disconnect()
    motion.removeEventListener('change', preference)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('pagehide', pagehide)
    window.removeEventListener('pageshow', pageshow)
    canvas.removeEventListener('webglcontextlost', contextLost)
    canvas.removeEventListener('webglcontextrestored', contextRestored)
    hero.dispose()
    renderer?.dispose()
    canvas.remove()
  }
  return {
    equip(next: Equipment) {
      if (disposed || next === equipment) return
      const now = performance.now()
      const current = sample(transition, now)
      equipment = next
      transition = transitionTo(current, next, now, reduced || !visible() || lost || !renderer)
      hero.update(sample(transition, now), equipment === 'seed')
      schedule()
    },
    inspect: () => ({
      ...hero.inspect(), equipment, frames, status, reduced, disposed,
      pendingFrame: Boolean(raf), offscreen, hidden: document.hidden,
      transitioning: !complete(transition, performance.now()),
      context: renderer?.getContext().constructor.name ?? null,
      triangles: renderer?.info.render.triangles ?? 0,
    }),
    dispose,
  }
}
