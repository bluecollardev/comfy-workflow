# Component Documentation

## Overview

RunPod Pod Manager UI is built with **Vue 3**, **Bootstrap Vue Next**, and **Tailwind CSS** with a professional dark theme.

### Tech Stack
- **Vue 3** — Modern reactive UI framework
- **Vite** — Fast build tool and dev server
- **Bootstrap Vue Next** — Bootstrap 5 component library for Vue 3
- **Tailwind CSS** — Utility-first CSS framework
- **Axios** — HTTP client for API calls

### Architecture

The app follows a hierarchical component structure:

```
App.vue (Root)
├── Header
├── Stats.vue (stat cards)
└── Dashboard.vue (main container)
    ├── Create Pod Form (collapsible)
    │   └── PodForm.vue
    └── Pods List
        └── PodCard.vue (repeating)
```

---

## Component Reference

### App.vue (Root Component)

**Purpose:** Main entry point and data orchestrator

**Responsibilities:**
- Fetch dashboard data from API (`GET /api/dashboard`)
- Manage loading and error states
- Auto-refresh data every 30 seconds
- Render header with title and refresh button
- Pass data to child components

**Props:** None (root component)

**Emitted Events:** None (root component)

**State Variables:**
- `dashboard` — Object with `{stats, pods}`
- `loading` — Boolean
- `error` — String or null

**Key Methods:**
- `loadDashboard()` — Fetch data from API
- `handlePodsUpdated(pods)` — Update dashboard pods
- `refresh()` — Manual refresh trigger

**API Calls:**
```javascript
// GET /api/dashboard
// Returns: {
//   stats: {
//     total_pods: number,
//     running_pods: number,
//     stopped_pods: number
//   },
//   pods: [{id, name, status, gpu, vram, ...}, ...]
// }
```

**Example Usage:**
```html
<template>
  <App />
</template>

<script setup>
import App from './App.vue'
</script>
```

---

### Stats.vue (Statistics Display)

**Purpose:** Display pod count statistics in a responsive card grid

**Responsibilities:**
- Show total, running, and stopped pod counts
- Provide visual indicators with colored left borders
- Responsive layout (1 col mobile, 2 cols tablet, 3 cols desktop)

**Props:**
```javascript
{
  stats: {
    total_pods: number,      // Total pods
    running_pods: number,    // Running pods
    stopped_pods: number,    // Stopped pods
  }
}
```

**Emitted Events:** None

**Features:**
- Colored left borders: blue (total), green (running), red (stopped)
- Large number display (42px font)
- Hover shadow effect
- Bootstrap Vue grid system (b-row, b-col)

**Example Usage:**
```html
<Stats :stats="dashboard.stats" />
```

**Sample Data:**
```javascript
{
  total_pods: 5,
  running_pods: 3,
  stopped_pods: 2
}
```

---

### Dashboard.vue (Main Container)

**Purpose:** Coordinate pod creation form and pod list display

**Responsibilities:**
- Toggle pod creation form visibility
- Display pods in responsive grid
- Handle pod actions (stop, resume, delete)
- Show loading/error states
- Emit pod updates to parent

**Props:**
```javascript
{
  pods: Array    // Array of pod objects
}
```

**Emitted Events:**
```javascript
{
  'pods-updated': Array   // Emit updated pods array
}
```

**State Variables:**
- `showCreateForm` — Boolean
- `loading` — Boolean
- `error` — String or null

**Key Methods:**
- `handlePodCreated()` — After form submission
- `handleStop(podId)` — Stop a running pod
- `handleResume(podId)` — Resume a stopped pod
- `handleDelete(podId)` — Delete a pod
- `refreshPods()` — Fetch updated pods list

**API Calls:**
```javascript
// POST /api/pods
await podsAPI.createPod(payload)

// POST /api/pods/{id}/stop
await podsAPI.stopPod(podId)

// POST /api/pods/{id}/resume
await podsAPI.resumePod(podId)

// DELETE /api/pods/{id}
await podsAPI.deletePod(podId)

// GET /api/pods
await podsAPI.listPods()
```

**Example Usage:**
```html
<Dashboard :pods="dashboard.pods" @pods-updated="handlePodsUpdated" />
```

---

