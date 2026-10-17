<template>
  <div class="pod-form">
    <h2 class="form-title">Create New Pod</h2>
    <form @submit.prevent="submit" class="form">
      <!-- Basic Settings -->
      <div class="form-section">
        <h3 class="section-title">Basic Settings</h3>
        
        <div class="form-group">
          <label for="pod-name">Pod Name</label>
          <input
            id="pod-name"
            v-model="form.name"
            type="text"
            placeholder="e.g., ComfyUI-Dev"
            required
            class="form-input"
          />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="gpu-type">GPU Type</label>
            <select id="gpu-type" v-model="form.gpu" class="form-input">
              <option value="rtx4090">RTX 4090 ($0.42/hr)</option>
              <option value="a100">A100 ($1.00/hr)</option>
              <option value="h100">H100 ($1.50/hr)</option>
              <option value="l40s">L40S ($0.35/hr)</option>
            </select>
          </div>

          <div class="form-group">
            <label for="gpu-count">GPU Count</label>
            <select id="gpu-count" v-model.number="form.gpuCount" class="form-input">
              <option v-for="i in 8" :key="i" :value="i">{{ i }} GPU{{ i !== 1 ? 's' : '' }}</option>
            </select>
          </div>

          <div class="form-group">
            <label for="instance-type">Instance Type</label>
            <select id="instance-type" v-model="form.instanceType" class="form-input">
              <option value="on-demand">On-Demand (stable)</option>
              <option value="spot">Spot (cheaper, interruptible)</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="volume-gb">Volume (GB)</label>
            <input
              id="volume-gb"
              v-model.number="form.volumeGb"
              type="number"
              min="10"
              max="500"
              class="form-input"
            />
          </div>

          <div class="form-group">
            <label for="disk-gb">Container Disk (GB)</label>
            <input
              id="disk-gb"
              v-model.number="form.diskGb"
              type="number"
              min="5"
              max="100"
              class="form-input"
            />
          </div>
        </div>
      </div>

      <!-- Docker Image -->
      <div class="form-section">
        <h3 class="section-title">Docker Image</h3>
        
        <div class="form-group">
          <label for="image">Image</label>
          <select id="image" v-model="form.image" class="form-input">
            <option value="prebuilt">ComfyUI with Custom Nodes (ashleykza)</option>
            <option value="custom">Custom Docker Image</option>
          </select>
        </div>

        <div v-if="form.image === 'custom'" class="form-group">
          <label for="image-uri">Docker Image URI</label>
          <input
            id="image-uri"
            v-model="form.customImageUri"
            type="text"
            placeholder="e.g., docker.io/myrepo/comfyui:latest"
            class="form-input"
          />
          <p class="hint-text">Full Docker image URI (registry/namespace/image:tag)</p>
        </div>
      </div>

      <!-- Environment Variables -->
      <div class="form-section">
        <div class="section-header">
          <h3 class="section-title">Environment Variables</h3>
          <button
            type="button"
            @click="addEnvVar"
            class="btn-add"
            title="Add environment variable"
          >
            + Add
          </button>
        </div>

        <div v-if="form.envVars.length === 0" class="empty-list">
          No environment variables. Click + Add to configure.
        </div>

        <div v-for="(env, i) in form.envVars" :key="i" class="list-item">
          <input
            v-model="env.key"
            type="text"
            placeholder="Key"
            class="form-input input-sm"
          />
          <input
            v-model="env.value"
            type="text"
            placeholder="Value"
            class="form-input input-sm"
          />
          <button
            type="button"
            @click="removeEnvVar(i)"
            class="btn-remove"
            title="Remove"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Custom Pip Requirements -->
      <div class="form-section">
        <h3 class="section-title">Custom Pip Requirements</h3>
        <textarea
          v-model="form.pipRequirements"
          placeholder="One package per line&#10;Examples:&#10;torch==2.0.0&#10;transformers==4.30.0&#10;kornia==0.7.0"
          class="form-textarea"
        ></textarea>
        <p class="hint-text">Leave empty for defaults. One package per line (name or name==version)</p>
      </div>

      <!-- Custom Nodes -->
      <div class="form-section">
        <div class="section-header">
          <h3 class="section-title">Custom Node Repos</h3>
          <button
            type="button"
            @click="addCustomNode"
            class="btn-add"
            title="Add custom node repo"
          >
            + Add
          </button>
        </div>

        <div v-if="form.customNodes.length === 0" class="empty-list">
          No custom node repos. Click + Add to install from git.
        </div>

        <div v-for="(node, i) in form.customNodes" :key="i" class="list-item">
          <input
            v-model="node.name"
            type="text"
            placeholder="Node name"
            class="form-input input-sm"
          />
          <input
            v-model="node.url"
            type="text"
            placeholder="Git URL (https://github.com/...)"
            class="form-input input-sm"
          />
          <input
            v-model="node.branch"
            type="text"
            placeholder="Branch (optional)"
            class="form-input input-sm"
          />
          <button
            type="button"
            @click="removeCustomNode(i)"
            class="btn-remove"
            title="Remove"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Advanced Options -->
      <div class="form-section">
        <h3 class="section-title">Advanced Options</h3>
        
        <div class="form-row">
          <label class="checkbox-label">
            <input
              v-model="form.startSsh"
              type="checkbox"
              class="form-checkbox"
            />
            Start SSH
          </label>
          <label class="checkbox-label">
            <input
              v-model="form.startJupyter"
              type="checkbox"
              class="form-checkbox"
            />
            Start Jupyter
          </label>
        </div>
      </div>

      <!-- Form Actions -->
      <div class="form-actions">
        <button type="submit" class="btn btn-primary" :disabled="loading">
          {{ loading ? 'Creating...' : 'Create Pod' }}
        </button>
        <button type="button" class="btn btn-secondary" @click="reset">
          Reset
        </button>
      </div>

      <div v-if="error" class="alert alert-error">
        {{ error }}
      </div>
    </form>
  </div>
