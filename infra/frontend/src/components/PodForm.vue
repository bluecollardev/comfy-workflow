<template>
  <form @submit.prevent="submit" class="form">
    <!-- Basic Settings -->
    <div class="form-section">
      <div class="form-row">
        <div class="form-group">
          <label for="pod-name">Name</label>
          <input
            id="pod-name"
            v-model="form.name"
            type="text"
            placeholder="e.g., ComfyUI-Dev"
            required
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label for="gpu-type">GPU</label>
          <select id="gpu-type" v-model="form.gpu" class="form-input">
            <option value="rtx4090">RTX 4090</option>
            <option value="a100">A100</option>
            <option value="h100">H100</option>
            <option value="l40s">L40S</option>
          </select>
        </div>

        <div class="form-group">
          <label for="gpu-count">Count</label>
          <select id="gpu-count" v-model.number="form.gpuCount" class="form-input">
            <option v-for="i in 8" :key="i" :value="i">{{ i }}</option>
          </select>
        </div>

        <div class="form-group">
          <label for="instance-type">Type</label>
          <select id="instance-type" v-model="form.instanceType" class="form-input">
            <option value="on-demand">On-Demand</option>
            <option value="spot">Spot</option>
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
          <label for="disk-gb">Disk (GB)</label>
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

      <div class="form-row">
        <div class="form-group">
          <label for="image">Image</label>
          <select id="image" v-model="form.image" class="form-input">
            <option value="prebuilt">ComfyUI (ashleykza)</option>
            <option value="custom">Custom URI</option>
          </select>
        </div>

        <div v-if="form.image === 'custom'" class="form-group">
          <label for="image-uri">Docker URI</label>
          <input
            id="image-uri"
            v-model="form.customImageUri"
            type="text"
            placeholder="docker.io/repo/image:tag"
            class="form-input"
          />
        </div>
      </div>
    </div>

    <!-- Advanced Sections (Collapsible) -->
    <div class="collapsible-section">
      <button
        type="button"
        @click="expanded.envVars = !expanded.envVars"
        class="section-toggle"
      >
        <span class="toggle-icon">{{ expanded.envVars ? '▼' : '▶' }}</span>
        Environment Variables
        <span v-if="form.envVars.length" class="badge">{{ form.envVars.length }}</span>
      </button>

      <div v-if="expanded.envVars" class="section-content">
        <div v-if="form.envVars.length === 0" class="empty-state">No variables added</div>
        <div v-for="(env, i) in form.envVars" :key="i" class="list-item-compact">
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
          <button type="button" @click="removeEnvVar(i)" class="btn-remove">✕</button>
        </div>
        <button type="button" @click="addEnvVar" class="btn-add-small">+ Add Variable</button>
      </div>
    </div>

    <!-- Pip Requirements -->
    <div class="collapsible-section">
      <button
        type="button"
        @click="expanded.pip = !expanded.pip"
        class="section-toggle"
      >
        <span class="toggle-icon">{{ expanded.pip ? '▼' : '▶' }}</span>
        Custom Pip Packages
      </button>

      <div v-if="expanded.pip" class="section-content">
        <textarea
          v-model="form.pipRequirements"
          placeholder="One per line: torch==2.0.0"
          class="form-textarea-compact"
        ></textarea>
      </div>
    </div>

    <!-- Custom Nodes -->
    <div class="collapsible-section">
      <button
        type="button"
        @click="expanded.nodes = !expanded.nodes"
        class="section-toggle"
      >
        <span class="toggle-icon">{{ expanded.nodes ? '▼' : '▶' }}</span>
        Custom Node Repos
        <span v-if="form.customNodes.length" class="badge">{{ form.customNodes.length }}</span>
      </button>

      <div v-if="expanded.nodes" class="section-content">
        <div v-if="form.customNodes.length === 0" class="empty-state">No repos added</div>
        <div v-for="(node, i) in form.customNodes" :key="i" class="list-item-compact">
          <input
            v-model="node.name"
            type="text"
            placeholder="Name"
            class="form-input input-sm"
          />
          <input
            v-model="node.url"
            type="text"
            placeholder="https://github.com/..."
            class="form-input input-sm"
          />
          <button type="button" @click="removeCustomNode(i)" class="btn-remove">✕</button>
        </div>
        <button type="button" @click="addCustomNode" class="btn-add-small">+ Add Repo</button>
      </div>
    </div>

    <!-- Advanced Options -->
    <div class="collapsible-section">
      <button
        type="button"
        @click="expanded.advanced = !expanded.advanced"
        class="section-toggle"
      >
        <span class="toggle-icon">{{ expanded.advanced ? '▼' : '▶' }}</span>
        Advanced
      </button>

      <div v-if="expanded.advanced" class="section-content">
        <label class="checkbox-label">
          <input
            v-model="form.startSsh"
            type="checkbox"
            class="form-checkbox"
          />
          SSH
        </label>
        <label class="checkbox-label">
          <input
            v-model="form.startJupyter"
            type="checkbox"
            class="form-checkbox"
          />
          Jupyter
        </label>
      </div>
    </div>

    <!-- Form Actions -->
    <div class="form-actions">
      <button type="submit" class="btn btn-primary" :disabled="loading">
        {{ loading ? 'Creating...' : 'Create' }}
      </button>
      <button type="button" class="btn btn-secondary" @click="reset">Reset</button>
    </div>

    <div v-if="error" class="alert alert-error">{{ error }}</div>
  </form>
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
      expanded: {
        envVars: false,
        pip: false,
        nodes: false,
        advanced: false,
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
        this.error = 'Docker image URI is required';
        return;
      }

      if (this.form.envVars.some(e => !e.key.trim())) {
        this.error = 'All environment variables must have a key';
        return;
      }

      if (this.form.customNodes.some(n => !n.name.trim() || !n.url.trim())) {
        this.error = 'All custom nodes must have name and URL';
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
.form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 0;
}

