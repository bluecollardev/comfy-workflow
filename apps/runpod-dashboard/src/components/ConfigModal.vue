<template>
  <BModal
    :model-value="forPod ? modelValue : ui.configOpen"
    :no-close-on-backdrop="gated" :no-close-on-esc="gated" :hide-header-close="gated"
    :title="forPod ? $t('config.podTitle', { name: podName }) : $t('config.title')"
    size="xl"
    scrollable
    @update:model-value="forPod ? emit('update:modelValue', $event) : (ui.configOpen = $event)"
    :modal-class="overStudio ? 'over-studio' : ''"
    @show="load"
    @hide="onHide"
    @shown="focusSection"
  >
    <p class="text-body-secondary small mb-3" :data-testid="forPod ? 'config-modal-pod' : 'config-modal'">{{ forPod ? $t('config.podIntro') : $t('config.intro') }}</p>

    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>

    <template v-else-if="cfg">
      <ConfigIoPanel v-if="!forPod" :flash="ioFlash" @applied="afterImport" />
      <details class="mb-2">
        <summary class="small text-body-secondary">{{ $t('config.previewLocal') }}</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap">{{ localText }}</pre>
      </details>
      <details class="mb-3">
        <summary class="small text-body-secondary" data-testid="preview-pod-toggle">{{ $t('config.previewPod') }}</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap" data-testid="preview-pod">{{ previewText }}</pre>
      </details>
      <!-- The pod's name, above the tabs: a name in this app only (RunPod keeps its own) -->
      <BFormGroup v-if="forPod && podId" :label="$t('config.podNameLabel')" label-for="cfg-pod-name" :description="$t('config.podNameHelp', { name: runpodName || podName })" class="mb-3">
        <div class="input-group input-group-sm">
          <input id="cfg-pod-name" v-model="nameDraft" type="text" class="form-control" maxlength="80" :placeholder="runpodName || podName" data-testid="cfg-pod-name" @keydown.enter.prevent="saveName" />
          <button type="button" class="btn btn-outline-light" :disabled="!nameChanged" :title="$t('config.podNameSave')" data-testid="cfg-pod-name-save" @click="saveName"><i class="fa-solid fa-check"></i></button>
        </div>
      </BFormGroup>
      <BAlert v-if="gated" :model-value="true" variant="warning" class="mb-3" data-testid="cfg-key-gate">
        <i class="fa-solid fa-key me-2"></i>{{ $t('config.keyGate') }}
      </BAlert>

      <!-- Tabs on a wide screen (desktop, landscape tablet); on a phone or a portrait tablet the sections flow down the page. -->
      <ul v-if="wide && !gated" class="nav nav-tabs mb-3" role="tablist" data-testid="cfg-tabs">
        <li v-for="t in tabList" :key="t.key" class="nav-item" role="presentation">
          <button type="button" class="nav-link" :class="{ active: tab === t.key }" role="tab" :aria-selected="tab === t.key" :data-testid="`cfg-tab-${t.key}`" @click="tab = t.key">{{ t.label }}</button>
        </li>
      </ul>
      <fieldset v-if="!forPod" v-show="show('runpod')" class="cfg-section" data-section="runpod">
      <legend data-testid="section-runpod">{{ $t('config.runpod') }}</legend>
      <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('config.runpodHint') }}</BAlert>
      <BRow class="g-3">
        <BCol md="8">
          <BFormGroup :label="$t('config.apiKey')" label-for="cfg-key" data-testid="cfg-key-group" :description="keyInfo.runpod_api_key_set ? $t('config.apiKeyStored', { hint: keyInfo.runpod_api_key_hint, source: keyInfo.source }) : $t('config.apiKeyUnset')">
            <BFormInput id="cfg-key" v-model.trim="newKey" type="password" autocomplete="off" placeholder="rpa_…" class="font-monospace" data-testid="cfg-key" />
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="6">
          <BFormGroup :label="$t('config.s3Access')" label-for="cfg-s3-access" :description="keyInfo.s3_keys_set ? $t('config.s3Stored', { hint: keyInfo.s3_access_key_hint }) : $t('config.s3Unset')" data-testid="cfg-s3-group">
            <BFormInput id="cfg-s3-access" v-model.trim="newS3.access" autocomplete="off" placeholder="user_…" class="font-monospace" data-testid="cfg-s3-access" />
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="6">
          <BFormGroup :label="$t('config.s3Secret')" label-for="cfg-s3-secret">
            <BFormInput id="cfg-s3-secret" v-model.trim="newS3.secret" type="password" autocomplete="off" placeholder="rps_…" class="font-monospace" data-testid="cfg-s3-secret" />
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="8">
          <BFormGroup :label="$t('config.claudeKey')" label-for="cfg-claude-key" data-testid="cfg-claude-group" :description="keyInfo.anthropic_key_set ? $t('config.claudeStored', { hint: keyInfo.anthropic_key_hint }) : $t('config.claudeUnset')">
            <BFormInput id="cfg-claude-key" v-model.trim="newClaude" type="password" autocomplete="off" placeholder="sk-ant-…" class="font-monospace" data-testid="cfg-claude-key" />
            <div v-if="claudeChecking || claudeResult" class="small mt-1" :class="claudeChecking ? 'text-body-secondary' : claudeResult.ok ? 'text-success' : 'text-danger'" data-testid="cfg-claude-result" :data-ok="claudeChecking ? 'checking' : claudeResult.ok ? 'true' : 'false'">
              <template v-if="claudeChecking"><BSpinner small class="me-2 flex-shrink-0" />{{ $t('config.claudeChecking') }}</template>
              <template v-else><i class="fa-solid me-1" :class="claudeResult.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'"></i>{{ claudeResult.ok ? (newClaude ? $t('config.claudeWorksTyped') : $t('config.claudeWorks')) : claudeResult.error }}</template>
            </div>
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="8">
          <BFormGroup :label="$t('config.hfToken')" label-for="cfg-hf-token" data-testid="cfg-hf-group" :description="keyInfo.hf_token_set ? $t('config.hfStored', { hint: keyInfo.hf_token_hint }) : $t('config.hfUnset')">
            <BFormInput id="cfg-hf-token" v-model.trim="newHf" type="password" autocomplete="off" placeholder="hf_…" class="font-monospace" data-testid="cfg-hf-token" />
            <div class="form-text">{{ $t('config.hfHelp') }} <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noopener">huggingface.co/settings/tokens</a></div>
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="12"><hr class="my-1" /><div class="small fw-semibold" data-testid="cfg-agent-title">{{ $t('config.agentTitle') }}</div><div class="form-text mt-0">{{ $t('config.agentHelp') }}</div></BCol>
        <BCol v-if="!gated" md="7">
          <BFormCheckbox v-model="agentRules.namedYes" switch data-testid="cfg-agent-named-yes">{{ $t('config.agentNamedYes') }}</BFormCheckbox>
          <div class="form-text mt-0">{{ $t('config.agentNamedYesHelp') }}</div>
        </BCol>
        <BCol v-if="!gated" md="5">
          <BFormGroup :label="$t('config.agentCap')" label-for="cfg-agent-cap" :description="$t('config.agentCapHelp')">
            <BFormInput id="cfg-agent-cap" v-model.number="agentRules.cap" type="number" min="0" step="1" data-testid="cfg-agent-cap" />
          </BFormGroup>
        </BCol>
      </BRow>
      </fieldset>

      <template v-if="!gated">
      <fieldset v-show="show('volume')" class="cfg-section" data-section="volume">
      <legend data-testid="section-volume">{{ forPod ? $t('config.volumePod') : $t('config.volume') }}</legend>
      <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ forPod ? $t('config.volumePodHint') : $t('config.volumeHint') }}</BAlert>
      <BRow class="g-3">
        <BCol cols="12">
          <!-- The default configuration: the datacenter and the cards go together, chosen in the same window as Import Round's step 3 (Choose Card) -->
          <div class="border rounded p-2" data-testid="cfg-cards-block">
            <div class="d-flex align-items-center gap-3 flex-wrap mb-2">
              <span class="fw-semibold">{{ $t('config.cardsTitle') }}</span>
              <span class="small" data-testid="cfg-cards-dc"><span class="text-body-secondary">{{ $t('config.cardsDcLabel') }}</span> <strong>{{ cfg.data_center_id || $t('config.datacenterAny') }}</strong></span>
            </div>
            <div class="border rounded p-2 mb-2" data-testid="cfg-cards-default-row">
              <div class="small fw-semibold mb-1">{{ $t('config.cardsDefaultTitle') }}</div>
              <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                <BButton :variant="chosenCards.length ? 'outline-success' : 'outline-light'" size="sm" data-testid="cfg-choose-card-btn" @click="cardModal = 'default'"><i class="fa-solid fa-microchip me-1"></i>{{ $t('config.cardsSelectDefault') }}</BButton>
                <span class="small" data-testid="cfg-cards-chosen"><span class="text-body-secondary">{{ $t('config.cardsLabel') }}</span> <strong>{{ chosenCards.length ? chosenCards.map(cardName).join(', ') : $t('config.cardsStock') }}</strong></span>
              </div>
              <div class="form-text" data-testid="cfg-cards-help">{{ $t('config.cardsHelp') }}</div>
            </div>
            <div class="border rounded p-2" data-testid="cfg-cards-stock-row">
              <div class="small fw-semibold mb-1">{{ $t('config.cardsStockTitle') }}</div>
              <div class="d-flex align-items-center gap-2 flex-wrap mb-1">
                <BButton :variant="stockCards.length ? 'outline-success' : 'outline-light'" size="sm" data-testid="cfg-choose-stock-btn" @click="cardModal = 'stock'"><i class="fa-solid fa-microchip me-1"></i>{{ $t('config.cardsSelectStock') }}</BButton>
                <span class="small" data-testid="cfg-cards-stock"><span class="text-body-secondary">{{ $t('config.cardsStockLabel') }}</span> <strong>{{ stockCards.length ? stockCards.map(cardName).join(', ') : $t('config.cardsStockBuiltin') }}</strong></span>
              </div>
              <div class="form-text" data-testid="cfg-cards-stock-help">{{ $t('config.cardsStockHelp') }}</div>
            </div>
          </div>
        </BCol>
        <BCol md="8">
          <BFormGroup :label="$t('config.volumeId')" label-for="cfg-volume" :description="$t('config.volumeIdHelp')">
            <BFormSelect id="cfg-volume" v-model="cfg.network_volume_id" :options="volumeOptions" class="font-monospace" data-testid="cfg-volume" @change="onVolumePick" />
            <div v-if="!volumesHere.length" class="mt-2" data-testid="cfg-volume-none">
              <span class="text-body-secondary small me-2">{{ cfg.data_center_id ? $t('config.volumesNoneIn', { dc: cfg.data_center_id }) : $t('config.volumesNone') }}</span>
              <BButton size="sm" variant="outline-light" data-testid="cfg-volume-add" @click="ui.volumesOpen = true"><i class="fa-solid fa-plus me-1"></i>{{ $t('config.volumeAdd') }}</BButton>
            </div>
            <div v-if="cfg.network_volume_id" class="form-text" data-testid="cfg-volume-info">
              <span v-if="volume === undefined">{{ $t('config.volumeLooking') }}</span>
              <span v-else-if="volume === null" class="text-warning">{{ $t('config.volumeMissing') }}</span>
              <span v-else>{{ $t('config.volumeInfo', { name: volume.name, size: volume.size_gb, dc: volume.datacenter, cost: volume.cost_per_month }) }}<span v-if="volume.s3"> · {{ $t('config.volumeS3') }}</span></span>
            </div>
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.mountPath')" label-for="cfg-mount" :description="$t('config.mountPathHelp')">
            <BFormInput id="cfg-mount" v-model.trim="cfg.mount_path" class="font-monospace" data-testid="cfg-mount" />
          </BFormGroup>
        </BCol>
        <BCol md="8">
          <BFormGroup :label="$t('config.image')" label-for="cfg-image" :description="$t('config.imageHelp')">
            <div class="d-flex gap-2">
              <BFormInput id="cfg-image" v-model.trim="cfg.image" placeholder="registry/name:tag" class="font-monospace" data-testid="cfg-image" />
              <BButton variant="outline-light" size="sm" class="flex-shrink-0 text-nowrap" :title="$t('dockerfile.buttonTitle')" data-testid="cfg-image-dockerfile" @click="showDockerfile = true"><i class="fa-solid fa-file-code me-1"></i>{{ $t('dockerfile.button') }}</BButton>
            </div>
            <DockerfileModal v-model="showDockerfile" :image="cfg.image" />
          </BFormGroup>
          <BFormGroup :label="$t('config.registryAuth')" label-for="cfg-registry-auth" :description="$t('config.registryAuthHelp')">
            <BFormInput id="cfg-registry-auth" v-model.trim="cfg.registry_auth_id" class="font-monospace" data-testid="cfg-registry-auth" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.idle')" label-for="cfg-idle" :description="$t('config.idleHelp')">
            <BFormInput id="cfg-idle" v-model.number="cfg.idle_stop_minutes" type="number" min="0" data-testid="cfg-idle" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.defaultVae')" label-for="cfg-vae" :description="$t('config.modelsHelp')">
            <BFormInput id="cfg-vae" v-model="cfg.models.vae" placeholder="seedvr2_ema_vae_fp16.safetensors" data-testid="cfg-vae" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.defaultDiffusion')" label-for="cfg-diffusion" :description="$t('config.modelsHelp')">
            <BFormInput id="cfg-diffusion" v-model="cfg.models.diffusion_model" placeholder="seedvr2_3b_fp16.safetensors" data-testid="cfg-diffusion" />
          </BFormGroup>
        </BCol>
        <BCol md="4">
          <BFormGroup :label="$t('config.syncParallel')" label-for="cfg-sync-parallel" :description="$t('config.syncParallelHelp')">
            <BFormInput id="cfg-sync-parallel" v-model.number="cfg.sync_parallel" type="number" min="1" max="16" data-testid="cfg-sync-parallel" />
          </BFormGroup>
        </BCol>
      </BRow>
      <BFormCheckbox v-if="!forPod" v-model="cfg.apply_by_default" :value="true" :unchecked-value="false" switch class="mb-2" data-testid="cfg-apply-default">
        {{ $t('config.applyDefault') }} <span class="text-body-secondary">{{ $t('config.applyDefaultHint') }}</span>
      </BFormCheckbox>
      <BFormCheckbox v-if="!forPod" v-model="cfg.pull_any_card" :value="true" :unchecked-value="false" switch class="mb-2" data-testid="cfg-pull-any-card">
        {{ $t('config.pullAnyCard') }} <span class="text-body-secondary">{{ $t('config.pullAnyCardHint') }}</span>
      </BFormCheckbox>
      <div v-if="!forPod" class="mb-2" data-testid="cfg-import-row">
        <BFormCheckbox v-model="cfg.import_cap_enabled" :value="true" :unchecked-value="false" switch class="mb-1" data-testid="cfg-import-cap-enabled">
          {{ $t('config.importCap') }} <span class="text-body-secondary">{{ $t('config.importCapHint') }}</span>
        </BFormCheckbox>
        <div v-if="cfg.import_cap_enabled" class="d-flex align-items-center gap-2 small ms-4">
          <label class="mb-0" for="cfg-import-pods">{{ $t('importRound.maxPods') }}</label>
          <BFormInput id="cfg-import-pods" v-model.number="cfg.import_max_pods" type="number" min="1" max="20" size="sm" style="width: 5rem" data-testid="cfg-import-max-pods" />
          <label class="mb-0 ms-2" for="cfg-import-cap">{{ $t('importRound.costCap') }}</label>
          <BFormInput id="cfg-import-cap" v-model.number="cfg.import_cost_cap_usd" type="number" min="1" size="sm" style="width: 6rem" data-testid="cfg-import-cost-cap" />
        </div>
      </div>
      <BFormCheckbox v-if="!forPod" v-model="cfg.dry_run" switch class="mb-1" :disabled="dryForced" data-testid="cfg-dry-run">
        {{ $t('config.dryRun') }} <span class="text-body-secondary">{{ $t('config.dryRunHint') }}</span>
      </BFormCheckbox>
      <div v-if="!forPod && dryForced" class="small text-warning mb-3" data-testid="cfg-dry-forced"><i class="fa-solid fa-lock me-1"></i>{{ $t('config.dryForced') }}</div>
      <div v-else-if="!forPod" class="mb-2"></div>
      </fieldset>

      <fieldset v-show="show('folders')" class="cfg-section" data-section="folders">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <legend class="mb-0" data-testid="section-folders">{{ $t('config.folders') }}</legend>
        <BButton size="sm" variant="outline-light" class="flex-shrink-0 text-nowrap ms-3" data-testid="add-folder" @click="cfg.custom.push({ name: '', local: '', container: '', link: '', mode: 'rw' })"><i class="fa-solid fa-plus me-1"></i>{{ $t('config.addFolder') }}</BButton>
      </div>
      <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('config.foldersHint', { mode, rule: $t(requireSource === 'prod' ? 'config.ruleProd' : requireSource === 'env' ? 'config.ruleEnv' : 'config.ruleConfig') }) }}<code class="d-none" data-testid="config-mode">{{ mode }}</code></BAlert>
      <table class="table table-sm align-middle mb-0">
        <thead class="small text-body-secondary">
          <tr><th style="width: 22%">{{ $t('config.colWhat') }}</th><th style="width: 48%">{{ $t('config.colLocal') }}</th><th>{{ $t('config.colPod') }}</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="f in required" :key="f.key" :data-testid="'folder-row-' + f.key">
            <td>
              <div class="fw-semibold">{{ label(f) }}</div>
              <BFormCheckbox v-model="cfg.required[f.key]" switch size="sm" :disabled="requireSource !== 'config'" data-testid="folder-required" :title="$t(requireSource === 'prod' ? 'config.requiredProd' : requireSource === 'env' ? 'config.requiredEnv' : 'config.requiredConfig')">
                <small data-testid="folder-required-text">{{ $t((requireSource === 'config' ? cfg.required[f.key] : f.required) ? 'config.required' : 'config.optional') }}</small>
              </BFormCheckbox>
              <small class="text-body-secondary">{{ f.what }}</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="cfg.folders[f.key]" size="sm" class="font-monospace" :placeholder="$t('config.notMapped')" :state="folderState(f, cfg.folders[f.key])" data-testid="folder-local" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" data-testid="folder-browse" @click="browse(f.key, label(f), cfg.folders[f.key])"><i class="fa-regular fa-folder-open me-1"></i>{{ $t('config.browse') }}</BButton>
              </div>
              <small v-if="cfg.folders[f.key] && f.local === cfg.folders[f.key] && !f.exists" class="text-danger">{{ $t('config.missing') }}</small>
              <small v-else-if="f.mirror && f.key !== 'plates' && f.local === cfg.folders[f.key]" class="text-warning">{{ $t('config.mirror', { hint: $t(f.key === 'comfy-shared' ? 'config.mirrorShared' : 'config.mirrorTree') }) }}</small>
              <small v-else-if="f.declared" class="text-body-secondary" data-testid="folder-note">{{ $t('config.linkedFrom', { source: f.declared.source }) }}</small>
              <small v-else-if="f.key === 'project' && cfg.folders.project && f.local === cfg.folders.project && f.exists" class="text-warning">{{ $t('config.noRoot') }}</small>
              <small v-else-if="f.key !== 'project' && cfg.folders.project" class="text-body-secondary">{{ $t('config.noDeclared') }}</small>
              <div class="mt-2" data-testid="folder-exclude-block" :data-folder="f.key">
                <label class="small text-body-secondary mb-0" :for="`cfg-folder-ex-${f.key}`">{{ $t('sync.folderExcludeLabel') }}</label>
                <textarea :id="`cfg-folder-ex-${f.key}`" :value="folderEx[f.key]?.text ?? ''" class="form-control form-control-sm font-monospace" rows="2" :placeholder="forPod && (folderEx[f.key]?.inherit ?? true) ? (defaultFolderEx[f.key] || []).join('\n') : 'CANALV2/'" data-testid="config-folder-exclude" :data-folder="f.key" @input="onFolderEx(f.key, $event.target.value)"></textarea>
                <div v-if="forPod && (folderEx[f.key]?.inherit ?? true)" class="form-text" data-testid="config-folder-exclude-inherit" :data-folder="f.key">{{ $t('sync.folderExcludeInherit') }}</div>
                <BButton v-if="forPod && folderEx[f.key] && !folderEx[f.key].inherit" variant="link" size="sm" class="p-0" data-testid="config-folder-exclude-use-default" :data-folder="f.key" @click="folderEx[f.key] = { text: '', inherit: true }">{{ $t('sync.folderExcludeUseDefault') }}</BButton>
                <div v-if="folderExError[f.key]" class="text-danger small" data-testid="config-folder-exclude-error" :data-folder="f.key">{{ folderExError[f.key] }}</div>
              </div>
            </td>
            <td class="font-monospace small" data-testid="folder-container">{{ f.container }}<br /><span class="text-body-secondary" data-testid="folder-env">{{ f.env_key }}</span></td>
            <td></td>
          </tr>
          <tr v-for="(c, i) in cfg.custom" :key="'custom-' + i" :data-testid="'custom-row-' + i">
            <td>
              <BFormInput v-model.trim="c.name" size="sm" :placeholder="$t('config.customName')" data-testid="custom-name" :state="c.name ? (/^[^/\s]+$/.test(c.name) && !required.some((f) => f.key === c.name) ? null : false) : false" />
              <small class="text-body-secondary">{{ $t('config.customOwn') }}</small>
            </td>
            <td>
              <div class="d-flex gap-2">
                <BFormInput v-model.trim="c.local" size="sm" class="font-monospace" :placeholder="$t('config.notMapped')" :state="folderState(customRow(c), c.local)" data-testid="custom-local" />
                <BButton size="sm" variant="outline-light" class="text-nowrap" @click="browse('custom:' + i, c.name || 'folder', c.local, 'custom.' + (c.name || i))"><i class="fa-regular fa-folder-open me-1"></i>Browse</BButton>
              </div>
              <div class="d-flex gap-2 align-items-center mt-1">
                <small class="text-body-secondary text-nowrap">{{ $t('config.customLink') }}</small>
                <BFormInput v-model.trim="c.link" size="sm" class="font-monospace" :placeholder="$t('config.customLinkHelp')" data-testid="custom-link" />
              </div>
            </td>
            <td>
              <BFormInput v-model.trim="c.container" size="sm" class="font-monospace" :placeholder="(cfg.mount_path || '/workspace') + '/' + (c.name || 'name')" data-testid="custom-container" />
              <BFormSelect v-model="c.mode" size="sm" :options="['rw', 'ro']" class="mt-1" style="width: 5rem" />
            </td>
            <td class="text-end"><BButton variant="outline-light" size="sm" :aria-label="$t('config.removeFolder')" data-testid="custom-remove" @click="cfg.custom.splice(i, 1)"><i class="fa-solid fa-xmark"></i></BButton></td>
          </tr>
        </tbody>
      </table>
      <div class="form-text mt-2" data-testid="config-folder-exclude-help">{{ $t('sync.folderExcludeHelp') }}</div>
      <div class="mt-3" data-testid="cfg-sync-shared">
        <div class="fw-semibold small mb-1">{{ $t('config.syncShared') }}</div>
        <div class="form-text mt-0 mb-2">{{ forPod ? $t('config.syncSharedPodHint') : $t('config.syncSharedHint') }}</div>
        <div v-for="row in SHARED_ROWS" :key="row.field" class="d-flex flex-wrap align-items-center gap-3 py-1 cfg-shared-row" :data-testid="`cfg-${row.field}-row`">
          <span class="fw-semibold small" style="min-width:3.5rem">{{ $t(`config.${row.label}`) }}</span>
          <div v-for="d in SHARED_DIRS" :key="d" class="form-check mb-0">
            <input :id="`cfg-${row.id}-${d}`" type="checkbox" class="form-check-input" :checked="(cfg[row.field] || []).includes(d)" :data-testid="`cfg-${row.id}-${d}`" @change="toggleShared(row.field, d, $event.target.checked)" />
            <label class="form-check-label" :for="`cfg-${row.id}-${d}`">{{ $t(`config.syncShared_${d}`) }} <span class="text-body-secondary small font-monospace">{{ d }}/</span></label>
          </div>
        </div>
      </div>
      <div class="border rounded p-2 mb-3" data-testid="config-autosync">
        <BFormCheckbox v-model="cfg.auto_sync.enabled" :value="true" :unchecked-value="false" data-testid="config-autosync-enabled">{{ $t('autosync.configLabel') }}</BFormCheckbox>
        <div v-if="cfg.auto_sync.enabled" class="ps-4 small" data-testid="config-autosync-options">
          <BFormCheckbox v-model="cfg.auto_sync.pull" :value="true" :unchecked-value="false" data-testid="config-autosync-pull">{{ $t('autosync.pull') }}</BFormCheckbox>
          <BFormCheckbox v-model="cfg.auto_sync.push" :value="true" :unchecked-value="false" data-testid="config-autosync-push">{{ $t('autosync.push') }}</BFormCheckbox>
          <div class="d-flex align-items-center gap-2 mt-1">
            <label class="mb-0" for="cfg-autosync-by">{{ $t('autosync.approvedBy') }}</label>
            <BFormInput id="cfg-autosync-by" v-model="cfg.auto_sync.approved_by" size="sm" style="width: 16rem" :placeholder="$t('autosync.approvedByPlaceholder')" data-testid="config-autosync-approved-by" />
          </div>
        </div>
        <div class="form-text mt-1" data-testid="config-autosync-help">{{ $t('autosync.configHelp') }}</div>
        <div v-if="autoSyncError" class="text-danger small mt-1" data-testid="config-autosync-error">{{ autoSyncError }}</div>
      </div>
      <div class="border rounded p-2 mb-3" data-testid="config-sync-exclude-block">
        <label class="fw-semibold mb-1" for="cfg-sync-exclude">{{ $t('sync.excludeConfigLabel') }}</label>
        <textarea id="cfg-sync-exclude" v-model="syncExcludeText" class="form-control form-control-sm font-monospace" rows="3" placeholder="CANALV2/" data-testid="config-sync-exclude"></textarea>
        <div class="form-text" data-testid="config-sync-exclude-help">{{ $t('sync.excludeConfigHelp') }}</div>
        <BFormCheckbox v-model="syncExcludeDelete" :value="true" :unchecked-value="false" class="small mt-1" data-testid="config-sync-exclude-delete">{{ $t('sync.excludeDeleteConfigLabel') }}</BFormCheckbox>
        <div v-if="syncExcludeError" class="text-danger small mt-1" data-testid="config-sync-exclude-error">{{ syncExcludeError }}</div>
      </div>
      </fieldset>

      <fieldset v-show="show('environment')" class="cfg-section" data-section="environment">
      <div class="d-flex align-items-center justify-content-between mb-2">
        <legend class="mb-0">{{ $t('config.environment') }}</legend>
        <BButton size="sm" variant="outline-light" @click="envRows.push({ key: '', value: '' })"><i class="fa-solid fa-plus me-1"></i>Add variable</BButton>
      </div>
      <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>Extra variables for every pod that applies these mounts.</BAlert>
      <table class="table table-sm align-middle mb-3" v-if="envRows.length">
        <tbody>
          <tr v-for="(row, i) in envRows" :key="i">
            <td style="width: 35%"><BFormInput v-model.trim="row.key" size="sm" class="font-monospace" placeholder="NAME" data-testid="cfg-env-key" /></td>
            <td>
              <div class="d-flex align-items-center gap-2">
                <BFormInput v-model="row.value" size="sm" class="font-monospace" placeholder="value" data-testid="cfg-env-value" />
                <BBadge v-if="row.arg" variant="secondary" class="fw-normal" :title="$t('config.envArgHint')" data-testid="cfg-env-arg">ARG</BBadge>
              </div>
            </td>
            <td class="text-end"><BButton variant="outline-light" size="sm" aria-label="Remove variable" @click="envRows.splice(i, 1)"><i class="fa-solid fa-xmark"></i></BButton></td>
          </tr>
        </tbody>
      </table>
      <div class="d-flex flex-wrap align-items-center gap-2" data-testid="cfg-env-load">
        <BDropdown size="sm" variant="outline-light" :disabled="envLoad.loading" data-testid="cfg-env-load-menu">
          <template #button-content>
            <BSpinner v-if="envLoad.loading" small class="me-1" /><i v-else class="fa-solid fa-download me-1"></i>{{ $t('config.envLoad') }}
          </template>
          <BDropdownItem data-testid="cfg-env-load-image" @click="loadEnv('image')">{{ $t('config.envFromImage') }}<small class="d-block text-body-secondary">{{ cfg.image || $t('config.envStockImage') }}</small></BDropdownItem>
          <BDropdownItem data-testid="cfg-env-load-dockerfile" @click="loadEnv('dockerfile')">{{ $t('config.envFromDockerfile') }}<small class="d-block text-body-secondary">apps/comfy-app/Dockerfile</small></BDropdownItem>
        </BDropdown>
        <BFormCheckbox v-model="envLoad.replace" switch data-testid="cfg-env-replace">{{ $t('config.envReplace') }}</BFormCheckbox>
        <span v-if="envLoad.summary" class="small text-body-secondary ms-auto" data-testid="cfg-env-summary">{{ envLoad.summary }}</span>
      </div>
      <BAlert v-if="envLoad.error" :model-value="true" variant="danger" class="small py-1 mt-2" data-testid="cfg-env-error" @update:model-value="envLoad.error = ''">{{ envLoad.error }}</BAlert>
      </fieldset>

      <fieldset v-if="!forPod && !gated" v-show="show('publishing')" class="cfg-section" data-section="publishing">
        <legend data-testid="section-publishing">{{ $t('publish.tab') }}</legend>
        <CollapsibleSection v-if="apStore.status?.watching" id="watching" :title="$t('autopublish.watch.title')" testid="autopublish-watching-block"><AutoPublishWatching :status="apStore.status" :skipped="true" compact /></CollapsibleSection>
        <PublishSettings ref="pubRef" part="rest" :render="cfg.render" />
        <div :id="`${slotId}-pub`"></div>   <!-- Outputs window, Prepare For Delivery and Render sequences land here (below) -->
        <EdlStatus v-if="!forPod" />
        <AutoPublishSettings v-if="cfg.auto_publish" v-model="cfg.auto_publish" :validate="apValidate" @changed="onApChanged" />
      </fieldset>
      <fieldset v-if="!forPod && !gated" v-show="show('storage')" class="cfg-section" data-section="storage">
        <legend data-testid="section-storage">{{ $t('storage.tab') }}</legend>
        <StorageAdapters ref="storageRef">
          <template #publish>
            <label class="small d-flex align-items-center gap-2 mb-2"><input v-model="sameBucket" type="checkbox" class="form-check-input mt-0" data-testid="storage-same-bucket" />{{ $t('storage.sameBucket') }}</label>
            <PublishSettings ref="pubS3Ref" part="s3" :follow="sameBucket ? { bucket: panamaCfg.bucket, region: panamaCfg.region } : null" />
          </template>
          <template #panama><BRow class="g-2">
        <BCol v-if="!gated" md="12"><div class="small fw-semibold" data-testid="cfg-panama-title">{{ $t('config.panamaTitle') }}</div><div class="form-text mt-0">{{ $t('config.panamaHelp') }}</div></BCol>
        <BCol v-if="!gated" md="6">
          <BFormGroup :label="$t('config.panamaAccess')" label-for="cfg-panama-access" data-testid="cfg-panama-group" :description="keyInfo.panama_aws_keys_set ? $t('config.panamaStored', { hint: keyInfo.panama_aws_access_key_hint }) : $t('config.panamaUnset')">
            <BFormInput id="cfg-panama-access" v-model.trim="newPanama.access" autocomplete="off" placeholder="AKIA…" class="font-monospace" data-testid="cfg-panama-access" />
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="6">
          <BFormGroup :label="$t('config.panamaSecret')" label-for="cfg-panama-secret">
            <BFormInput id="cfg-panama-secret" v-model.trim="newPanama.secret" type="password" autocomplete="off" class="font-monospace" data-testid="cfg-panama-secret" />
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="5">
          <BFormGroup :label="$t('config.panamaBucket')" label-for="cfg-panama-bucket" :description="$t('config.panamaBucketHelp')">
            <div class="d-flex gap-1"><BFormInput id="cfg-panama-bucket" v-model.trim="panamaCfg.bucket" autocomplete="off" class="font-monospace" data-testid="cfg-panama-bucket" />
              <BButton size="sm" variant="outline-light" class="text-nowrap" :disabled="panamaCfg.bucket === panamaDefaults.bucket" :title="$t('config.panamaReset')" data-testid="cfg-panama-bucket-reset" @click="panamaCfg.bucket = panamaDefaults.bucket"><i class="fa-solid fa-rotate-left"></i></BButton></div>
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="3">
          <BFormGroup :label="$t('config.panamaRegion')" label-for="cfg-panama-region">
            <div class="d-flex gap-1"><BFormInput id="cfg-panama-region" v-model.trim="panamaCfg.region" autocomplete="off" class="font-monospace" data-testid="cfg-panama-region" />
              <BButton size="sm" variant="outline-light" :disabled="panamaCfg.region === panamaDefaults.region" :title="$t('config.panamaReset')" data-testid="cfg-panama-region-reset" @click="panamaCfg.region = panamaDefaults.region"><i class="fa-solid fa-rotate-left"></i></BButton></div>
          </BFormGroup>
        </BCol>
          </BRow></template>
          <template #panama-pull><BRow class="g-2">
        <BCol v-if="!gated" md="4">
          <BFormGroup :label="$t('config.panamaProfile')" label-for="cfg-panama-profile" :description="$t('config.panamaProfileHelp')">
            <div class="d-flex gap-1"><BFormInput id="cfg-panama-profile" v-model.trim="panamaCfg.profile" autocomplete="off" class="font-monospace" data-testid="cfg-panama-profile" />
              <BButton size="sm" variant="outline-light" :disabled="panamaCfg.profile === panamaDefaults.profile" :title="$t('config.panamaReset')" data-testid="cfg-panama-profile-reset" @click="panamaCfg.profile = panamaDefaults.profile"><i class="fa-solid fa-rotate-left"></i></BButton></div>
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="12">
          <BFormGroup :label="$t('config.panamaPull')" label-for="cfg-panama-pull" :description="$t('config.panamaPullHelp')">
            <BFormInput id="cfg-panama-pull" v-model.trim="pullSetting" autocomplete="off" placeholder="bh-panama-exchange-610140802195/rounds/<round>=/workspace/comfy-shared/input/<round>" class="font-monospace" data-testid="cfg-panama-pull" />
          </BFormGroup>
        </BCol>
          </BRow></template>
        </StorageAdapters>
      </fieldset>
      <fieldset v-if="!forPod && !gated" v-show="show('adapters')" class="cfg-section" data-section="adapters">
        <legend data-testid="section-adapters">{{ $t('adapters.section') }}</legend>
        <AdapterManager />
      </fieldset>
      <fieldset v-if="forPod" v-show="show('options')" class="cfg-section" data-section="options">
        <legend>{{ $t('publish.tab') }}</legend>

      <div v-if="forPod" :id="`${slotId}-opt`"></div>   <!-- per-pod configuration: the render choices stay here (a pod has no Publishing tab) -->
      </fieldset>
      <ChooseCardModal :show="!!cardModal" :title="cardModal === 'stock' ? $t('config.cardsStockModal') : $t('config.cardsDefaultModal')" :help="cardModal === 'stock' ? $t('config.cardsStockModalHelp') : $t('config.cardsDefaultModalHelp')" :list="dcList" :loading="dcLoading" :datacenter="cfg.data_center_id || ''" :cards="cardModal === 'stock' ? stockCards : chosenCards" :card-label="(cardModal === 'stock' ? stockCards : chosenCards).map(cardName).join(', ')" :volume-dcs="volumeDcs" :default-dc="cfg.data_center_id || ''" @close="cardModal = ''" @refresh="loadDatacenters(true)" @update:datacenter="onCardDc" @pick="onPickCard" @auto="onCardAuto" />
      <Teleport defer :to="`#${slotId}-${forPod ? 'opt' : 'pub'}`">
      <div v-if="!forPod && cfg.outputs" class="border rounded p-2 mb-3" data-testid="config-outputs">
        <div class="fw-semibold mb-1">{{ $t('config.outputsTitle') }}</div>
        <label class="small"><input v-model="cfg.outputs.hide_empty_folders" type="checkbox" class="form-check-input me-1" data-testid="config-outputs-hide-empty" />{{ $t('config.outputsHideEmpty') }}</label>
        <div class="form-text" data-testid="config-outputs-help">{{ $t('config.outputsHelp') }}</div>
      </div>
      <div v-if="!forPod && cfg.delivery_prepare" class="border rounded p-2 mb-3" data-testid="config-delivery">
        <div class="fw-semibold mb-1">{{ $t('config.delivery.title') }}</div>
        <div class="form-text mb-2" data-testid="config-delivery-help">{{ $t('config.delivery.help') }}</div>
        <div class="row g-2 small">
          <label class="col-sm-6">{{ $t('config.delivery.outDir') }}<input v-model="cfg.delivery_prepare.out_dir" type="text" class="form-control form-control-sm font-monospace" autocomplete="off" data-testid="config-delivery-out-dir" /></label>
          <label class="col-sm-3">{{ $t('config.delivery.colourCode') }}<select v-model="cfg.delivery_prepare.colour_code" class="form-select form-select-sm" data-testid="config-delivery-colour-code"><option v-for="c in COLOUR_CODES" :key="c" :value="c">{{ $t(`config.delivery.colour_${c}`) }}</option></select></label>
          <label class="col-sm-3">{{ $t('config.delivery.gamma') }}<input v-model.number="cfg.delivery_prepare.gamma" type="number" min="0.1" max="10" step="0.1" class="form-control form-control-sm" data-testid="config-delivery-gamma" /></label>
          <label class="col-sm-3">{{ $t('config.delivery.fpsSource') }}<select v-model="cfg.delivery_prepare.fps_source" class="form-select form-select-sm" data-testid="config-delivery-fps-source"><option v-for="c in FPS_SOURCES" :key="c" :value="c">{{ $t(`config.delivery.fps_${c}`) }}</option></select></label>
          <label class="col-sm-3">{{ $t('config.delivery.fps') }}<input v-model.number="cfg.delivery_prepare.fps" type="number" min="1" max="120" step="0.001" class="form-control form-control-sm" data-testid="config-delivery-fps" /></label>
          <label class="col-sm-3">{{ $t('config.delivery.tcSource') }}<select v-model="cfg.delivery_prepare.timecode_source" class="form-select form-select-sm" data-testid="config-delivery-tc-source"><option v-for="c in TC_SOURCES" :key="c" :value="c">{{ $t(`config.delivery.tc_${c}`) }}</option></select></label>
          <label class="col-sm-3">{{ $t('config.delivery.framePosition') }}<select v-model="cfg.delivery_prepare.frame_position" class="form-select form-select-sm" data-testid="config-delivery-frame-position"><option v-for="c in FRAME_POSITIONS" :key="c" :value="c">{{ $t(`config.delivery.pos_${c}`) }}</option></select></label>
        </div>
        <label class="small mt-2"><input v-model="cfg.delivery_prepare.skip_existing" type="checkbox" class="form-check-input me-1" data-testid="config-delivery-skip-existing" />{{ $t('config.delivery.skipExisting') }}</label>
      </div>
      <div class="border rounded p-2 mb-3" data-testid="config-render">
        <div class="fw-semibold mb-1">{{ $t('outputs.render.cfg.title') }}</div>
        <div class="d-flex gap-3 flex-wrap align-items-end small mb-2">
          <label class="mb-0">{{ $t('outputs.render.cfg.where') }}
            <select v-model="cfg.render.where" class="form-select form-select-sm" data-testid="config-render-where"><option value="auto">{{ $t('outputs.render.cfg.whereAuto') }}</option><option value="pod">{{ $t('outputs.render.cfg.wherePod') }}</option><option value="local">{{ $t('outputs.render.cfg.whereLocal') }}</option></select>
          </label>
          <div role="radiogroup" data-testid="config-render-kind"><div>{{ $t('outputs.render.cfg.kind') }}</div>
            <label class="me-3"><input v-model="cfg.render.kind" type="radio" value="proxy" class="form-check-input me-1" data-testid="config-render-kind-proxy" />{{ $t('outputs.render.cfg.kindProxy') }}</label>
            <label><input v-model="cfg.render.kind" type="radio" value="review" class="form-check-input me-1" data-testid="config-render-kind-review" />{{ $t('outputs.render.cfg.kindReview') }}</label>
          </div>
          <label class="mb-0" :title="$t('outputs.render.cfg.colourHelp')">{{ $t('outputs.render.cfg.colour') }}
            <select v-model="renderColour" class="form-select form-select-sm" data-testid="config-render-colour"><option value="">{{ $t('outputs.render.cfg.colourDefault') }}</option><option v-for="c in RENDER_COLOURS" :key="c" :value="c">{{ $t(`edl.colours.${c}`) }}</option></select>
          </label>
          <label class="mb-0">{{ $t('outputs.render.cfg.proxyWidth') }}
            <select v-model="cfg.render.proxy_width" class="form-select form-select-sm" data-testid="config-render-proxy-width"><option v-for="w in WIDTH_CHOICES" :key="w" :value="w">{{ w === 'source' ? $t('outputs.render.cfg.source') : `${w} px` }}</option></select>
          </label>
          <label class="mb-0">{{ $t('outputs.render.cfg.reviewWidth') }}
            <select v-model="cfg.render.review_width" class="form-select form-select-sm" data-testid="config-render-review-width"><option v-for="w in WIDTH_CHOICES" :key="w" :value="w">{{ w === 'source' ? $t('outputs.render.cfg.source') : `${w} px` }}</option></select>
          </label>
          <label class="mb-0">{{ $t('outputs.render.cfg.fps') }}
            <select v-model="cfg.render.fps" class="form-select form-select-sm" data-testid="config-render-fps"><option v-for="f in FPS_CHOICES" :key="f" :value="f">{{ f === 'auto' ? $t('outputs.render.cfg.fpsAuto') : `${f} fps` }}</option></select>
          </label>
        </div>
        <div class="d-flex gap-3 flex-wrap small mb-1" data-testid="config-render-codecs">
          <label><input v-model="cfg.render.codecs" type="checkbox" value="h264" class="form-check-input me-1" data-testid="config-render-codec-h264" />{{ $t('outputs.render.cfg.codecH264') }}</label>
          <label><input v-model="cfg.render.codecs" type="checkbox" value="prores422hq" class="form-check-input me-1" data-testid="config-render-codec-prores" />{{ $t('outputs.render.cfg.codecProres') }}</label>
          <template v-if="forPod">   <!-- a pod's own configuration has no Publishing tab: the three "when done" boxes stay here; the default configuration has them in Publishing > defaults -->
            <label><input v-model="cfg.render.pull" type="checkbox" class="form-check-input me-1" data-testid="config-render-pull" />{{ $t('outputs.render.cfg.pull') }}</label>
            <label><input v-model="cfg.render.publish.s3" type="checkbox" class="form-check-input me-1" data-testid="config-render-publish-s3" @change="renderDeps" />{{ $t('outputs.render.cfg.publishS3') }}</label>
            <label><input v-model="cfg.render.publish.slack" type="checkbox" class="form-check-input me-1" :disabled="!cfg.render.publish.s3" data-testid="config-render-publish-slack" />{{ $t('outputs.render.cfg.publishSlack') }}</label>
          </template>
          <label><input v-model="cfg.render.skip_existing" type="checkbox" class="form-check-input me-1" data-testid="config-render-skip-existing" />{{ $t('outputs.render.cfg.skipExisting') }}</label>
          <label :title="$t('outputs.render.cfg.convertRec709Tip')"><input v-model="cfg.render.rec709" type="checkbox" class="form-check-input me-1" data-testid="config-render-rec709" />{{ $t('outputs.render.cfg.convertRec709') }}</label>
        </div>
        <div class="d-flex gap-3 flex-wrap align-items-end small mt-2" data-testid="config-render-preset-row">
          <label class="mb-0">{{ $t('outputs.render.preset') }}
            <select v-model="cfg.render.preset" class="form-select form-select-sm" data-testid="config-render-preset" @change="renderPresetChanged"><option value="none">{{ $t('outputs.render.presetStandard') }}</option><option value="tunnel">{{ $t('outputs.render.presetTunnel') }}</option></select>
          </label>
        </div>
        <div class="form-text" data-testid="config-render-help">{{ $t('outputs.render.cfg.help') }}</div>
        <div class="form-text" data-testid="config-render-pre-help">{{ $t('outputs.render.cfg.preHelp') }}</div>
        <div class="form-text" data-testid="config-render-skip-help">{{ $t('outputs.render.cfg.skipHelp') }}</div>
        <div v-if="renderError" class="text-danger small mt-1" data-testid="config-render-error">{{ renderError }}</div>
      </div>
      </Teleport>

      <BAlert :model-value="!!error" variant="danger" class="mt-2 mb-0" data-testid="config-error">{{ error }}</BAlert>
      </template>
    </template>

    <template #footer>
      <template v-if="forPod">
        <small class="text-body-secondary me-auto">{{ initial ? $t('config.podOwn') : $t('config.podFromDefault') }}</small>
        <BButton variant="outline-danger" size="sm" :disabled="saving || !initial" data-testid="config-use-defaults" @click="useDefaults">{{ $t('config.useDefaults') }}</BButton>
        <BButton variant="outline-light" size="sm" data-testid="config-close" @click="emit('update:modelValue', false)">{{ $t('config.close') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="saving" data-testid="config-apply" @click="apply"><BSpinner v-if="saving" small class="me-1" />{{ $t('config.apply') }}</BButton>
      </template>
      <template v-else>
        <small v-if="pubDirty" class="text-warning" data-testid="config-unsaved">{{ $t('publish.unsaved') }}</small>
        <small class="text-body-secondary me-auto">{{ stored ? $t('config.savedIn', { store }) : $t('config.nothingSaved') }}</small>
        <BButton v-if="!gated" variant="outline-danger" size="sm" :disabled="saving || !stored" data-testid="config-clear" @click="reset">{{ $t('config.clear') }}</BButton>
        <BButton v-if="!gated" variant="outline-light" size="sm" data-testid="config-close" @click="closeWindow">{{ $t('config.close') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="saving || (gated && !newKey)" data-testid="config-save" @click="save"><BSpinner v-if="saving" small class="me-1" />{{ gated ? $t('config.saveKey') : $t('config.save') }}</BButton>
      </template>
    </template>

    <FolderPicker v-model="picker.open" :title="picker.title" :start="picker.start" :memory-key="picker.memory" @choose="picked" />
  </BModal>
</template>

<script setup>
import { podsAPI } from '../api/pods'
import DatacenterTable from './DatacenterTable.vue'
import ChooseCardModal from './ChooseCardModal.vue'
import DockerfileModal from './DockerfileModal.vue'
import ConfigIoPanel from './ConfigIoPanel.vue'
import { volumesAPI } from '../api/volumes'
/**
 * ConfigModal — two uses of one panel.
 *
 * Default (no props): the gear icon in the navbar, the Default Configuration. Maps the three folders
 * on this PC (project tree, plates, ComfyUI-Shared) that the API keeps (GET/PUT/DELETE /api/mounts),
 * plus the pod volume, image and extra env. Everything a runtime receives is derived by the API from
 * the mapping and from what the project tree declares about itself; nothing about a machine is typed.
 *
 * For one pod (`mode="pod"`, v-model open, `initial`, `podName`): the same fields, started from the
 * pod's own configuration or from the default, never saved as the default. Apply emits the validated
 * configuration (the API previews it); Use defaults emits null. The pod form sends it with the
 * request; the card stores it for Recreate. The RunPod key, "apply by default" and no-spend mode
 * are app-wide and stay out of it.
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch, nextTick } from 'vue'
import { useUiStore } from '../stores/ui'
import { useStudioStore } from '../stores/studio'
import { usePodsStore } from '../stores/pods'
import { useMountsStore } from '../stores/mounts'
import { mountsAPI } from '../api/mounts'
import { imagesAPI } from '../api/images'
import { settingsAPI } from '../api/settings'
import { useSettingsStore } from '../stores/settings'
import { usePanamaStore } from '../stores/panama'
import { t } from '../i18n'
import FolderPicker from './FolderPicker.vue'
import AdapterManager from './AdapterManager.vue'
import StorageAdapters from './StorageAdapters.vue'
import PublishSettings from './PublishSettings.vue'
import AutoPublishSettings from './AutoPublishSettings.vue'
import AutoPublishWatching from './AutoPublishWatching.vue'
import CollapsibleSection from './CollapsibleSection.vue'
import { useAutopublishStore } from '../stores/autopublish'
import { usePublishStore } from '../stores/publish'
import EdlStatus from './EdlStatus.vue'
import { apFill, apIsDefault, settingsProblem as apProblem } from '../utils/autopublish'
import { useConfirmStore } from '../stores/confirm'
import { parsePatterns, listProblem } from '../utils/syncexclude'
import { useToastStore } from '../stores/toast'
import { changedSections, changedKeys, notLanded, clockNow } from '../utils/savefeedback'
import { RENDER_DEFAULTS, WIDTH_CHOICES, FPS_CHOICES, renderProblem, renderIsDefault, renderBody, renderPublishProblem } from '../utils/renders'
import { COLOUR_CODES, FPS_SOURCES, TC_SOURCES, FRAME_POSITIONS, deliveryFill, deliveryIsDefault, deliveryBody } from '../utils/deliveryprepare'

const props = defineProps({
  mode: { type: String, default: 'default' },      // 'default' | 'pod'
  modelValue: { type: Boolean, default: false },    // pod mode: open
  initial: { type: Object, default: null },         // pod mode: the pod's own configuration, or null for the default
  podName: { type: String, default: '' },
  podId: { type: String, default: '' },          // pod mode: the pod, so its name can be edited here
  runpodName: { type: String, default: '' },     // pod mode: RunPod's own name when ours differs
})
const emit = defineEmits(['update:modelValue', 'apply'])
const forPod = computed(() => props.mode === 'pod')
/** The pod's name is saved on its own, at once (it is a map on our side), not with Apply. */
const nameDraft = ref(props.podName)
const nameChanged = computed(() => nameDraft.value.trim() !== props.podName && !(nameDraft.value.trim() === '' && !props.runpodName))
const saveName = async () => { const n = nameDraft.value.trim(); await podsStore.rename(props.podId, n === props.runpodName ? '' : n) }
watch(() => props.podName, (n) => { nameDraft.value = n })

const toastStore = useToastStore()
const ui = useUiStore(), apStore = useAutopublishStore()
const studioStore = useStudioStore()
const podsStore = usePodsStore()
const overStudio = ref(false)
const mounts = useMountsStore()
const loading = ref(false)
const saving = ref(false)
const error = ref(null)
const cfg = ref(null)
const folders = ref([])
const dryForced = computed(() => !forPod.value && !!mounts.payload?.dry_run_forced)   // RUNPOD_DRY_RUN=1 in the app's environment: the switch is not the one in charge
/** The ComfyUI-Shared subfolders a sync can carry (the order they are shown in). */
const SHARED_DIRS = ['input', 'models', 'output', 'workflows']
const envRows = ref([])
const envLoad = reactive({ loading: false, replace: false, summary: '', error: '' })
/** Load defaults, as in the Create Pod form: the image's ENV and ARGs (or the repo Dockerfile's) become rows. A build ARG reaches the pod as an
 *  env var anyway (an explicit env var wins), so ARG rows are stored with the env and marked ARG. Existing keys keep their value unless Replace is on. */
async function loadEnv(source) {
  envLoad.loading = true; envLoad.summary = ''; envLoad.error = ''
  try {
    const { image, env, build_args: args = [], skipped = 0 } = await imagesAPI.env({ source, image: cfg.value?.image || 'prebuilt' })
    let added = 0, replaced = 0
    for (const [kind, rows] of [['env', env], ['arg', args]]) {
      for (const r of rows) {
        const have = envRows.value.find((x) => x.key === r.key)
        if (!have) { envRows.value.push({ key: r.key, value: r.value, ...(kind === 'arg' ? { arg: true } : {}) }); added++ }
        else if (envLoad.replace && have.value !== r.value) { have.value = r.value; replaced++ }
      }
    }
    envLoad.summary = t('config.envLoaded', { env: env.length, args: args.length, image, added, replaced }) + (skipped ? t('config.envSkipped', { n: skipped }) : '')
  } catch (e) { envLoad.error = e.response?.data?.detail || e.message || t('config.envLoadFailed') } finally { envLoad.loading = false }
}
const localEnv = ref({})
const preview = ref({})
const stored = ref(false)
const store = ref('')
const mode = ref('dev')
const require = ref([])
const requireSource = ref('config')
const picker = reactive({ open: false, key: '', title: '', start: '', memory: '' })
const keyInfo = ref({ runpod_api_key_set: false, runpod_api_key_hint: '', source: 'none', anthropic_key_set: false, anthropic_key_hint: '' })
const newClaude = ref('')
const newHf = ref('')
const claudeChecking = ref(false)
const claudeResult = ref(null)
/** The Anthropic key tests itself, no button: the stored one when the panel opens, a typed one a moment after the typing stops (it is tested
 *  without being saved; Save stores it). One cheap call; the answer is Anthropic's own. */
let claudeRun = 0, claudeTimer = null, claudeSaved = false   // claudeSaved: Save just stored the typed key, which was already checked
async function checkClaude() {
  const mine = ++claudeRun
  const typed = newClaude.value
  if (!typed && !keyInfo.value.anthropic_key_set) { claudeResult.value = null; claudeChecking.value = false; return }
  claudeChecking.value = true
  let r
  try { r = await settingsAPI.checkAnthropic(typed) } catch (e) { r = { ok: false, error: e.response?.data?.detail || e.message } }
  if (mine !== claudeRun) return   // the key changed while Anthropic was answering
  claudeResult.value = r; claudeChecking.value = false
}
watch(newClaude, (v) => {
  if (!v && claudeSaved) { claudeSaved = false; return }   // cleared by Save: no second check of a key that was just checked
  clearTimeout(claudeTimer)
  claudeRun++   // whatever was in flight is stale
  if (!v) { claudeChecking.value = false; claudeResult.value = null; claudeTimer = setTimeout(checkClaude, 0); return }   // cleared: the stored key again
  if (v.length < 20) { claudeChecking.value = false; claudeResult.value = null; return }   // not a key yet
  claudeChecking.value = true
  claudeTimer = setTimeout(checkClaude, 600)
})
const settingsStore = useSettingsStore()
const panamaStore = usePanamaStore()
/** No key stored (and not no-spend mode): only the key field shows, and the panel cannot be dismissed. */
// Tabs on a wide screen (desktop, landscape tablet: 992px and up); the sections flow down the page below that.
const wideQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 992px)') : null
const wide = ref(wideQuery ? wideQuery.matches : true)
const onWide = (e) => { wide.value = e.matches }
onMounted(() => wideQuery?.addEventListener('change', onWide))
onBeforeUnmount(() => wideQuery?.removeEventListener('change', onWide))
const tab = ref(props.mode === 'pod' ? 'volume' : 'runpod')
const tabList = computed(() => [
  ...(forPod.value ? [] : [{ key: 'runpod', label: t('config.runpod') }]),
  { key: 'volume', label: t('config.volumePod') },   // the same tab name in the default configuration and in a pod's
  { key: 'folders', label: t('config.folders') },
  { key: 'environment', label: t('config.environment') },
  ...(forPod.value ? [] : [{ key: 'storage', label: t('storage.tab') }, { key: 'adapters', label: t('adapters.section') }, { key: 'publishing', label: t('publish.tab') }]),
  ...(forPod.value ? [{ key: 'options', label: t('publish.tab') }] : []),   // a pod's own configuration: the render and when-done choices, so it is called Publishing like the default's tab
])
/** A section shows when the sections flow (narrow), when only the key is asked for (gated), or when its tab is the open one. */
const show = (key) => !wide.value || gated.value || tab.value === key

const gated = computed(() => !forPod.value && !keyInfo.value.runpod_api_key_set && !settingsStore.ready)
const newKey = ref('')
const showDockerfile = ref(false)
const newS3 = reactive({ access: '', secret: '' })
/** The bucket, region and profile, prefilled with what is in force (the built-in defaults unless overridden); a value equal to its default is not stored. */
const panamaDefaults = computed(() => keyInfo.value.panama_defaults || { bucket: 'bh-panama-exchange-610140802195', region: 'us-west-2', profile: 'panama' })
const panamaCfg = reactive({ bucket: '', region: '', profile: '' })
/** docs/ADR-065: the publish destination is the Panama bucket with the same keys (shown as one thing); off when it was set to something else */
const sameBucket = ref(true), sameSet = ref(false)
const pubStoreForSame = usePublishStore()
watch([() => pubStoreForSame.settings?.s3, () => panamaCfg.bucket, () => panamaCfg.region], ([s3]) => {   // once, when both are loaded: the same bucket and region read as one
  if (sameSet.value || !s3?.bucket || !panamaCfg.bucket) return   // the store starts with an empty destination: wait for the real one
  sameSet.value = true; sameBucket.value = s3.bucket === panamaCfg.bucket && s3.region === panamaCfg.region
}, { immediate: true })
watch(keyInfo, (k) => { panamaCfg.bucket = k.panama_bucket || panamaDefaults.value.bucket; panamaCfg.region = k.panama_region || panamaDefaults.value.region; panamaCfg.profile = k.panama_profile || panamaDefaults.value.profile }, { immediate: true })
const panamaCfgChanged = () => { const k = keyInfo.value; return panamaCfg.bucket !== (k.panama_bucket || panamaDefaults.value.bucket) || panamaCfg.region !== (k.panama_region || panamaDefaults.value.region) || panamaCfg.profile !== (k.panama_profile || panamaDefaults.value.profile) }
/** The agent rules: one setting for the whole app (a system setting like the Panama bucket), never part of a pod's configuration. */
const agentRules = reactive({ namedYes: false, cap: 0 })
watch(keyInfo, (k) => { agentRules.namedYes = !!k.agent_named_yes_required; agentRules.cap = Number(k.agent_spend_cap_usd) || 0 }, { immediate: true })
const agentRulesChanged = () => agentRules.namedYes !== !!keyInfo.value.agent_named_yes_required || (Number(agentRules.cap) || 0) !== (Number(keyInfo.value.agent_spend_cap_usd) || 0)
const newPanama = reactive({ access: '', secret: '' })   // the Panama bucket keys (BH): saved as app secrets, handed to a pod that has a pull set (docs/ADR-015)
/** S3_PULL is one row of the environment table; this field edits that row, adding or removing it. */
const pullSetting = computed({
  get: () => envRows.value.find((r) => r.key === 'S3_PULL')?.value || '',
  set: (v) => {
    const i = envRows.value.findIndex((r) => r.key === 'S3_PULL')
    if (!v) { if (i >= 0) envRows.value.splice(i, 1) } else if (i >= 0) envRows.value[i].value = v; else envRows.value.push({ key: 'S3_PULL', value: v })
  },
})

const label = (f) => (f.custom ? f.key : t(`config.folder.${f.key}`))
const required = computed(() => folders.value.filter((f) => !f.custom))
// The API's derived row for a custom folder (exists, declared), matched by name.
const customRow = (c) => folders.value.find((f) => f.custom && f.key === c.name) || { local: '', exists: false }

function take(payload) {
  cfg.value = JSON.parse(JSON.stringify(payload.config))   // a copy: unsaved edits must not leak into the store (the stats bar reads it)
  cfg.value.custom ||= []
  cfg.value.models = { vae: '', diffusion_model: '', ...(cfg.value.models || {}) }   // an older payload has none
  folders.value = payload.folders || []
  envRows.value = Object.entries(payload.config.env || {}).map(([key, value]) => ({ key, value }))
  localEnv.value = payload.local_env || {}
  preview.value = payload.preview || {}
  stored.value = payload.stored
  store.value = payload.store
  mode.value = payload.mode || 'dev'
  require.value = payload.require || []
  requireSource.value = payload.require_source || 'config'
  cfg.value.required ||= {}
  autoSyncStored = !!payload.config.auto_sync   // an untouched, unticked object is not added to what is saved
  cfg.value.auto_sync = { enabled: false, pull: true, push: false, approved_by: '', ...(cfg.value.auto_sync || {}) }
  if (!cfg.value.auto_sync.approved_by) try { cfg.value.auto_sync.approved_by = localStorage.getItem('runpod-manager.approved-by') || '' } catch { /* storage blocked */ }
  syncExcludeStored = Array.isArray(payload.config.sync_exclude)   // an untouched, empty list is not added to what is saved
  syncExcludeText.value = (payload.config.sync_exclude || []).join('\n'); syncExcludeError.value = ''
  { // folder_excludes: the Default editor shows its own lists; a pod shows its OWN (the props' raw configuration), inheriting the keys it lacks
    const own = forPod.value ? (props.initial?.folder_excludes || {}) : (payload.config.folder_excludes || {})
    folderExStored = forPod.value ? !!props.initial?.folder_excludes : !!payload.config.folder_excludes; folderExLoaded.clear()
    for (const k of Object.keys(folderEx)) delete folderEx[k]
    for (const f of payload.folders || []) if (!f.custom) folderEx[f.key] = Object.prototype.hasOwnProperty.call(own, f.key) ? { text: (own[f.key] || []).join('\n'), inherit: false } : { text: '', inherit: forPod.value }
    for (const k of Object.keys(own)) { folderExLoaded.add(k); if (!folderEx[k]) folderEx[k] = { text: (own[k] || []).join('\n'), inherit: false } }
    for (const k of Object.keys(folderExError)) delete folderExError[k]
  }
  { // auto_publish (app-wide: the Default Configuration only): the form's copy, its snapshot for the dirty flag, and whether the core has it at all
    const has = payload.config.auto_publish !== undefined
    if (has && !forPod.value) { cfg.value.auto_publish = apFill(payload.config.auto_publish); if (cfg.value.auto_publish.generate) cfg.value.auto_publish.approved_by = payload.config.auto_publish.standing?.approved_by || (() => { try { return localStorage.getItem('runpod-manager.approved-by') || '' } catch { return '' } })(); apSnapshot = JSON.stringify(cfg.value.auto_publish); apLoadedDefault = apIsDefault(payload.config.auto_publish) } else { delete cfg.value.auto_publish; apSnapshot = ''; apLoadedDefault = true }
    apValidate.value = false
  }
  syncExcludeDeleteStored = payload.config.sync_exclude_delete !== undefined; syncExcludeDelete.value = !!payload.config.sync_exclude_delete
  renderStored = !!payload.config.render   // an untouched render object is not added to what is saved
  renderLoadedKeys = Object.keys(payload.config.render || {})
  cfg.value.render = { ...RENDER_DEFAULTS, ...(cfg.value.render || {}), codecs: [...((cfg.value.render || {}).codecs || RENDER_DEFAULTS.codecs)], publish: { s3: !!(cfg.value.render?.publish ?? RENDER_DEFAULTS.publish).s3, slack: !!(cfg.value.render?.publish ?? RENDER_DEFAULTS.publish).slack } }
  // the Outputs window's starting value: the Default Configuration only (a pod's own configuration never has it)
  outputsStored = !forPod.value && payload.config.outputs !== undefined
  if (forPod.value) delete cfg.value.outputs; else cfg.value.outputs = { hide_empty_folders: payload.config.outputs?.hide_empty_folders !== false }
  // Prepare For Delivery's defaults (ADR-055 section 12): the Default Configuration only, exported and imported with it
  deliveryStored = !forPod.value && payload.config.delivery_prepare !== undefined
  if (forPod.value) delete cfg.value.delivery_prepare; else cfg.value.delivery_prepare = deliveryFill(payload.config.delivery_prepare)
  renderError.value = ''
  autoSyncError.value = ''
}
let renderStored = false, renderLoadedKeys = [], outputsStored = false, deliveryStored = false
/** The Tunnel proxy preset is a quick proxy: it takes the kind with it. */
// The colour of the frames when nobody states one: empty is the project default (Gamma 2.6 P3-D65 for a header that says linear; log and printing density are still asked); a colour here is used for every frame whose header says linear or log
const RENDER_COLOURS = ['p3-d65-gamma26', 'p3-d65-srgb', 'p3-d65-gamma22', 'linear-p3-d65', 'linear-rec709', 'kodak-log']
const renderColour = computed({
  get: () => (cfg.value.render.colour?.mode === 'format' && cfg.value.render.colour.format ? cfg.value.render.colour.format : ''),
  set: (v) => { cfg.value.render.colour = v ? { mode: 'format', format: v, set_by: 'Default Configuration', set_at: new Date().toISOString() } : { mode: 'known' } },
})
function renderPresetChanged() { if (cfg.value.render.preset === 'tunnel') cfg.value.render.kind = 'proxy' }
/** Publishing when done needs the renders on this PC (unless they render here), and Slack needs S3: switched off inline, before any call. */
function renderDeps() { const p = cfg.value.render.publish; if (!p.s3) p.slack = false }
let apSnapshot = '', apLoadedDefault = true
const apValidate = ref(false)
const apDirty = computed(() => !!cfg.value?.auto_publish && JSON.stringify(cfg.value.auto_publish) !== apSnapshot)
/** After an immediate act (enable, go live, off) the core changed the configuration's value: read it again so the next Save cannot write a stale one. */
async function onApChanged() { try { const p = await mountsAPI.get(); if (p?.config?.auto_publish && cfg.value) { cfg.value.auto_publish = apFill(p.config.auto_publish); apSnapshot = JSON.stringify(cfg.value.auto_publish); apLoadedDefault = apIsDefault(p.config.auto_publish) } } catch { /* the window keeps what it has */ } }
let syncExcludeStored = false, syncExcludeDeleteStored = false, folderExStored = false
// Exclude by default, per mapped folder (v1.5.0): `folder_excludes` { rowKey: [patterns] }. The Default editor loads and saves its own lists; a pod's editor starts every key inheriting the Default's (placeholder), typing replaces it for that key, Use the Default goes back.
const folderEx = reactive({}), folderExError = reactive({}), defaultFolderEx = ref({})
function onFolderEx(key, text) { folderEx[key] = { text, inherit: false }; delete folderExError[key] }
function folderExOk() {
  let ok = true
  for (const [key, v] of Object.entries(folderEx)) {
    const bad = v.inherit ? null : listProblem(parsePatterns(v.text))
    if (bad) { folderExError[key] = t('sync.folderExcludeError', { folder: key, pattern: bad.pattern, problem: t(`sync.${bad.problem}`) }); ok = false } else delete folderExError[key]
  }
  return ok
}
function folderExBody() {
  const out = {}
  for (const [key, v] of Object.entries(folderEx)) { if (v.inherit) continue; const list = parsePatterns(v.text); if (list.length || folderExLoaded.has(key) || forPod.value) out[key] = list }
  return out
}
const folderExLoaded = new Set()
const syncExcludeDelete = ref(false)
const syncExcludeText = ref(''), syncExcludeError = ref('')
/** Sync: leave out: one pattern per line, the core's rules checked here before any call. */
function syncExcludeOk() {
  const bad = listProblem(parsePatterns(syncExcludeText.value))
  syncExcludeError.value = bad ? t('sync.excludeConfigError', { pattern: bad.pattern, problem: t(`sync.${bad.problem}`) }) : ''
  return !bad
}
const renderError = ref('')
/** Render sequences: at least one codec, known choices; refused here before any call (the core refuses it too). */
function renderOk() {
  const p = renderProblem(cfg.value.render), q = renderPublishProblem(cfg.value.render)
  renderError.value = p ? t('outputs.render.cfg.needCodec') : q === 'slackNeedsS3' ? t('autopublish.block.slackNeedsS3') : ''
  return !p && !q
}
let autoSyncStored = false
const autoSyncError = ref('')
/** A named yes (ADR-046): ticking Auto sync needs the name of who says yes, refused here before any call; the core refuses it too. */
function autoSyncOk() {
  const a = cfg.value.auto_sync
  if (a.enabled && !String(a.approved_by || '').trim()) { autoSyncError.value = t('autosync.needName'); return false }
  autoSyncError.value = ''
  if (a.enabled) try { localStorage.setItem('runpod-manager.approved-by', a.approved_by.trim()) } catch { /* storage blocked */ }
  return true
}

/** The datacenter menu: RunPod's list with S3 support and our cards at the secure-cloud price; the saved id is kept even when the list lacks it. */
const dcList = ref([])
/** The account's volumes as a menu: those in the chosen datacenter, or all of them while no datacenter is chosen
 *  (picking one then sets the datacenter, since a volume never leaves it). A saved id the list lacks stays selectable. */
const allVolumes = ref([])
const volumesHere = computed(() => allVolumes.value.filter((v) => !cfg.value?.data_center_id || v.datacenter === cfg.value.data_center_id))
const volumeOptions = computed(() => {
  const dc = cfg.value?.data_center_id
  const opts = [{ value: '', text: t('config.volumeNone') }, ...volumesHere.value.map((v) => ({ value: v.id, text: `${v.name} · ${v.size_gb} GB · ${v.id}${dc ? '' : ` · ${v.datacenter}`}` }))]
  const saved = cfg.value?.network_volume_id
  if (saved && !allVolumes.value.some((v) => v.id === saved)) opts.push({ value: saved, text: t('config.volumeUnknown', { id: saved }) })
  return opts
})
function onVolumePick() {
  const v = allVolumes.value.find((x) => x.id === cfg.value?.network_volume_id)
  if (v && cfg.value.data_center_id !== v.datacenter) cfg.value.data_center_id = v.datacenter
  loadVolume()
}
async function loadVolumes() { try { allVolumes.value = (await volumesAPI.list()) || [] } catch { /* the id can still be typed */ } }
watch(() => ui.volumesOpen, (open) => { if (!open) loadVolumes() })   // back from the Volumes modal: a new volume shows in the menu

/** The configured volume as RunPod has it, with its monthly cost; undefined while asking, null when RunPod has none. */
const volume = ref(undefined)
async function loadVolume() {
  const id = (cfg.value?.network_volume_id || '').trim()
  if (!id) { volume.value = undefined; return }
  volume.value = undefined
  try { volume.value = await podsAPI.volume(id) } catch (e) { volume.value = e.response?.status === 404 ? null : undefined }
}

/** The card table for the default-card select: the menu's names, with auto as the cheapest card in stock. */
const gpuChoices = ref([{ value: 'rtxpro6000', text: 'RTX PRO 6000 (96 GB)' }, { value: 'auto', text: 'Cheapest card in stock (16-24 GB)' }])
/** The datacenter and the cards of a new pod, chosen in Choose Card (the Import Round window): the cards are ranked in the order they were clicked, all at the datacenter. One card is the default card; several make the default `auto` with that list as the cards `auto` tries; none is Cheapest in Stock with the built-in stock list. */
const cardModal = ref(''), dcLoading = ref(false)   // '' closed, 'default' the datacenter and the default card, 'stock' the cards Cheapest in Stock tries (system jobs)
const cardName = (c) => `${c.name}${c.vram ? ` ${c.vram} GB` : ''}`
const cardOf = (key) => { for (const d of dcList.value) { const c = (d.cards || []).find((x) => x.key === key); if (c) return { key, name: c.name, vram: c.vram || 0 } }; const g = gpuChoices.value.find((x) => x.value === key); const m = /^(.*?)\s*\((\d+)\s*GB\)\s*$/.exec(String(g?.text || key)); return { key, name: m ? m[1] : String(g?.text || key), vram: m ? Number(m[2]) : 0 } }
/** The default card (one card, or Cheapest in Stock = `auto`) and, apart, the cards `auto` tries: the system jobs (frame previews, pulls, renders) and a default of Cheapest in Stock pick from that list; none chosen is the built-in stock list. */
const chosenCards = computed(() => { const c = cfg.value; if (!c) return []; if (c.default_cards?.length) return c.default_cards.map(cardOf); return c.default_gpu && c.default_gpu !== 'auto' ? [cardOf(c.default_gpu)] : [] })
const stockCards = computed(() => (cfg.value?.auto_cards || []).map(cardOf))
/** The default cards are a ranked list at the datacenter: one card is `default_gpu`; two or more are `default_cards` (the first free one is used) with `default_gpu` the first of them; none is Cheapest in Stock. */
function writeDefaultCards(keys) {
  const c = cfg.value
  if (!keys.length) { c.default_gpu = 'auto'; c.default_cards = [] }
  else if (keys.length === 1) { c.default_gpu = keys[0]; c.default_cards = [] }
  else { c.default_gpu = keys[0]; c.default_cards = [...keys] }
}
/** The datacenter is ONE choice for both lists: moving it keeps only the cards that datacenter offers (when the list of datacenters says what it offers). */
function setCardDc(dc) {
  const c = cfg.value; if (!dc) { c.data_center_id = ''; return }
  c.data_center_id = dc
  const here = dcList.value.find((d) => d.value === dc)
  if (!here?.cards?.length) return
  const ok = new Set(here.cards.map((x) => x.key))
  writeDefaultCards(chosenCards.value.map((x) => x.key).filter((k) => ok.has(k)))
  c.auto_cards = (c.auto_cards || []).filter((k) => ok.has(k))
}
const onCardDc = (dc) => setCardDc(dc)
/** A click on a card at a datacenter, in either window: the same datacenter adds the card to the list or takes it off; another datacenter becomes THE datacenter, the other list keeps what it offers, and this list starts with that card. The window stays open until Done. */
function onPickCard({ dc, card }) {
  const c = cfg.value, stock = cardModal.value === 'stock'
  const was = c.data_center_id || ''
  if (dc && dc !== was) setCardDc(dc)
  if (!card) return
  const cur = (stock ? c.auto_cards || [] : chosenCards.value.map((x) => x.key))
  const moved = !!dc && !!was && dc !== was
  const next = moved ? [card.key] : cur.includes(card.key) ? cur.filter((k) => k !== card.key) : [...cur, card.key]
  if (stock) c.auto_cards = next; else writeDefaultCards(next)
}
/** Auto in the window: the default is Cheapest in Stock, or the stock list goes back to the built-in one. */
function onCardAuto() { if (cardModal.value === 'stock') cfg.value.auto_cards = []; else writeDefaultCards([]) }
async function loadGpuChoices() {
  try { const g = await podsAPI.gpus(); if (g.gpus?.length) gpuChoices.value = g.gpus.map((x) => ({ value: x.value, auto: x.auto !== false, text: String(x.text).split(' · ')[0] })) } catch { /* the short menu stays */ }
}
async function loadDatacenters(fresh = false) {
  dcLoading.value = true
  try { dcList.value = (await podsAPI.datacenters(fresh)).datacenters || [] } catch { /* the saved id stays selectable */ } finally { dcLoading.value = false }
}
const volumeDcs = computed(() => [...new Set(allVolumes.value.map((v) => v.datacenter).filter(Boolean))].sort())

async function load() {
  overStudio.value = studioStore.open   // opened from inside the Adapter Studio (the Claude key): it must sit above it
  loadDatacenters(); loadGpuChoices()
  loadVolumes()
  loading.value = true; error.value = null
  if (forPod.value) {
    // the pod's own configuration through the API's preview (its derived rows), else the default as saved
    try { take(props.initial ? await mountsAPI.preview(props.initial) : (await mounts.load()) || {}) }
    catch (e) { error.value = e.response?.data?.detail || e.message }
    if (!cfg.value) error.value ||= mounts.error
    try { defaultFolderEx.value = (await mountsAPI.get())?.config?.folder_excludes || {} } catch { defaultFolderEx.value = {} }   // the placeholders of the keys this pod inherits
    loading.value = false
    return
  }
  const payload = await mounts.load()
  if (payload) take(payload); else error.value = mounts.error
  try { keyInfo.value = await settingsAPI.get() } catch { /* a backend without settings: the key comes from the environment */ }
  checkClaude()   // the stored Anthropic key tests itself when the panel opens
  newKey.value = ''
  loadVolume()   // after the config is in, so the line names the configured volume
  loading.value = false
}

/** Pod mode: validate through the API's preview, hand the configuration to the owner, close. */
async function apply() {
  if (!autoSyncOk() || !renderOk() || !syncExcludeOk() || !folderExOk()) return
  saving.value = true; error.value = null
  try {
    const payload = await mountsAPI.preview(body())
    emit('apply', payload.config)
    emit('update:modelValue', false)
  } catch (e) { error.value = e.response?.data?.detail || e.message }
  saving.value = false
}

function useDefaults() {
  emit('apply', null)
  emit('update:modelValue', false)
}

function folderState(f, v) {
  if (!v) return null
  if (!v.startsWith('/')) return false
  return f.local === v ? f.exists : null   // the API checked this exact path; anything else is unknown until saved
}

function browse(key, name, start, memory = key) {
  picker.key = key; picker.title = t('picker.title', { name: name.toLowerCase() }); picker.start = start || ''
  picker.memory = memory   // what the picker remembers the last folder under: the row's key, or a custom row's name
  picker.open = true
}

function picked(path) {
  if (picker.key.startsWith('custom:')) cfg.value.custom[Number(picker.key.slice(7))].local = path
  else cfg.value.folders[picker.key] = path
}

/** The auto_publish object as saved: the approver's name travels only with rendering on a pod (it is the spend's named yes), and only when that is on. */
function apBody(apv) { const o = { ...apv }; if (!((o.generate?.enabled && (o.generate.where === 'pod' || o.generate.start_pod || o.generate.colour_in)) || o.require_review === false)) delete o.approved_by; return o }
function body() {
  const env = {}
  for (const r of envRows.value) if (r.key) env[r.key] = r.value
  const { auto_sync: a, render: r, auto_publish: apv, outputs: outv, delivery_prepare: dpv, sync_exclude: _se, sync_exclude_delete: _sd, folder_excludes: _fe, ...rest } = cfg.value
  const patterns = parsePatterns(syncExcludeText.value)
  const fe = folderExBody()
  return { ...rest, ...(a.enabled || autoSyncStored ? { auto_sync: { ...a, approved_by: String(a.approved_by || '').trim() } } : {}), ...(patterns.length || syncExcludeStored ? { sync_exclude: patterns } : {}), ...(Object.keys(fe).length || folderExStored ? { folder_excludes: fe } : {}), ...(apv && (apDirty.value || !apLoadedDefault) ? { auto_publish: apBody(apv) } : {}), ...(syncExcludeDelete.value || syncExcludeDeleteStored ? { sync_exclude_delete: !!syncExcludeDelete.value } : {}), ...(r && (renderStored || !renderIsDefault(r)) ? { render: renderBody(r, renderLoadedKeys) } : {}), ...(outv && (outputsStored || outv.hide_empty_folders === false) ? { outputs: { hide_empty_folders: !!outv.hide_empty_folders } } : {}), ...(dpv && (deliveryStored || !deliveryIsDefault(dpv)) ? { delivery_prepare: deliveryBody(dpv) } : {}), env }
}

const localText = computed(() => {
  const e = Object.entries(localEnv.value)
  return e.length ? e.map(([k, v]) => `export ${k}=${JSON.stringify(v)}`).join('\n') : t('config.nothingMapped')
})

const previewText = computed(() => {
  const p = preview.value
  const lines = []
  if (p.network_volume_id) lines.push(t('config.volumeLine', { id: p.network_volume_id, path: p.volume_mount_path }) + (p.data_center_id ? t('config.inDatacenter', { dc: p.data_center_id }) : ''))
  else lines.push(t('config.noVolume'))
  for (const [k, v] of Object.entries(p.env || {})) lines.push(`${k}=${v}`)
  return lines.join('\n')
})

// Already open underneath (the Adapter Studio opened over it, then asked for the key): go there, and sit above the Studio.
watch(() => ui.configFocus, (v) => { if (v && ui.configOpen) { overStudio.value = studioStore.open; focusSection() } })

/** Opened from Import Shot Pack with a place to go: "adapters" scrolls to Import adapters, "claude" to the Anthropic key field (and puts the cursor in it). */
const ioFlash = ref(false)
/** After an import wrote the configuration: show what is in force now, in place (not through load(), which would swap the panel for a spinner and lose its message). */
async function afterImport() {
  const payload = await mounts.load()
  if (payload) take(payload)
  try { keyInfo.value = await settingsAPI.get() } catch { /* unchanged */ }
  loadVolume(); loadDatacenters(); loadGpuChoices(); loadVolumes()
  settingsStore.load(); panamaStore.loadStatus()
}
async function focusSection() {
  const where = ui.configFocus
  ui.configFocus = ''
  if (where === 'import') {   // from the welcome question: the import form, in view and briefly outlined
    let el = null
    for (let i = 0; i < 30 && !el; i++) { await nextTick(); el = document.querySelector('[data-testid="cfg-io-panel"]'); if (!el) await new Promise((r) => setTimeout(r, 100)) }   // the body loads first
    el?.scrollIntoView({ block: 'center' })
    ioFlash.value = true; setTimeout(() => { ioFlash.value = false }, 2000)
  }
  if (where === 'publishing') { tab.value = 'publishing'; await nextTick(); document.querySelector('[data-testid="section-publishing"]')?.scrollIntoView({ block: 'start' }) }
  if (where === 'adapters') { tab.value = 'adapters'; await nextTick(); document.querySelector('[data-testid="section-adapters"]')?.scrollIntoView({ block: 'start' }) }
  if (where === 'panama') { tab.value = 'storage'; await nextTick(); await scrollToField('cfg-panama-access', 'storage') }
  if (where === 's3') await scrollToField('cfg-s3-access')    // from Browse / Erase / Clone: the RunPod S3 key fields, in view and focused
  if (where === 'claude') await scrollToField('cfg-claude-key')
}
/** Open on a field: wait for it (the body loads first), centre it and focus it, then centre it again once the lists
 *  that load beside it (volumes, datacenters, cards) have settled the layout; a single scroll right away ended up out of view. */
async function scrollToField(id, where = 'runpod') {
  tab.value = where
  let input = null
  for (let i = 0; i < 30 && !input; i++) { await nextTick(); input = document.getElementById(id); if (!input) await new Promise((r) => setTimeout(r, 100)) }
  if (!input) return
  input.scrollIntoView({ block: 'center' })
  input.focus({ preventScroll: true })
  for (const ms of [250, 700, 1500]) setTimeout(() => { if (document.activeElement === input) input.scrollIntoView({ block: 'center' }) }, ms)
}

const slotId = `cfg-slot-${Math.random().toString(36).slice(2, 8)}`   // where Teleport puts the Outputs / Delivery / Render blocks: Publishing, or Options for a pod's own configuration
const pubRef = ref(null), pubS3Ref = ref(null), storageRef = ref(null), confirm = useConfirmStore()
const pubDirty = computed(() => !!pubRef.value?.dirty || !!pubS3Ref.value?.dirty || apDirty.value)
let forceClose = false
/** Close, asking first when Publishing has edits nobody saved. */
async function closeWindow() {
  if (pubDirty.value && !(await confirm.ask(t('publish.discardConfirm'), { okLabel: t('config.close') }))) return
  forceClose = true; ui.configOpen = false
}
function onHide(ev) {   // the X, Escape or a click outside
  if (forPod.value || forceClose || !pubDirty.value) { forceClose = false; return }
  ev.preventDefault(); closeWindow()
}
async function save() {
  if (!gated.value && (!autoSyncOk() || !renderOk() || !syncExcludeOk() || !folderExOk())) return
  if (!gated.value && cfg.value?.auto_publish?.enabled && apProblem(cfg.value.auto_publish)) { apValidate.value = true; tab.value = 'publishing'; return }
  if (!gated.value && pubS3Ref.value?.validate()) { tab.value = 'storage'; return }   // the destination's form is the publish-s3 card in the Storage tab (docs/ADR-063)
  if (!gated.value && pubRef.value?.validate()) { tab.value = 'publishing'; return }   // both are checked before anything is written
  saving.value = true; error.value = null
  const wasGated = gated.value
  if (newKey.value) {
    try { keyInfo.value = await settingsAPI.set({ runpod_api_key: newKey.value }); newKey.value = ''; await settingsStore.load() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (wasGated) { saving.value = false; return }   // the key is in: the rest of the panel appears, nothing else to save yet
  if (newS3.access || newS3.secret) {
    try { keyInfo.value = await settingsAPI.set({ runpod_s3_access_key: newS3.access || undefined, runpod_s3_secret_key: newS3.secret || undefined }); newS3.access = ''; newS3.secret = '' }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (panamaCfgChanged()) {
    try { keyInfo.value = await settingsAPI.set({ panama_bucket: panamaCfg.bucket, panama_region: panamaCfg.region, panama_profile: panamaCfg.profile }); await panamaStore.loadStatus() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (agentRulesChanged()) {
    try { keyInfo.value = await settingsAPI.set({ agent_named_yes_required: !!agentRules.namedYes, agent_spend_cap_usd: Math.max(0, Number(agentRules.cap) || 0) }) }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (newPanama.access || newPanama.secret) {
    try { keyInfo.value = await settingsAPI.set({ panama_aws_access_key: newPanama.access || undefined, panama_aws_secret_key: newPanama.secret || undefined }); newPanama.access = ''; newPanama.secret = ''; await panamaStore.loadStatus() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (newClaude.value) {
    try { keyInfo.value = await settingsAPI.set({ anthropic_api_key: newClaude.value }); claudeSaved = true; newClaude.value = ''; await settingsStore.load() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (newHf.value) {
    try { keyInfo.value = await settingsAPI.set({ hf_token: newHf.value }); newHf.value = '' }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  const before = JSON.parse(JSON.stringify(mounts.config || {})), sent = body()
  const r = await mounts.save(sent, { quiet: !forPod.value })
  if (!r.ok) { saving.value = false; error.value = mounts.error; return }
  take(r.value)
  // Say what was saved and check it landed: ask the core again, and name the sections only when what it holds changed (a failure to land is red, never silent)
  if (!forPod.value) {
    const keys = changedKeys(before, sent)
    let loaded = null
    try { loaded = (await mounts.load())?.config } catch { loaded = null }
    const missing = loaded ? notLanded(before, loaded, keys, sent) : []
    if (missing.length) { error.value = t('config.notLanded', { what: missing.join(', ') }); toastStore.error(error.value, t('toast.failed')) }
    else toastStore.success(`${t('toast.configSaved')} ${clockNow()}${(() => { const sec = changedSections(before, loaded || sent); return sec.length ? `: ${sec.join(', ')}` : ` · ${t('config.nothingChanged')}` })()}`, t('toast.done'), 10000)
    if (missing.length) { saving.value = false; return }
  }
  followNoSpend(r.value)
  // The Publishing section is part of this window: its edits are written by this Save, after the configuration; a failure there is said plainly and the window stays open.
  if (pubRef.value?.dirty) {
    const pr = await pubRef.value.save()
    if (!pr.ok) { saving.value = false; error.value = t('publish.partialSave', { reason: pr.error }); tab.value = 'publishing'; await nextTick(); document.querySelector('[data-testid="publish-field-error"]')?.scrollIntoView({ block: 'center' }); return }
  }
  if (pubS3Ref.value?.dirty) {
    const pr = await pubS3Ref.value.save()
    if (!pr.ok) { saving.value = false; error.value = t('publish.partialSave', { reason: pr.error }); tab.value = 'storage'; await nextTick(); document.querySelector('[data-testid="publish-field-error"]')?.scrollIntoView({ block: 'center' }); return }
  }
  saving.value = false
  forceClose = true
  ui.configOpen = false
}

async function reset() {
  // with Auto-publish ON the reset turns it off: say so first
  if (cfg.value?.auto_publish?.enabled && !(await confirm.ask(t('autopublish.resetConfirm'), { okLabel: t('config.clear') }))) return
  saving.value = true; error.value = null
  const r = await mounts.reset()
  saving.value = false
  if (r.ok) { take(r.value); followNoSpend(r.value) } else error.value = mounts.error
}

/** No-spend mode is read from the pod list's answer; after a save the header must not wait for the next refresh: set it from what the core just said,
 *  then reload the list (simulated pods replace real ones, or the other way round). */
function followNoSpend(payload) {
  if (forPod.value) return
  podsStore.dryRun = !!payload?.dry_run
  podsStore.load()
}

const SHARED_ROWS = [{ field: 'sync_shared', id: 'sync-shared', label: 'sharedPush' }, { field: 'pull_shared', id: 'pull-shared', label: 'sharedPull' }]
function toggleShared(field, d, on) {
  const have = new Set(cfg.value[field])
  if (on) have.add(d); else have.delete(d)
  cfg.value[field] = SHARED_DIRS.filter((x) => have.has(x))
}
</script>

<style scoped>
.cfg-shared-row + .cfg-shared-row { border-top: 1px dotted var(--bs-border-color); margin-top: .25rem; padding-top: .35rem !important; }
</style>
