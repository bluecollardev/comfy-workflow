# ComfyUI colour science and pipeline governance

Rules for writing or auditing ComfyUI custom nodes that process pixel data: photometric state, the maths of transfer functions and primaries, high-bit-depth file formats, OCIO use, and a node template with an audit checklist. It applies to our node packs (`shared/nodes`, ADR-040, `docs/NODE-PACKS.md`) and to anything we write for the CANALV2 job. It is a reference for people and for agents; the same text was supplied as a skill named `comfyui-color-science` (added 2026-11-21).

Where it meets the delivery work: the colour statement for review videos and DPX headers is a decision for Lucas or Binc, never an inference (delivery report, section 6; ADR-055). The user-level skill `color-chain-safety` (installed in `~/.claude/skills/`, 2026-11-21) covers the same ground for FFmpeg, DPX and delivery chains: observed metadata, inference, approved policy and measured output are kept apart, and a missing policy means inspect and report, not publish.

Use when creating, debugging or auditing ComfyUI image or video nodes involving colour spaces, transfer functions (OETF/EOTF), LUTs, HDR, or raw/log formats.

Never treat ComfyUI `IMAGE` tensors as generic arrays without tracking their photometric state.

## 1. Tensor architecture and state governance

ComfyUI `IMAGE` tensors have shape `[B, H, W, C]` (`torch.float32`, RGB channel order). `MASK` tensors have shape `[B, H, W]` (`torch.float32`).

### Invariants to enforce
1. **No silent clamping.** ComfyUI core nodes frequently apply `torch.clamp(img, 0.0, 1.0)`. This is forbidden in scene-referred, linear, HDR or wide-gamut nodes. Preserve negative values (out-of-gamut chromaticities) and values above 1.0 (specular highlights). Clamp only at the final display-referred output boundary, and only if explicitly requested.
2. **State tracking.** Every node must explicitly document and validate whether its input and output are:
   - **Scene-referred linear** (for example ACEScg / AP1, ACES2065-1 / AP0, Linear sRGB / Rec.709).
   - **Log-encoded** (for example ARRI LogC3/LogC4, Sony S-Log3, RED Log3G10, ACEScct).
   - **Display-referred** (for example sRGB IEC 61966-2-1, Rec.1886 / BT.709, SMPTE ST 2084 PQ, ARIB STD-B67 HLG).
3. **Alpha channel integrity.** ComfyUI `IMAGE` is 3-channel RGB (`C=3`). If handling RGBA (for example EXR read or write), manage alpha as a separate `MASK` tensor (`[B, H, W]`). Never apply transfer functions (gamma or log curves) or 3x3 colour matrices to the alpha channel. Always unpremultiply (`RGB / max(A, eps)`) before colour space transforms and re-premultiply afterwards if working with premultiplied assets.

---

## 2. Colour science mathematical laws

### Transfer functions (OETF / EOTF)
- **Never use `pow(x, 2.2)` as an exact sRGB or Rec.709 transform** unless implementing a legacy artistic approximation.
- **Exact sRGB piecewise EOTF:**

  ```
  E = E' / 12.92                      for E' <= 0.04045
  E = ((E' + 0.055) / 1.055) ^ 2.4    for E' >  0.04045
  ```

- **Signed preservation.** For negative values in extended-range sRGB (`scRGB`), mirror the function symmetrically, `sign(x) * f(|x|)`, so out-of-gamut colours do not produce `NaN` from fractional exponents.
- **SMPTE ST 2084 (PQ) and HLG.** Normalise PQ to 1.0 = 10,000 cd/m2, or explicitly expose a `diffuse_white_nits` parameter, defaulting to 100 or 203 nits per ITU-R BT.2408, when bridging SDR and HDR.

### Chromatic adaptation and primaries
- **Linearity requirement.** All 3x3 primary conversion matrices, exposure adjustments (`val * 2^stops`), white balance gains, and convolutions (blur, resize, mipmapping) **must** execute in scene-referred linear light.
- **Chromatic adaptation transform (CAT).** When converting between spaces with different white points (for example D65 sRGB/Rec.709 to D60 ACEScg), always apply a **Bradford** or **CAT16** transform, never a raw XYZ scaling.
- **Luminance coefficients.** Use the exact primary-specific Y weights:
  - Rec.709 / sRGB: `Y = 0.2126 R + 0.7152 G + 0.0722 B`
  - ACEScg (AP1): `Y = 0.2722287168 R + 0.6740817658 G + 0.0536895174 B`
  - Rec.2020: `Y = 0.2627 R + 0.6780 G + 0.0593 B`

