import { describe, expect, it } from 'vitest'
import { DEFAULT_GPU, GPUS, autoCards, cudaOf, imageFor, menu, runpodId, vram } from '../src/gpus.js'

describe('CUDA 13 (ADR-030)', () => {
  it('the Blackwell cards need the -cu13 image on a CUDA 13 host; the others do not; another image is left alone', () => {
    for (const k of ['rtx5090', 'rtxpro6000', 'b200', 'b300']) expect(cudaOf(k)).toBe(13)
    for (const k of ['h100', 'h200', 'a100', 'rtx4090', 'l40s']) expect(cudaOf(k)).toBeUndefined()
    expect(cudaOf('NVIDIA GeForce RTX 5090')).toBe(13); expect(cudaOf('RTX PRO 6000')).toBe(13); expect(cudaOf('nonesuch')).toBeUndefined()
    const ours = 'ghcr.io/bluecollardev/comfy-app:contract-v26'
    expect(imageFor(ours, 'rtx5090')).toBe(`${ours}-cu13`); expect(imageFor(`${ours}-cu13`, 'rtx5090')).toBe(`${ours}-cu13`)
    expect(imageFor(ours, 'h100')).toBe(ours); expect(imageFor('runpod/comfyui:latest', 'rtx5090')).toBe('runpod/comfyui:latest')
    expect(autoCards().some((g) => g.cuda)).toBe(false)   // auto never lands on a Blackwell card
    expect(Object.values(GPUS).filter((g) => g.cuda).every((g) => g.explicit)).toBe(true)
    expect(menu().find((m) => m.value === 'rtx5090')?.text).toBe('RTX 5090 (32 GB) · pick by name · CUDA 13 image')
  })
})

describe('gpus', () => {
  it('is the small-card menu with RunPod ids, plus the explicit-only big cards', () => {
    expect(Object.keys(GPUS).filter((k) => !GPUS[k].explicit)).toEqual(['rtx2000ada', 'a4000', 'rtx4000ada', 'a5000', 'rtx3090', 'l4', 'rtx4090', 'a6000', 'a40', 'l40']);
    expect(Object.keys(GPUS).filter((k) => GPUS[k].explicit)).toEqual(['l40s', 'rtx6000ada', 'a100pcie', 'a100', 'h100pcie', 'h100', 'h200', 'rtx5080', 'rtx5090', 'rtxpro4000', 'rtxpro4500', 'rtxpro4500se', 'rtxpro5000', 'rtxpro6000', 'rtxpro6000wk', 'rtxpro6000q', 'b200', 'b300'])
    expect(autoCards().some((g) => g.explicit)).toBe(false); expect(autoCards()).toHaveLength(10); expect(runpodId('h100')).toBe('NVIDIA H100 80GB HBM3'); expect(vram('h200')).toBe(141); expect(vram('H200 SXM')).toBe(141); expect(vram('B200')).toBe(180); expect(vram('Nonesuch')).toBe(0)
    ; expect(DEFAULT_GPU).toBe('auto')
    expect(runpodId('a4000')).toBe('NVIDIA RTX A4000'); expect(runpodId('NVIDIA GeForce RTX 4090')).toBe('NVIDIA GeForce RTX 4090')
    expect(vram('a4000')).toBe(16); expect(autoCards().every((g) => g.vram <= 48)).toBe(true); expect(vram('a40')).toBe(48)
    expect(() => runpodId('mi300x')).toThrow()
    expect(menu()[0].value).toBe('auto'); expect(menu().find((m) => m.value === 'rtx4090')).toEqual({ value: 'rtx4090', text: 'RTX 4090 (24 GB)' })
  })
})
