import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import * as images from '../src/images.js'
import { REPO_ROOT } from '../src/paths.js'
import { scratch } from './helpers.js'

let dir: string
beforeEach(() => { dir = scratch(); delete process.env.DOCKERFILE_PATH })

const DOCKERFILE = `
# syntax=docker/dockerfile:1
ARG BASE_IMAGE=pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime
FROM \${BASE_IMAGE}
ARG COMFYUI_REPO=https://github.com/Comfy-Org/ComfyUI.git
ARG COMFYUI_REF=3c1b7a17 EMPTY_ARG
ENV DEBIAN_FRONTEND=noninteractive \\
    PYTHONUNBUFFERED=1 \\
    COMFY_SHARED=/workspace/comfy-shared \\
    COMFY_PORT=8188
env GREETING="two words" QUOTED='single q' ESCAPED=a\\ b
ENV LEGACY_KEY the rest of the line
ENV LEGACY_QUOTED "quoted rest"
ENV COMFY_PORT=8189
ARG BASE_IMAGE=ignored-second-default
RUN echo ENV NOT_AN_ENV=1
`

describe('Dockerfile parsing', () => {
  it('reads ENV and ARG the way the Python did: continuations, quotes, the KEY value form, later ENV wins, first ARG default stays', () => {
    const { env, build_args } = images.parseDockerfile(DOCKERFILE)
    expect(env).toEqual([
      { key: 'DEBIAN_FRONTEND', value: 'noninteractive' }, { key: 'PYTHONUNBUFFERED', value: '1' }, { key: 'COMFY_SHARED', value: '/workspace/comfy-shared' },
      { key: 'COMFY_PORT', value: '8189' },   // redefined later: last value, first position
      { key: 'GREETING', value: 'two words' }, { key: 'QUOTED', value: 'single q' }, { key: 'ESCAPED', value: 'a b' },
      { key: 'LEGACY_KEY', value: 'the rest of the line' }, { key: 'LEGACY_QUOTED', value: 'quoted rest' },
    ])
    expect(build_args).toEqual([
      { key: 'BASE_IMAGE', value: 'pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime' },
      { key: 'COMFYUI_REPO', value: 'https://github.com/Comfy-Org/ComfyUI.git' }, { key: 'COMFYUI_REF', value: '3c1b7a17' }, { key: 'EMPTY_ARG', value: '' },
    ])
    expect(images.shellSplit(`a "b c" d\\ e 'f g' "h\\"i"`)).toEqual(['a', 'b c', 'd e', 'f g', 'h"i'])
  })

  it("source=dockerfile reads the repo's Dockerfile by default and DOCKERFILE_PATH otherwise, 404 when missing", async () => {
    const real = await images.env({ source: 'dockerfile' })
    expect(real.image).toBe(join(REPO_ROOT, 'apps', 'comfy-app', 'Dockerfile'))
    expect(real).toMatchObject({ source: 'dockerfile', skipped: 0, build_source: real.image })
    expect(real.env).toContainEqual({ key: 'COMFY_PORT', value: '8188' })
    expect(real.build_args.map((a) => a.key)).toContain('BASE_IMAGE')

    mkdirSync(join(dir, 'd'))
    process.env.DOCKERFILE_PATH = join(dir, 'd', 'Dockerfile')
    await expect(images.env({ source: 'dockerfile' })).rejects.toMatchObject({ status: 404 })
    writeFileSync(process.env.DOCKERFILE_PATH, DOCKERFILE)
    expect((await images.env({ source: 'dockerfile' })).env[0]).toEqual({ key: 'DEBIAN_FRONTEND', value: 'noninteractive' })
    await expect(images.env({ source: 'registry' })).rejects.toThrow(/source must be/)
  })
})

describe('source=image', () => {
  it('reads docker image inspect, drops the system variables, counts them, and names the source repo', async () => {
    const inspected: string[] = []
    const inspect: images.Inspector = async (image) => {
      inspected.push(image)
      return { Env: ['PATH=/usr/bin', 'NV_CUDA_LIB_VERSION=12', 'CUDA_VERSION=12.6', 'COMFY_PORT=8188', 'TOKEN=a=b', 'FLAG'], Labels: image.startsWith('ghcr.io') ? { 'org.opencontainers.image.source': 'https://github.com/bluecollardev/comfy_workflow' } : null }
    }
    const prebuilt = await images.env({ source: 'image', image: 'prebuilt' }, inspect)
    expect(inspected).toEqual(['ashleykza/comfyui:latest'])
    expect(prebuilt).toEqual({
      source: 'image', image: 'ashleykza/comfyui:latest', skipped: 3, build_args: [], build_source: 'https://github.com/ashleykleynhans/comfyui-docker',
      env: [{ key: 'COMFY_PORT', value: '8188' }, { key: 'TOKEN', value: 'a=b' }, { key: 'FLAG', value: '' }],
    })
    const ours = await images.env({ image: 'ghcr.io/bluecollardev/comfy-app:v26' }, inspect)   // source defaults to image
    expect(ours.build_source).toBe('https://github.com/bluecollardev/comfy_workflow')
    expect((await images.env({ image: 'docker.io/library/ubuntu:24.04' }, inspect)).build_source).toBeNull()
    await expect(images.env({ image: '  ' }, inspect)).rejects.toThrow(/No image given/)
    expect(images.repoOf('ashleykza/comfyui:latest')).toBe('ashleykza/comfyui')
    expect(images.repoOf('registry.example:5000/team/img:1@sha256:abc')).toBe('team/img')
    expect(images.repoOf('ubuntu')).toBe('library/ubuntu')
  })
})