</template>

<script>
import { podsAPI } from '../api/pods';

export default {
  name: 'PodForm',
  emits: ['pod-created'],
  data() {
    return {
      form: {
        name: '',
        gpu: 'rtx4090',
        gpuCount: 1,
        instanceType: 'on-demand',
        volumeGb: 50,
        diskGb: 20,
        image: 'prebuilt',
        customImageUri: '',
        envVars: [],
        pipRequirements: '',
        customNodes: [],
        startSsh: true,
        startJupyter: false,
      },
      loading: false,
      error: null,
    };
  },
  methods: {
    addEnvVar() {
      this.form.envVars.push({ key: '', value: '' });
    },
    removeEnvVar(index) {
      this.form.envVars.splice(index, 1);
    },
    addCustomNode() {
      this.form.customNodes.push({ name: '', url: '', branch: '' });
    },
    removeCustomNode(index) {
      this.form.customNodes.splice(index, 1);
    },
    async submit() {
      if (!this.form.name.trim()) {
        this.error = 'Pod name is required';
        return;
      }

      if (this.form.image === 'custom' && !this.form.customImageUri.trim()) {
        this.error = 'Docker image URI is required for custom images';
        return;
      }

      // Validate env vars
      if (this.form.envVars.some(e => !e.key.trim())) {
        this.error = 'All environment variables must have a key';
        return;
      }

      // Validate custom nodes
      if (this.form.customNodes.some(n => !n.name.trim() || !n.url.trim())) {
        this.error = 'All custom nodes must have a name and URL';
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const podData = {
          name: this.form.name,
          gpu: this.form.gpu,
          gpuCount: this.form.gpuCount,
          instanceType: this.form.instanceType,
          volumeGb: this.form.volumeGb,
          diskGb: this.form.diskGb,
          image: this.form.image === 'custom' ? this.form.customImageUri : 'prebuilt',
          envVars: Object.fromEntries(this.form.envVars.map(e => [e.key, e.value])),
          pipRequirements: this.form.pipRequirements.trim(),
          customNodes: this.form.customNodes.filter(n => n.name && n.url),
          startSsh: this.form.startSsh,
          startJupyter: this.form.startJupyter,
        };
        const pod = await podsAPI.createPod(podData);
        this.$emit('pod-created', pod);
        this.reset();
      } catch (err) {
        this.error = err.response?.data?.detail || err.message || 'Failed to create pod';
      } finally {
        this.loading = false;
      }
    },
    reset() {
      this.form = {
        name: '',
        gpu: 'rtx4090',
        gpuCount: 1,
        instanceType: 'on-demand',
        volumeGb: 50,
        diskGb: 20,
        image: 'prebuilt',
        customImageUri: '',
        envVars: [],
        pipRequirements: '',
        customNodes: [],
        startSsh: true,
        startJupyter: false,
      };
      this.error = null;
    },
  },
};
</script>