### 3D LUT interpolation
- Parse `.cube` files respecting `LUT_3D_SIZE`, `DOMAIN_MIN` and `DOMAIN_MAX`.
- Normalise input coordinates into `[0, N-1]` using `(x - domain_min) / (domain_max - domain_min)`.
- Implement **tetrahedral interpolation** (preferred over trilinear for hue linearity and neutral-axis precision) on the GPU via PyTorch grid indexing or custom CUDA/Triton kernels.

---

## 3. File format and toolchain governance

When building I/O nodes (loaders and savers), strictly forbid routing high-bit-depth formats through `PIL.Image`, which silently quantises to 8-bit `uint8`. Use `OpenImageIO` (`oiio`), `OpenEXR`, `imageio` (FreeImage/TIFF plugins), or `cv2` (with `IMREAD_UNCHANGED | IMREAD_ANYDEPTH`).

| Format | Standard / spec | Bit depth and encoding | Mandatory node rules |
| :--- | :--- | :--- | :--- |
| **OpenEXR** | SMPTE ST 2065-4 (ACES) / ILM | `HALF` (16-bit float) or `FLOAT` (32-bit float), linear | Preserve negative and above-1.0 values. Support compression (`PIZ`, `ZIP`, `DWAA`, `DWAB`). Read and write `chromaticities` and `acesImageContainerFlag` metadata. |
| **DPX** | SMPTE ST 268 | 10-bit or 16-bit unsigned integer, log (Cineon/LogC) or linear | Respect the `Transfer` and `Colorimetric` header descriptors. Scale 10-bit `[0, 1023]` properly (`val / 1023.0`), accounting for legal against full range (`64-940` against `0-1023`). |
| **TIFF** | TIFF 6.0 / ITU-R BT.2407 | 16-bit `uint16` or 32-bit `float32` | Disable alpha premultiplication side-effects in PIL; use `tifffile` or `OpenImageIO` to preserve 16/32-bit precision and ICC profiles. |
| **PNG / JPEG** | IEC 61966-2-1 / JFIF | 8-bit (or 16-bit PNG) `uint` | Display-referred only. Apply the inverse EOTF (linear to display) and optional dithering (triangular PDF) before 8-bit quantisation to prevent banding. |

---

## 4. OpenColorIO (OCIO) integration pattern

When wrapping `PyOpenColorIO`:
1. Cache the `OCIO.Config` and `CPUProcessor` instances per `(config_path, src_cs, dst_cs)` tuple so configs are not re-parsed on every execution step.
2. Convert the PyTorch tensor `[B, H, W, C]` to a contiguous `np.float32` on the CPU (or use the OCIO GPU renderer if an OpenGL context is available), process in place via `processor.applyRGB(img_np)`, and return `torch.from_numpy(img_np)` preserving the original device (`cuda`, `mps` or `cpu`).

---

## 5. Node boilerplate and validation checklist

Every generated node must follow this structure and pass these checks:

```python
import torch
import numpy as np

class ColorTransformNode:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "source_space": (["ACEScg", "ACES2065-1", "Linear sRGB", "sRGB (Display)", "ARRI LogC4"],),
                "target_space": (["ACEScg", "ACES2065-1", "Linear sRGB", "sRGB (Display)", "ARRI LogC4"],),
                "clamp_output": ("BOOLEAN", {"default": False}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "process"
    CATEGORY = "ColorScience/Transforms"

    def process(self, image: torch.Tensor, source_space: str, target_space: str, clamp_output: bool):
        # 1. Enforce float32 precision (never float16/bf16 for color math)
        out = image.to(dtype=torch.float32).clone()

        # 2. Execute math in linear light (EOTF -> 3x3 Bradford Matrix -> OETF)
        # ...

        # 3. Optional explicit clamp only
        if clamp_output:
            out = torch.clamp(out, 0.0, 1.0)

        return (out,)
```

### Pre-delivery audit checklist
- [ ] Is all colour math executed in `torch.float32` (never `float16` or `bfloat16`)?
- [ ] Are negative values and highlights above 1.0 preserved throughout linear operations?
- [ ] Are resize, blur and composite operations performed in linear light rather than in gamma or log space?
- [ ] Does 8-bit or 10-bit export apply proper range scaling (full against SMPTE legal) and dithering?
- [ ] Are alpha channels excluded from transfer functions and colour matrices?