### PodForm.vue (Pod Creation Form)

**Purpose:** Collect configuration for creating a new pod

**Responsibilities:**
- Provide form inputs for pod configuration
- Validate required fields
- Handle collapsible advanced sections
- Submit to API and report success/errors
- Reset form after successful creation

**Emitted Events:**
```javascript
{
  'pod-created': null   // Emitted on successful creation
}
```

**Form Fields:**

| Field | Type | Required | Range | Default |
|-------|------|----------|-------|---------|
| `name` | string | Yes | Any | "" |
| `gpu` | select | No | rtx4090/a100/h100/l40s | rtx4090 |
| `gpuCount` | number | No | 1-8 | 1 |
| `instanceType` | select | No | on-demand/spot | on-demand |
| `volumeGb` | number | No | 10-500 | 50 |
| `diskGb` | number | No | 5-100 | 20 |
| `image` | select | No | prebuilt/custom | prebuilt |
| `customImageUri` | string | Conditional* | Any | "" |
| `envVars` | textarea | No | Newline-separated | "" |
| `pipRequirements` | textarea | No | Newline-separated | "" |
| `customNodes` | textarea | No | Newline-separated | "" |

*Required if `image` is set to "custom"

**Validation Rules:**
- Pod name must not be empty
- Custom image URI required if custom image selected
- All numeric fields checked by HTML input constraints

**Format for Text Areas:**
```
# Environment Variables (KEY=value format)
CUDA_VISIBLE_DEVICES=0
WORKER_THREADS=4

# Pip Requirements (package==version format)
torch==2.0.0
torchaudio==2.0.0

# Custom Nodes (Git URLs)
https://github.com/user/comfy-node-pack
https://github.com/another/custom-nodes
```

**Key Methods:**
- `submit()` — Validate and submit form
- `parseLines(text)` — Parse newline-separated input

**API Call:**
```javascript
// POST /api/pods
await podsAPI.createPod({
  name: string,
  gpu: string,
  gpu_count: number,
  instance_type: string,
  volume_gb: number,
  disk_gb: number,
  image_uri: string,
  environment_variables: string[],
  pip_requirements: string[],
  custom_nodes: string[]
})
```

**Example Usage:**
```html
<PodForm @pod-created="handlePodCreated" />
```

---

### PodCard.vue (Individual Pod Display)

**Purpose:** Display details and actions for a single pod

**Responsibilities:**
- Show pod information (ID, GPU, VRAM, uptime, etc.)
- Display status badge with color coding
- Provide action buttons (stop/resume, delete)
- Handle delete confirmation dialog

**Props:**
```javascript
{
  pod: {
    id: string,              // Pod ID
    name: string,            // Pod name
    status: string,          // running, stopped, starting
    gpu: string,             // GPU type (RTX4090, etc.)
    vram: number,            // VRAM in GB
    uptime_seconds: number,  // Optional
    web_ui_url: string,      // Optional
    ssh_command: string      // Optional
  }
}
```

**Emitted Events:**
```javascript
{
  'stop': null,    // Stop button clicked
  'resume': null,  // Resume button clicked
  'delete': null   // Delete confirmed
}
```

**Status Badge Colors:**
- `running` → Green badge (success)
- `stopped` → Red badge (danger)
- `starting` → Yellow badge (warning)
- other → Gray badge (secondary)

**Key Methods:**
- `formatUptime(seconds)` — Convert seconds to "2h 15m" format
- `statusVariant(status)` — Get Bootstrap variant for badge
- `deleteConfirm()` — Show confirmation dialog

**Features:**
- Responsive card layout
- Hover effects
- Status-dependent button (Stop vs Resume)
- Conditional displays (uptime if available, web UI if available)
- SSH command copyable in monospace font
- Deletion confirmation before removal

**Example Usage:**
```html
<PodCard
  :pod="pod"
  @stop="handleStop(pod.id)"
  @resume="handleResume(pod.id)"
  @delete="handleDelete(pod.id)"
/>
```

**Sample Pod Data:**
```javascript
{
  id: "abc123def456",
  name: "ComfyUI-Dev",
  status: "running",
  gpu: "RTX 4090",
  vram: 24,
  uptime_seconds: 3600,
  web_ui_url: "https://pod.runpod.io:8188",
  ssh_command: "ssh root@pod.runpod.io -p 22"
}
```

