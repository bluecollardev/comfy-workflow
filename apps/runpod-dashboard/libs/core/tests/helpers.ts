import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REPO_ROOT } from '../src/paths.js'

/** A scratch config dir and the repo's real shape and governance, like the pytest fixtures. */
export function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'runpod-core-'))
  process.env.POD_MANAGER_CONFIG_DIR = dir
  delete process.env.MOUNTS_FILE
  delete process.env.IDLE_FILE
  process.env.MOUNT_POINTS_FILE = join(REPO_ROOT, 'shared', 'shapes', 'mount-points.json')
  delete process.env.GOVERNANCE_DIR
  delete process.env.COMFY_MODE
  delete process.env.COMFY_REQUIRE
  delete process.env.COMFY_IMAGE
  return dir
}

/** A small project tree that declares its paths the way CANALV2 does, under a name of its own. */
export function fakeTree(base: string): string {
  const t = join(base, 'trees', 'HARBOUR')
  mkdirSync(join(t, '04_TRACKER', 'queue', 'done'), { recursive: true })
  writeFileSync(join(t, '04_TRACKER', 'queue', 'done', 'job1.md'), 'job: x\nroot: /home/someone/HARBOUR_r1/HARBOUR\n')
  writeFileSync(join(t, '04_TRACKER', 'queue', 'done', 'job2.md'), 'job: y\nroot: /home/someone/HARBOUR_r1/HARBOUR/\n')
  mkdirSync(join(t, '00_POLICY'), { recursive: true })
  writeFileSync(join(t, '00_POLICY', 'structure_v001.md'), 'Root: `/home/old/HARBOUR/`.')
  const s = join(t, '10_CORROSION', 'corrosion-001', '02_SOURCE')
  mkdirSync(s, { recursive: true })
  writeFileSync(join(s, 'SOURCES.csv'), 'role,eye,part,location,pattern\nplate,LEFT,1,/srv/plates/PC_x/corrosion-001_3D/corrosion-001_3D.LEFT,*.dpx\nplate,RIGHT,1,/srv/plates/PC_x/corrosion-001_3D/corrosion-001_3D.RIGHT,*.dpx\n')
  return t
}