.form-section {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.form-row:last-child {
  margin-bottom: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  color: #b0b0c0;
  font-weight: 500;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.form-input {
  padding: 8px 10px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.03);
  color: #fff;
  font-size: 0.85rem;
  transition: all 0.2s ease;
  font-family: inherit;
}

.form-input:focus {
  outline: none;
  border-color: #4a9eff;
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.15);
}

.form-input.input-sm {
  padding: 6px 8px;
  font-size: 0.8rem;
}

select.form-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 8 8'%3E%3Cpath fill='%234a9eff' d='M4 6L0 2h8z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  padding-right: 24px;
  cursor: pointer;
}

.collapsible-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  overflow: hidden;
}

.section-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.02);
  border: none;
  color: #b0b0c0;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  text-align: left;
}

.section-toggle:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
}

.toggle-icon {
  display: inline-block;
  width: 16px;
  font-size: 0.7rem;
}

.badge {
  margin-left: auto;
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
  padding: 2px 6px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}

.section-content {
  padding: 12px;
  background: rgba(255, 255, 255, 0.01);
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.empty-state {
  color: #8080a0;
  font-size: 0.8rem;
  padding: 8px 0;
}

.list-item-compact {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
  align-items: flex-end;
}

.list-item-compact .form-input {
  flex: 1;
}

.form-textarea-compact {
  width: 100%;
  padding: 8px 10px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  background: rgba(74, 158, 255, 0.05);
  color: #fff;
  font-size: 0.8rem;
  font-family: 'Monaco', 'Courier', monospace;
  resize: vertical;
  min-height: 70px;
  transition: all 0.2s;
}

.form-textarea-compact:focus {
  outline: none;
  border-color: #4a9eff;
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 0 2px rgba(74, 158, 255, 0.15);
}

.btn-remove {
  background: rgba(244, 67, 54, 0.2);
  color: #ff6b6b;
  border: 1px solid rgba(244, 67, 54, 0.3);
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-remove:hover {
  background: rgba(244, 67, 54, 0.4);
}

.btn-add-small {
  background: rgba(74, 158, 255, 0.2);
  color: #4a9eff;
  border: 1px solid rgba(74, 158, 255, 0.3);
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
  margin-top: 6px;
}

.btn-add-small:hover {
  background: rgba(74, 158, 255, 0.3);
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #b0b0c0;
  font-size: 0.85rem;
  cursor: pointer;
  margin-bottom: 6px;
}

.checkbox-label:last-child {
  margin-bottom: 0;
}

.form-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #4a9eff;
}

.form-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.btn {
  padding: 9px 16px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.85rem;
}

.btn-primary {
  background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
  color: white;
  flex: 1;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
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
}

.alert {
  padding: 10px 12px;
  border-radius: 6px;
  font-size: 0.8rem;
  margin-top: 4px;
}

.alert-error {
  background: rgba(255, 68, 68, 0.1);
  color: #ff6b6b;
  border: 1px solid rgba(255, 68, 68, 0.3);
}
</style>
