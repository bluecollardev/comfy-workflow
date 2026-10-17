<template>
  <div class="pod-form">
    <h2 class="form-title">Create New Pod</h2>
    <form @submit.prevent="submit" class="form">
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
            <option value="rtx4090">RTX 4090</option>
            <option value="a100">A100</option>
            <option value="h100">H100</option>
            <option value="l40s">L40S</option>
          </select>
        </div>

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

      <div class="form-group">
        <label for="image">Image</label>
        <select id="image" v-model="form.image" class="form-input">
          <option value="prebuilt">ComfyUI (Prebuilt)</option>
          <option value="custom">Custom</option>
        </select>
      </div>

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
        volumeGb: 50,
        diskGb: 20,
        image: 'prebuilt',
      },
      loading: false,
      error: null,
    };
  },
  methods: {
    async submit() {
      if (!this.form.name.trim()) {
        this.error = 'Pod name is required';
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const pod = await podsAPI.createPod(this.form);
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
        volumeGb: 50,
        diskGb: 20,
        image: 'prebuilt',
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
  gap: 20px;
}

.form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  color: #e0e0e0;
  font-weight: 500;
  font-size: 0.95rem;
}

.form-input {
  padding: 10px 14px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  color: #fff;
  font-size: 0.95rem;
  transition: all 0.3s ease;
}

.form-input:focus {
  outline: none;
  border-color: #4a9eff;
  background: rgba(74, 158, 255, 0.1);
  box-shadow: 0 0 12px rgba(74, 158, 255, 0.2);
}

.form-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  font-size: 0.95rem;
}

.btn-primary {
  background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
  color: white;
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