---

## Styling System

### Colors (Tailwind Custom Config)

Dark theme palette in `tailwind.config.js`:

```javascript
colors: {
  dark: {
    50: '#f8f8fa',   // Lightest
    100: '#e8e8f0',
    200: '#d0d0e0',
    300: '#b0b0c0',
    400: '#8080a0',
    500: '#6060a0',
    600: '#4a4a80',
    700: '#3a3a60',
    800: '#2a2a3e',  // Card background
    900: '#1a1a2e',  // Page background
    950: '#0f0f1e',  // Darkest
  },
  primary: '#4a9eff',      // Blue
  success: '#4caf50',      // Green
  danger: '#f44336',       // Red
  warning: '#ffc107',      // Yellow
  info: '#00d9ff',         // Cyan
}
```

### CSS Classes (index.css)

- `.card-dark` — Card component styling (background, border, shadow)
- `.btn-primary` — Primary action button
- `.btn-secondary` — Secondary action button
- `.btn-danger` — Danger/delete button
- `.section-header` — Section header styling
- `.toggle-icon` — Chevron icon with rotation
- `.spinner` — Loading spinner animation
- `.alert-error` — Error alert box

### Bootstrap Vue Components Used

- `b-button` — Buttons with variants
- `b-form-group` — Form input wrappers
- `b-form-input` — Text inputs
- `b-form-select` — Dropdown selects
- `b-form-textarea` — Multi-line text
- `b-row` / `b-col` — Responsive grid
- `b-badge` — Status badges
- `b-alert` — Alert messages
- `b-collapse` — Collapsible sections
- `b-spinner` — Loading indicator

---

## Data Flow

### Pod Creation Flow
```
User fills form
    ↓
Click "Create Pod"
    ↓
PodForm.submit() validates
    ↓
POST /api/pods with payload
    ↓
Success: GET /api/pods (refresh list)
    ↓
Dashboard emits 'pods-updated'
    ↓
App.vue updates dashboard.pods
    ↓
Dashboard re-renders with new pod
```

### Pod Stop/Resume/Delete Flow
```
User clicks button on PodCard
    ↓
Dashboard.handleStop/Resume/Delete()
    ↓
POST /api/pods/{id}/stop (or /resume or DELETE)
    ↓
GET /api/pods (refresh list)
    ↓
Dashboard emits 'pods-updated'
    ↓
App.vue updates dashboard.pods
    ↓
PodCard component updates
```

---

## State Management Philosophy

**No global state library** — Using Vue 3 Composition API with props and emits:

1. **App.vue** — Root state holder
   - Owns `dashboard`, `loading`, `error`
   - Fetches from API
   - Passes down via props

2. **Dashboard.vue** — Local state
   - Owns `showCreateForm`, local `loading`, local `error`
   - Receives `pods` from parent (prop)
   - Emits updates back to parent
   - Manages pod actions (stop/resume/delete)

3. **Child components** — Presentation only
   - Stats, PodCard: Display only, no state changes
   - PodForm: Form-only state, emits on creation

**Rationale:** Simple unidirectional data flow, easy to understand and debug.

---

## CSS Organization

**Approach:** Minimal scoped CSS, maximum Tailwind

Each component has:
```vue
<style scoped>
/* All styling handled by index.css and Tailwind */
</style>
```

Shared styles in `src/index.css`:
- Base resets and typography
- Component classes (.card-dark, .btn-*, etc.)
- Animations (spin, fade, expand)
- Form utilities

---

## Future Improvements

- [ ] Add pagination to pods list (if > 100 pods)
- [ ] Add pod filtering/search
- [ ] Add pod sorting (by name, status, creation date)
- [ ] Add pod metrics graph (CPU, memory, GPU utilization)
- [ ] WebSocket updates instead of polling every 30s
- [ ] Draggable pod cards (organize by groups)
- [ ] Dark/light theme toggle
- [ ] Mobile responsive tweaks for phone size
- [ ] Accessibility improvements (ARIA labels)
- [ ] Unit tests for form validation
- [ ] E2E tests for pod lifecycle

