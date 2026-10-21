import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as mounts from '../src/mounts.js'
import * as settings from '../src/settings.js'
import * as sync from '../src/sync.js'
import { fakeTree, scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); delete process.env.RUNPOD_S3_ACCESS_KEY; delete process.env.RUNPOD_S3_SECRET_KEY })

/** The three folders all mapped to one scratch folder, like the pytest fixture. */
function mapped() {
  const cfg = mounts.defaults()
  cfg.folders.project = dir; cfg.folders.plates = dir; cfg.folders['comfy-shared'] = dir
  return cfg
}

describe('the push plan', () => {
  it('copies plates only when asked and the repo workflows beside comfy-shared', () => {
    const cfg = mapped()
    expect(sync.plan(cfg, new Set(), false).map((s) => s.key)).toEqual(['project', 'comfy-shared', 'workflows'])
    expect(sync.plan(cfg, new Set(), false).filter((s) => s.key === 'workflows').map((s) => s.remote)).toEqual(['/workspace/comfy-shared/workflows/'])
    expect(sync.plan(cfg, new Set(), true).map((s) => s.key)).toEqual(['project', 'plates', 'comfy-shared', 'workflows'])
    expect(sync.plan(cfg, new Set(['project']), false).map((s) => s.remote)).toEqual(['/workspace/project/'])
    expect(sync.plan(cfg, new Set(['project']), false)[0].local).toBe(dir + '/')   // both ends carry the trailing slash rsync needs
    expect(sync.plan(cfg, new Set(['workflows']), false).map((s) => s.key)).toEqual(['workflows'])
    expect(sync.plan(cfg, new Set(['workflows']), false)[0].local).toBe(sync.WORKFLOWS_DIR + '/')
  })

  it('skips an unmapped folder with a word and never a custom one', () => {
    const cfg = mapped(); cfg.folders.plates = ''
    cfg.custom.push({ name: 'legacy', local: dir, container: '/workspace/legacy', link: '', mode: 'ro' })
    const warned: string[] = []
    expect(sync.plan(cfg, new Set(), true, (m) => warned.push(m)).map((s) => s.key)).toEqual(['project', 'comfy-shared', 'workflows'])
    expect(warned).toEqual(['skip plates: not mapped on this PC'])
  })
})

describe('rsync over ssh', () => {
  it('builds the push command the Python did: additive, -rlt, the port in -e', () => {
    const cmd = sync.rsyncCmd(dir + '/', 'root@1.2.3.4', 2222, '/workspace/project/')
    expect(cmd[0]).toBe('rsync'); expect(cmd).not.toContain('--delete'); expect(cmd[cmd.length - 1]).toBe('root@1.2.3.4:/workspace/project/')
    expect(cmd[cmd.indexOf('-e') + 1]).toContain('-p 2222')
    expect(cmd).toContain('-rlt'); expect(cmd).not.toContain('-a')   // the volume refuses chown
    expect(cmd).toContain('--info=progress2')
    expect(cmd.filter((c) => c === '--exclude')).toHaveLength(sync.EXCLUDE.length)
  })

  it('takes -n for a dry run and openrsync\'s progress flag', () => {
    const cmd = sync.rsyncCmd(dir + '/', 'root@1.2.3.4', 2222, '/workspace/project/', { dryRun: true, progress: sync.progressFlag('openrsync: protocol version 29') })
    expect(cmd[1]).toBe('-n'); expect(cmd).toContain('--progress'); expect(cmd).not.toContain('--info=progress2')
    expect(sync.progressFlag('rsync  version 3.2.7  protocol version 31')).toBe('--info=progress2')
  })

  it('pulls with the ends swapped', () => {
    const cmd = sync.rsyncPullCmd('root@1.2.3.4', 2222, '/workspace/comfy-shared/output/', dir + '/output/')
    expect(cmd.slice(-2)).toEqual(['root@1.2.3.4:/workspace/comfy-shared/output/', dir + '/output/'])
    expect(cmd).not.toContain('--delete')
  })

  it('finds the pod\'s public ssh port', () => {
    const pod = { id: 'p1', name: 'p', runtime: { ports: [{ ip: '10.0.0.1', isIpPublic: false, privatePort: 22, publicPort: 22, type: 'tcp' }, { ip: '5.6.7.8', isIpPublic: true, privatePort: 22, publicPort: 10022, type: 'tcp' }] } }
    expect(sync.sshTarget(pod)).toEqual({ host: 'root@5.6.7.8', port: 10022 })
    expect(() => sync.sshTarget({ id: 'p2', name: 'p', runtime: null })).toThrow(/no public 22\/tcp port/)
  })
})

