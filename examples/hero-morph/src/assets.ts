import * as THREE from 'three'
import { attachment, interpolateVertices, PARTS, RINGS, SEGMENTS, vertices } from './shape.ts'

export function createHero() {
  const group = new THREE.Group()
  const ramp = new THREE.DataTexture(new Uint8Array([115, 180, 240, 255]), 4, 1, THREE.RedFormat)
  ramp.needsUpdate = true
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter
  const white = new THREE.MeshToonMaterial({ color: '#fffef6', gradientMap: ramp })
  const ink = new THREE.MeshBasicMaterial({ color: '#352b3b' })
  const green = new THREE.MeshToonMaterial({ color: '#699746', gradientMap: ramp })
  const yellow = new THREE.MeshToonMaterial({ color: '#f4b74b', gradientMap: ramp })
  const parts = PARTS.map(part => {
    const base = vertices(part, 0)
    const seed = vertices(part, 1)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3).setUsage(THREE.DynamicDrawUsage))
    const indices = []
    for (let ring = 0; ring < RINGS; ring++) {
      for (let segment = 0; segment < SEGMENTS; segment++) {
        const a = ring * (SEGMENTS + 1) + segment
        const b = a + SEGMENTS + 1
        indices.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
    const mesh = new THREE.Mesh(geometry, white)
    mesh.name = part
    group.add(mesh)
    return { base, seed, geometry }
  })
  const eyeGeometry = new THREE.SphereGeometry(1, 24, 16)
  const eyes = ['leftEye', 'rightEye'].map(name => {
    const eye = new THREE.Mesh(eyeGeometry, ink)
    eye.name = name
    eye.scale.set(0.075, 0.115, 0.037)
    const glint = new THREE.Mesh(eyeGeometry, new THREE.MeshBasicMaterial({ color: '#fffef6' }))
    glint.position.set(-0.24, 0.3, 0.85)
    glint.scale.set(0.23, 0.19, 0.35)
    eye.add(glint)
    group.add(eye)
    return eye
  })
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.019, 8, 24, Math.PI), ink)
  mouth.rotation.z = Math.PI
  group.add(mouth)
  const badge = new THREE.Group()
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.055, 40), yellow)
  disc.rotation.x = Math.PI / 2
  badge.add(disc)
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), green)
  leaf.scale.set(0.05, 0.105, 0.025)
  leaf.rotation.z = -0.6
  leaf.position.set(0.017, 0.015, 0.046)
  badge.add(leaf)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.16, 8), ink)
  stem.position.set(-0.025, -0.026, 0.05)
  stem.rotation.z = -0.35
  badge.add(stem)
  group.add(badge)
  let amount = 0
  function update(value: number, equipped: boolean) {
    amount = value
    for (const part of parts) {
      const positions = part.geometry.getAttribute('position') as THREE.BufferAttribute
      interpolateVertices(part.base, part.seed, value, positions.array as Float32Array)
      positions.needsUpdate = true
      part.geometry.computeVertexNormals()
      part.geometry.computeBoundingSphere()
    }
    eyes.forEach((eye, i) => {
      eye.position.set(...attachment(i === 0 ? 'leftEye' : 'rightEye', value))
      eye.scale.y = 0.115 + value * 0.017
      eye.rotation.z = (i === 0 ? -1 : 1) * value * 0.12
    })
    mouth.position.set(...attachment('mouth', value))
    mouth.scale.setScalar(1 + 0.15 * value)
    badge.position.set(...attachment('badge', value))
    badge.visible = equipped
  }
  update(0, false)
  return {
    group, update,
    inspect: () => ({
      amount,
      geometry: Array.from((parts[0]!.geometry.getAttribute('position') as THREE.BufferAttribute).array.slice(240, 249)),
      eyes: eyes.map(eye => eye.position.toArray()),
      mouth: mouth.position.toArray(),
      badge: badge.position.toArray(),
      badgeVisible: badge.visible,
      scale: group.scale.toArray(),
    }),
    dispose: () => {
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      group.traverse(object => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry)
          materials.add(object.material as THREE.Material)
        }
      })
      geometries.forEach(geometry => geometry.dispose())
      materials.forEach(material => material.dispose())
      ramp.dispose()
    },
  }
}
