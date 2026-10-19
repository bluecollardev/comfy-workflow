import { readJson, shapeFile } from './paths.js'

export interface MountShape {
  name: string
  what?: string
  binc_pc?: string
  aliases?: string[]
  container?: string | null
  links?: string[]
  mode?: string | null
  required?: boolean
  env?: Record<string, string>
  note?: string
}
export interface Shape { mounts: MountShape[]; principle?: string; runtimes?: Record<string, string>; not_mounts?: unknown[] }

/** shared/shapes/mount-points.json, the scan of the project tree; empty when not found. */
export function shape(): Shape {
  const f = shapeFile()
  return f ? readJson<Shape>(f) : { mounts: [], principle: '', runtimes: {} }
}

/** The three folders every runtime needs, in the shape's order: required, with a place on the pod.
 *  Optional material (the legacy folder) is a hand-added link, not a mapped folder. */
export const folderShapes = (): MountShape[] => shape().mounts.filter((m) => m.container && m.required)