describe('the S3 transport', () => {
  const vol = { id: 'vol123', datacenter: 'EU-RO-1' }

  it('is refused outside the S3 datacenters, with the list', () => {
    expect(() => sync.assertS3(null)).toThrow(/No network volume/)
    expect(() => sync.assertS3({ id: 'v', datacenter: 'CA-MTL-1' })).toThrow(/CA-MTL-1, which has no S3 API.*EU-RO-1.*--pod/)
    expect(sync.assertS3(vol)).toBe(vol)
  })

  it('uses the datacenter endpoint, the volume as the bucket and the path under the mount', () => {
    expect(sync.s3Endpoint('EU-RO-1')).toBe('https://s3api-eu-ro-1.runpod.io/')
    expect(sync.s3Key('/workspace/project/')).toBe('project/')
    expect(sync.s3Key('/data/comfy-shared/workflows/', '/data')).toBe('comfy-shared/workflows/')
    expect(() => sync.s3Key('/elsewhere/project/')).toThrow(/not under the volume's mount path/)
    const cmd = sync.s3Cmd(dir + '/', vol, '/workspace/project/')
    expect(cmd.slice(0, 4)).toEqual(['aws', 's3', 'cp', '--recursive'])
    expect(cmd[cmd.indexOf('--endpoint-url') + 1]).toBe('https://s3api-eu-ro-1.runpod.io/')
    expect(cmd[cmd.indexOf('--region') + 1]).toBe('EU-RO-1')
    expect(cmd.slice(-2)).toEqual([dir + '/', 's3://vol123/project/'])
    expect(cmd).not.toContain('--delete'); expect(cmd).not.toContain('--dryrun')
    expect(cmd).toContain('*/.DS_Store'); expect(cmd).toContain('*/logs/*')   // the excludes, in the AWS CLI's glob form
    expect(sync.s3Cmd(dir + '/', vol, '/workspace/project/', { dryRun: true })).toContain('--dryrun')
    expect(sync.s3PullCmd(vol, '/workspace/comfy-shared/output/', dir + '/output/').slice(-2)).toEqual(['s3://vol123/comfy-shared/output/', dir + '/output/'])
  })

  it('reads its keys from the environment or the settings file, and says so when they are missing', () => {
    expect(() => sync.s3Env()).toThrow(/RUNPOD_S3_ACCESS_KEY and RUNPOD_S3_SECRET_KEY are not set/)
    writeFileSync(settings.file(), 'RUNPOD_API_KEY=abc\nRUNPOD_S3_ACCESS_KEY=user_x\nRUNPOD_S3_SECRET_KEY="rps_y"\n')
    expect(sync.s3Env()).toEqual({ AWS_ACCESS_KEY_ID: 'user_x', AWS_SECRET_ACCESS_KEY: 'rps_y' })
    process.env.RUNPOD_S3_ACCESS_KEY = 'env_x'
    expect(sync.s3Env().AWS_ACCESS_KEY_ID).toBe('env_x')   // the environment wins
  })
})

describe('the pull plan', () => {
  it('brings down ComfyUI\'s output and each shot\'s review and deliver folders', () => {
    const tree = fakeTree(dir)
    mkdirSync(join(tree, '10_CORROSION', '_template'), { recursive: true })      // not a shot
    mkdirSync(join(tree, '10_CORROSION', 'Gen_Paint_assets'), { recursive: true })
    mkdirSync(join(tree, '20_STEREO', 'enhance-141'), { recursive: true })
    writeFileSync(join(tree, '20_STEREO', 'stray-002'), '')                         // a file, not a folder
    expect(sync.listShots(tree)).toEqual(['10_CORROSION/corrosion-001', '20_STEREO/enhance-141'])
    expect(sync.listShots(join(dir, 'nowhere'))).toEqual([])

    const cfg = mounts.defaults(); cfg.folders.project = tree; cfg.folders['comfy-shared'] = join(dir, 'shared')
    const steps = sync.pullPlan(cfg, sync.listShots(tree))
    expect(steps.map((s) => s.key)).toEqual(['output', '10_CORROSION/corrosion-001/06_REVIEW', '10_CORROSION/corrosion-001/07_DELIVER', '20_STEREO/enhance-141/06_REVIEW', '20_STEREO/enhance-141/07_DELIVER'])
    expect(steps[0]).toEqual({ key: 'output', local: join(dir, 'shared') + '/output/', remote: '/workspace/comfy-shared/output/' })
    expect(steps[1]).toEqual({ key: '10_CORROSION/corrosion-001/06_REVIEW', local: tree + '/10_CORROSION/corrosion-001/06_REVIEW/', remote: '/workspace/project/10_CORROSION/corrosion-001/06_REVIEW/' })
    expect(sync.pullPlan(cfg, sync.listShots(tree), new Set(['deliver'])).map((s) => s.key)).toEqual(['10_CORROSION/corrosion-001/07_DELIVER', '20_STEREO/enhance-141/07_DELIVER'])
    expect(sync.pullPlan(cfg, [], new Set(['output'])).map((s) => s.key)).toEqual(['output'])
  })

  it('skips what is not mapped here with a word', () => {
    const warned: string[] = []
    expect(sync.pullPlan(mounts.defaults(), ['10_CORROSION/corrosion-001'], new Set(), (m) => warned.push(m))).toEqual([])
    expect(warned).toEqual(['skip output: comfy-shared is not mapped on this PC', 'skip shots: project is not mapped on this PC'])
  })
})
