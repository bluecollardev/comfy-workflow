"""
ComfyUI-BincStereo — I/O side.

  BincLoadImageSequence   load a numbered image sequence (depth maps, plates, painted depth returns) from a
                          folder under ComfyUI/input as one IMAGE batch, with start/count so it lines up with
                          an ImageFromBatch window on the video side. 8-bit and 16-bit PNG/TIFF, any channel count.
"""

import os
import re

import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

try:
    import folder_paths
    _INPUT_DIR = folder_paths.get_input_directory()
except Exception:  # headless tests
    folder_paths = None
    _INPUT_DIR = os.getcwd()

_EXT = (".png", ".tif", ".tiff", ".jpg", ".jpeg", ".exr")


def resource_snapshot():
    """Process RSS and accelerator memory right now, as a short string. Never raises."""
    parts = []
    try:
        import psutil
        parts.append(f"rss {psutil.Process().memory_info().rss / 2**30:.2f} GB")
        parts.append(f"sys avail {psutil.virtual_memory().available / 2**30:.1f} GB")
    except Exception:
        pass
    try:
        if torch.cuda.is_available():
            parts.append(f"cuda alloc {torch.cuda.memory_allocated() / 2**30:.2f} GB peak {torch.cuda.max_memory_allocated() / 2**30:.2f} GB")
        elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
            parts.append(f"mps alloc {torch.mps.current_allocated_memory() / 2**30:.2f} GB driver {torch.mps.driver_allocated_memory() / 2**30:.2f} GB")
    except Exception:
        pass
    return " · ".join(parts) or "n/a"


def progress_bar(total):
    try:
        import comfy.utils
        return comfy.utils.ProgressBar(total)
    except Exception:
        return None


def _natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def list_sequence(folder: str):
    path = folder if os.path.isabs(folder) else os.path.join(_INPUT_DIR, folder)
    if not os.path.isdir(path):
        raise FileNotFoundError(f"BincLoadImageSequence: folder not found: {path}")
    files = [f for f in os.listdir(path) if f.lower().endswith(_EXT) and not f.startswith(".")]
    files.sort(key=_natural_key)
    return path, files


def _png_bit_depth(p: str):
    try:
        with open(p, "rb") as f:
            head = f.read(29)
        if head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR":
            return head[24]
    except Exception:
        pass
    return None


