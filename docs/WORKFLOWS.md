# Workflows Guide

Best practices and patterns for creating and managing ComfyUI workflows in this project.

## Workflow Organization

### Fragments (`fragments/`)

Reusable, single-purpose workflow components. Each fragment:
- Performs ONE logical operation (e.g., load image, generate image, upscale)
- Has typed inputs and outputs
- Can be composed with other fragments
- Lives in `fragments/{name}.json`

**Examples:**
- `fragments/load_image.json` - Load and prepare image input
- `fragments/text_to_image.json` - T2I generation (Flux, SDXL, etc.)
- `fragments/image_upscale.json` - Upscale with Real-ESRGAN
- `fragments/save_output.json` - Save images with metadata

### Blueprints (`blueprints/`)

Workflow compositions combining fragments. Each blueprint:
- Orchestrates a complete workflow (e.g., "generate 3 variations and upscale")
- Defines inputs, outputs, and inter-fragment wiring
- Written in YAML for readability
- Produces `{name}.compiled.json` when composed
- Can include loops (`foreach`) for batch processing

**Examples:**
- `blueprints/basic_t2i.yaml` - Simple text-to-image
- `blueprints/image_enhance.yaml` - Load → Enhance → Upscale → Save
- `blueprints/batch_generation.yaml` - Generate N variations with foreach

## Creating a Workflow

### Step 1: Plan the Flow

```
User Input (Prompt, Image)
    ↓
Fragment 1: Load/Prepare
    ↓
Fragment 2: Process (Generate, Edit, etc.)
    ↓
Fragment 3: Enhance (Optional)
    ↓
Fragment 4: Save Output
```

### Step 2: Create Fragments (Bottom-Up)

Build and test each fragment independently in ComfyUI, then decompose:

```bash
# On RunPod pod, build a working workflow
# Save as reference_workflow.json

# Decompose into fragments
comfy workflow decompose reference_workflow.json --name my_workflow

# This creates fragments/my_workflow.json with:
# - Inputs (replaced loaders)
# - Outputs (removed save nodes)
# - Params (widget values)
```

### Step 3: Compose Blueprint

Create `blueprints/example.yaml`:

```yaml
pipeline:
  - fragment: load_image
    alias: img
    inputs:
      image: $asset.reference.png

  - fragment: text_to_image
    alias: gen
    inputs:
      source: $img.output
    params:
      prompt: "a fox in a forest"
      seed: 42

  - fragment: save_output
    alias: save
    inputs:
      image: $gen.image
```

### Step 4: Compose & Run

```bash
cd ~/workspaces/comfy_workflow

# Compose YAML → JSON
comfy workflow compose blueprints/example.yaml

# Run on pod
comfy run --workflow blueprints/example.compiled.json --where cloud
```

## Common Patterns

### Pattern 1: Batch Generation with foreach

Generate multiple variations automatically:

```yaml
output_prefix: outputs/batch
foreach:
  - {id: v1, prompt: "style A"}
  - {id: v2, prompt: "style B"}
  - {id: v3, prompt: "style C"}

pipeline:
  - fragment: text_to_image
    params:
      prompt: $item.prompt
```

Result: 3 images named `v1_000.png`, `v2_000.png`, `v3_000.png`

### Pattern 2: Reference Image with Edits

Load an image and apply variations:

```yaml
pipeline:
  - fragment: load_image
    alias: ref
    inputs:
      image: $asset.original.png

  - fragment: image_enhance
    alias: enhanced
    inputs:
      source: $ref.image
    params:
      saturation: 1.2
      contrast: 1.1

  - fragment: save_output
    inputs:
      image: $enhanced.image
```

### Pattern 3: Multi-Stage with Assets

Use uploaded files as inputs:

```bash
# 1. Upload assets
cp ~/images/keyframe.png assets/
comfy assets push

# 2. Reference in blueprint
inputs:
  start_image: $asset.keyframe.png
```

## Versioning & Iteration

```
blueprints/
├── basic_t2i.yaml
├── basic_t2i.compiled.json    (auto-generated)
├── basic_t2i_v2.yaml          (iteration)
└── basic_t2i_v2.compiled.json
```

Keep YAML source files, `.compiled.json` are build artifacts.

## Testing Workflows

### Local Testing
```bash
# Check workflow is valid
comfy workflow validate blueprints/example.compiled.json

# Dry-run (see what would be submitted)
comfy run --workflow blueprints/example.compiled.json --print-prompt
```

### Cloud Testing
```bash
# Run on RunPod pod
comfy run --workflow blueprints/example.compiled.json --where cloud --wait

# Results in outputs/
```

## Workflow Library

As you build reusable workflows:

| Workflow | Purpose | Inputs | Notes |
|----------|---------|--------|-------|
| `basic_t2i` | Text to image | prompt, seed | Flux or SDXL |
| `img_enhance` | Quality upscaling | image, strength | Real-ESRGAN |
| `batch_gen` | 10+ images | prompts, seeds | foreach loop |
| `i2v_video` | Image to video | image, prompt | Kling/Grok |

*(To be populated as workflows are created)*

## Best Practices

1. **One fragment = one responsibility** (load, process, save)
2. **Use `$asset` for persistent files**, not inline base64
3. **Test fragments independently** before composing
4. **Version blueprints, don't hand-edit compiled JSON**
5. **Document params and their ranges** in fragment descriptions
6. **Use foreach for variations**, don't create N separate workflows
7. **Clean up outputs regularly** to manage storage costs

## Resources

- ComfyUI docs: https://docs.comfy.org
- RunPod documentation: https://docs.runpod.io
- ComfyUI workflow templates: https://github.com/Comfy-Org/workflow_templates