<style scoped>
.pod-form {
  background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
  border-radius: 12px;
  padding: 24px;
  margin-bottom: 32px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.form-title {
  color: #fff;
  font-size: 1.5rem;
  margin-bottom: 20px;
  font-weight: 600;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.form-section {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.section-title {
  color: #e0e0e0;
  font-size: 0.95rem;
  margin: 0 0 12px 0;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.section-header .section-title {
  margin: 0;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  color: #b0b0c0;
  font-weight: 500;
  font-size: 0.9rem;
}

.form-input {
  padding: 10px 12px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-size: 0.9rem;
  transition: all 0.2s ease;
  font-family: inherit;
}

.form-input[type="text"],
.form-input[type="number"] {
  background: rgba(74, 158, 255, 0.05);
}

.form-input:focus {
  outline: none;
  border-color: #4a9eff;
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.15);
}

.form-input.input-sm {
  padding: 8px 10px;
  font-size: 0.85rem;
}

.form-input option {
  background: #1e1e2e;
  color: #fff;
}

select.form-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%234a9eff' d='M5 8L0 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  cursor: pointer;
}

.form-textarea {
  padding: 10px 12px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.05);
  color: #fff;
  font-size: 0.85rem;
  font-family: 'Monaco', 'Courier', monospace;
  resize: vertical;
  min-height: 100px;
  transition: all 0.2s ease;
}

.form-textarea:focus {
  outline: none;
  border-color: #4a9eff;
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.15);
}

.hint-text {
  font-size: 0.8rem;
  color: #8080a0;
  margin-top: 4px;
  font-style: italic;
}

.list-item {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  align-items: flex-end;
}

.list-item .form-input {
  flex: 1;
}

.btn-add {
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
  border: 1px solid rgba(74, 158, 255, 0.3);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add:hover {
  background: rgba(74, 158, 255, 0.3);
  border-color: rgba(74, 158, 255, 0.5);
}

.btn-remove {
  background: rgba(244, 67, 54, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(244, 67, 54, 0.3);
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 600;
}

.btn-remove:hover {
  background: rgba(244, 67, 54, 0.4);
  border-color: rgba(244, 67, 54, 0.5);
}

.empty-list {
  color: #8080a0;
  font-size: 0.9rem;
  padding: 8px 0;
  font-style: italic;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #b0b0c0;
  font-size: 0.9rem;
  cursor: pointer;
  font-weight: 500;
}

.form-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: #4a9eff;
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

.btn {
  padding: 11px 22px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 0.9rem;
}

.btn-primary {
  background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
  color: white;
  flex: 1;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(74, 158, 255, 0.4);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.1);
  color: #e0e0e0;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.3);
}

.alert {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.9rem;
}

.alert-error {
  background: rgba(255, 68, 68, 0.1);
  color: #ff6b6b;
  border: 1px solid rgba(255, 68, 68, 0.3);
}
</style>