def _decode_png16(p: str) -> np.ndarray:
    """Minimal 16-bit PNG decoder (non-interlaced, RGB / RGBA / grey / grey+alpha). -> (H,W,3) uint16.
    PIL flattens 16-bit RGB PNG to 8-bit, so this keeps 10/12/16-bit sources intact without extra deps."""
    import zlib, struct
    with open(p, "rb") as f:
        data = f.read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, ihdr = 8, [], None
    while pos < len(data):
        ln, = struct.unpack(">I", data[pos:pos + 4]); tag = data[pos + 4:pos + 8]; body = data[pos + 8:pos + 8 + ln]
        if tag == b"IHDR": ihdr = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT": idat.append(body)
        elif tag == b"IEND": break
        pos += 12 + ln
    W, H, depth, ctype, _, _, interlace = ihdr
    assert depth == 16 and interlace == 0, "unsupported PNG layout"
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    bpp = ch * 2
    stride = W * bpp
    raw = zlib.decompress(b"".join(idat))
    out = np.empty((H, stride), dtype=np.uint8)
    prev = np.zeros(stride, dtype=np.uint8)
    for y in range(H):
        ft = raw[y * (stride + 1)]
        row = np.frombuffer(raw, dtype=np.uint8, count=stride, offset=y * (stride + 1) + 1).copy()
        if ft == 1:
            for i in range(bpp, stride): row[i] = (int(row[i]) + int(row[i - bpp])) & 0xFF
        elif ft == 2:
            row = ((row.astype(np.uint16) + prev) & 0xFF).astype(np.uint8)
        elif ft == 3:
            for i in range(stride):
                a = int(row[i - bpp]) if i >= bpp else 0
                row[i] = (int(row[i]) + ((a + int(prev[i])) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = int(row[i - bpp]) if i >= bpp else 0; b = int(prev[i]); c = int(prev[i - bpp]) if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                row[i] = (int(row[i]) + pr) & 0xFF
        out[y] = row; prev = row
    px = out.view(">u2").reshape(H, W, ch).astype(np.uint16)
    if ch == 1: px = np.repeat(px, 3, axis=-1)
    elif ch == 2: px = np.repeat(px[..., :1], 3, axis=-1)
    elif ch == 4: px = px[..., :3]
    return px


def load_one(p: str) -> torch.Tensor:
    """-> (H,W,3) float32 in [0,1]. 16-bit stays 16-bit precision (no 8-bit truncation)."""
    if p.lower().endswith(".png") and _png_bit_depth(p) == 16:
        try:  # primary: PyAV (ships with ComfyUI) decodes 16-bit PNG natively to rgb48
            import av
            with av.open(p) as c:
                for fr in c.decode(video=0):
                    a = fr.to_ndarray(format="rgb48le").astype(np.float32) / 65535.0
                    return torch.from_numpy(np.ascontiguousarray(a)).clamp(0, 1)
        except Exception:
            pass
        try:  # second: torchvision when it hands back uint16
            from torchvision.io import decode_png, ImageReadMode
            data = torch.frombuffer(bytearray(open(p, "rb").read()), dtype=torch.uint8)
            t = decode_png(data, mode=ImageReadMode.UNCHANGED)
            if t.dtype == torch.uint16:
                t = t[:3] if t.shape[0] >= 3 else t[:1].expand(3, -1, -1)
                return (t.permute(1, 2, 0).to(torch.float32) / 65535.0).clamp(0, 1)
        except Exception:
            pass
        a = _decode_png16(p).astype(np.float32) / 65535.0
        return torch.from_numpy(np.ascontiguousarray(a)).clamp(0, 1)
    im = Image.open(p)
    if im.mode in ("I;16", "I;16B", "I;16L", "I"):
        a = np.asarray(im, dtype=np.float32)
        a = a / 65535.0 if a.max() > 255 else a / 255.0
        a = np.repeat(a[..., None], 3, axis=-1)
    elif im.mode == "F":
        a = np.repeat(np.asarray(im, dtype=np.float32)[..., None], 3, axis=-1)
    else:
        a = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(np.ascontiguousarray(a)).clamp(0, 1)


class BincLoadImageSequence:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "folder": ("STRING", {"default": "depth",
                                  "tooltip": "Relative to ComfyUI/input, or absolute. Files are sorted naturally (0001, 0002 … / f-00000 …)."}),
            "start": ("INT", {"default": 0, "min": 0, "max": 100000, "tooltip": "0-based index of the first file to load — match ImageFromBatch.batch_index."}),
            "count": ("INT", {"default": 0, "min": 0, "max": 100000, "tooltip": "0 = all remaining."}),
            "proxy": (["full", "half", "quarter", "eighth"], {"default": "full",
                      "tooltip": "Downscale on load (area filter). Run the whole chain at proxy size for QC; parallax is in % of width so settings carry to full res."}),
        }}

    RETURN_TYPES = ("IMAGE", "MASK", "INT", "STRING")
    RETURN_NAMES = ("images", "mask", "count", "info")
    FUNCTION = "run"
    CATEGORY = "Binc/Stereo"
    DESCRIPTION = "Load a numbered image sequence from a folder as one batch (8/16-bit PNG, TIFF, JPG). For depth sets and painted-depth returns."

    @classmethod
    def IS_CHANGED(cls, folder, start, count, proxy):
        try:
            path, files = list_sequence(folder)
            sel = files[start:start + count] if count > 0 else files[start:]
            return str([(f, os.path.getmtime(os.path.join(path, f))) for f in sel]) + proxy
        except Exception:
            return float("nan")

    def run(self, folder, start, count, proxy="full"):
        t0 = time.time()
        path, files = list_sequence(folder)
        sel = files[start:start + count] if count > 0 else files[start:]
        if not sel:
            raise ValueError(f"BincLoadImageSequence: no files selected in {path} (found {len(files)}, start={start}, count={count})")
        div = {"full": 1, "half": 2, "quarter": 4, "eighth": 8}[proxy]
        pbar = progress_bar(len(sel))
        frames, src = [], None
        for f in sel:
            fp = os.path.join(path, f)
            try:
                t = load_one(fp)
            except Exception as e:
                size = os.path.getsize(fp) if os.path.exists(fp) else 0
                raise ValueError(f"BincLoadImageSequence: cannot read frame {f} ({size:,} bytes) in {path} — "
                                 f"file is truncated or corrupt. Re-export that frame and Queue again. [{type(e).__name__}: {e}]") from None
            if src is None:
                src = tuple(t.shape[:2])
            elif tuple(t.shape[:2]) != src:
                raise ValueError(f"BincLoadImageSequence: {f} is {t.shape[1]}x{t.shape[0]}, expected {src[1]}x{src[0]}")
            if div > 1:
                t = F.interpolate(t.permute(2, 0, 1).unsqueeze(0), scale_factor=1.0 / div, mode="area").squeeze(0).permute(1, 2, 0).contiguous()
            frames.append(t)
            if pbar:
                pbar.update(1)
        batch = torch.stack(frames, 0)
        H, W = batch.shape[1:3]
        info = (f"{len(sel)} files from {path}  [{sel[0]} … {sel[-1]}]  source {src[1]}x{src[0]} → {W}x{H} (proxy {proxy})  "
                f"batch {batch.numel() * 4 / 2**30:.2f} GB  {time.time() - t0:.1f}s  |  {resource_snapshot()}")
        return (batch, batch[..., 0].clone(), len(sel), info)


NODE_CLASS_MAPPINGS = {"BincLoadImageSequence": BincLoadImageSequence}
NODE_DISPLAY_NAME_MAPPINGS = {"BincLoadImageSequence": "Binc · Load Image Sequence"}