describe('the Dockerfile of an image', () => {
  const registry = async (image: string) => ({
    created: '2026-10-20T08:39:42Z',
    config: { Env: ['COMFY_PORT=8188'], ExposedPorts: { '8188/tcp': {} }, Entrypoint: ['/opt/comfy-app/entrypoint.sh'], Labels: { 'dev.bluecollar.shotpipe': 'contract-v26' }, WorkingDir: '/opt/ComfyUI' },
    history: [
      { created_by: 'RUN |2 COMFYUI_REPO=https://x.git COMFYUI_REF=abc /bin/sh -c git clone x /opt/ComfyUI # buildkit' },
      { created_by: 'COPY .build/custom_nodes/ /opt/ComfyUI/custom_nodes/ # buildkit' },
      { created_by: '/bin/sh -c #(nop)  ENV COMFY_PORT=8188' },
    ],
    image,
  })
  it('rebuilds the instructions from the build history and carries the config and the repo source', async () => {
    const v = await images.dockerfile({ image: 'reg/comfy-app:1' }, registry)
    expect(v.built).toContain('RUN git clone x /opt/ComfyUI'); expect(v.built).toContain('COPY .build/custom_nodes/ /opt/ComfyUI/custom_nodes/'); expect(v.built).toContain('ENV COMFY_PORT=8188')
    expect(v.built).toContain('# build args: COMFYUI_REPO=https://x.git COMFYUI_REF=abc')
    expect(v).toMatchObject({ env: ['COMFY_PORT=8188'], ports: ['8188/tcp'], entrypoint: ['/opt/comfy-app/entrypoint.sh'], workdir: '/opt/ComfyUI', labels: { 'dev.bluecollar.shotpipe': 'contract-v26' }, error: null })
    expect(v.source).toContain('FROM'); expect(v.source_kind).toBe('repo')   // ours: the repo's apps/comfy-app/Dockerfile
  })
  it('says why when the registry cannot be read, and still gives the source', async () => {
    const v = await images.dockerfile({ image: 'reg/comfy-app:none' }, async () => { throw new Error('manifest unknown') })
    expect(v.error).toBe('manifest unknown'); expect(v.built).toBeNull(); expect(v.source).toContain('FROM')
  })

  it('reads another image\'s Dockerfile from its source repository: a known one, a labelled one, and says why when it cannot', async () => {
    const reg = (labels: Record<string, string>) => async () => ({ config: { Labels: labels }, history: [{ created_by: 'RUN x' }] })
    const seen: string[] = []
    const get = async (url: string) => { seen.push(url); return url.endsWith('/HEAD/Dockerfile') ? 'FROM nvidia/cuda\n# upstream' : null }
    const stock = await images.dockerfile({ image: 'ashleykza/comfyui:latest' }, reg({}), get)
    expect(stock.source_kind).toBe('github'); expect(stock.source).toContain('# upstream'); expect(stock.source_url).toBe('https://github.com/ashleykleynhans/comfyui-docker')
    expect(stock.source_path).toBe('https://github.com/ashleykleynhans/comfyui-docker/blob/HEAD/Dockerfile')
    const labelled = await images.dockerfile({ image: 'docker.io/me/thing:1' }, reg({ 'org.opencontainers.image.source': 'https://github.com/me/thing' }), get)
    expect(labelled.source_url).toBe('https://github.com/me/thing'); expect(seen).toContain('https://raw.githubusercontent.com/me/thing/HEAD/Dockerfile')
    const none = await images.dockerfile({ image: 'docker.io/anon/x:1' }, reg({}), get)
    expect(none.source).toBeNull(); expect(none.source_note).toMatch(/No source repository is known/)
    const nofile = await images.dockerfile({ image: 'docker.io/me/thing:1' }, reg({ 'org.opencontainers.image.source': 'https://github.com/me/thing' }), async () => null)
    expect(nofile.source).toBeNull(); expect(nofile.source_note).toMatch(/No Dockerfile found/); expect(nofile.source_url).toBe('https://github.com/me/thing')
  })
})
