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
    @shown="focusSection"
  >
    <p class="text-body-secondary small mb-3" :data-testid="forPod ? 'config-modal-pod' : 'config-modal'">{{ forPod ? $t('config.podIntro') : $t('config.intro') }}</p>

    <div v-if="loading" class="text-center text-body-secondary py-3"><BSpinner small /></div>

    <template v-else-if="cfg">
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
              <template v-if="claudeChecking"><BSpinner small class="me-1" />{{ $t('config.claudeChecking') }}</template>
              <template v-else><i class="fa-solid me-1" :class="claudeResult.ok ? 'fa-circle-check' : 'fa-triangle-exclamation'"></i>{{ claudeResult.ok ? (newClaude ? $t('config.claudeWorksTyped') : $t('config.claudeWorks')) : claudeResult.error }}</template>
            </div>
          </BFormGroup>
        </BCol>
        <BCol v-if="!gated" md="12"><hr class="my-1" /><div class="small fw-semibold" data-testid="cfg-panama-title">{{ $t('config.panamaTitle') }}</div><div class="form-text mt-0">{{ $t('config.panamaHelp') }}</div></BCol>
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
      </BRow>
      </fieldset>

      <template v-if="!gated">
      <fieldset v-show="show('volume')" class="cfg-section" data-section="volume">
      <legend data-testid="section-volume">{{ $t('config.volume') }}</legend>
      <BAlert :model-value="true" variant="info" class="small py-2 mb-3"><i class="fa-solid fa-circle-info me-2"></i>{{ $t('config.volumeHint') }}</BAlert>
      <BRow class="g-3">
        <BCol cols="12">
          <BFormGroup :label="$t('config.datacenter')" label-for="cfg-dc" :description="$t('config.datacenterHelp')">
            <BFormSelect id="cfg-dc" v-model="cfg.data_center_id" :options="dcOptions" class="font-monospace" data-testid="cfg-dc" />
            <div v-if="cfg.data_center_id" class="mt-2" data-testid="cfg-dc-cards">
              <table v-if="dcCards.length" class="table table-sm table-borderless small mb-1 w-auto">
                <thead class="text-body-secondary"><tr><th>{{ $t('config.cardsCard') }}</th><th class="text-end">{{ $t('config.cardsVram') }}</th><th class="text-end">{{ $t('config.cardsPrice') }}</th><th>{{ $t('config.cardsStock') }}</th></tr></thead>
                <tbody><tr v-for="c in dcCards" :key="c.key" data-testid="cfg-dc-card"><td>{{ c.name }}</td><td class="text-end">{{ c.vram }} GB</td><td class="text-end">${{ c.price }}/h</td><td>{{ c.stock }}</td></tr></tbody>
              </table>
              <div v-else class="form-text mt-0">{{ $t('config.cardsNone', { dc: cfg.data_center_id }) }}</div>
              <div v-if="dcEntry?.s3" class="form-text mt-0">{{ $t('config.cardsS3') }}</div>
            </div>
          </BFormGroup>
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
          <BFormGroup :label="$t('config.syncParallel')" label-for="cfg-sync-parallel" :description="$t('config.syncParallelHelp')">
            <BFormInput id="cfg-sync-parallel" v-model.number="cfg.sync_parallel" type="number" min="1" max="16" data-testid="cfg-sync-parallel" />
          </BFormGroup>
        </BCol>
      </BRow>
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

      <fieldset v-if="!forPod && !gated" v-show="show('adapters')" class="cfg-section" data-section="adapters">
        <legend data-testid="section-adapters">{{ $t('adapters.section') }}</legend>
        <AdapterManager />
      </fieldset>
      <fieldset v-show="show('options')" class="cfg-section" data-section="options">
        <legend>{{ $t('config.options') }}</legend>
      <BFormCheckbox v-if="!forPod" v-model="cfg.apply_by_default" switch class="mb-2" data-testid="cfg-apply-default">
        {{ $t('config.applyDefault') }} <span class="text-body-secondary">{{ $t('config.applyDefaultHint') }}</span>
      </BFormCheckbox>
      <BFormCheckbox v-if="!forPod" v-model="cfg.dry_run" switch class="mb-1" :disabled="dryForced" data-testid="cfg-dry-run">
        {{ $t('config.dryRun') }} <span class="text-body-secondary">{{ $t('config.dryRunHint') }}</span>
      </BFormCheckbox>
      <div v-if="!forPod && dryForced" class="small text-warning mb-3" data-testid="cfg-dry-forced"><i class="fa-solid fa-lock me-1"></i>{{ $t('config.dryForced') }}</div>
      <div v-else-if="!forPod" class="mb-2"></div>

      <details class="mb-2">
        <summary class="small text-body-secondary">{{ $t('config.previewLocal') }}</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap">{{ localText }}</pre>
      </details>
      <details class="mb-3">
        <summary class="small text-body-secondary" data-testid="preview-pod-toggle">{{ $t('config.previewPod') }}</summary>
        <pre class="small bg-body-tertiary rounded p-2 mt-2 mb-0" style="white-space: pre-wrap" data-testid="preview-pod">{{ previewText }}</pre>
      </details>
      </fieldset>

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
        <small class="text-body-secondary me-auto">{{ stored ? $t('config.savedIn', { store }) : $t('config.nothingSaved') }}</small>
        <BButton v-if="!gated" variant="outline-danger" size="sm" :disabled="saving || !stored" data-testid="config-clear" @click="reset">{{ $t('config.clear') }}</BButton>
        <BButton v-if="!gated" variant="outline-light" size="sm" data-testid="config-close" @click="ui.configOpen = false">{{ $t('config.close') }}</BButton>
        <BButton variant="primary" size="sm" :disabled="saving || (gated && !newKey)" data-testid="config-save" @click="save"><BSpinner v-if="saving" small class="me-1" />{{ gated ? $t('config.saveKey') : $t('config.save') }}</BButton>
      </template>
    </template>

    <FolderPicker v-model="picker.open" :title="picker.title" :start="picker.start" :memory-key="picker.memory" @choose="picked" />
  </BModal>
</template>

<script setup>
import { podsAPI } from '../api/pods'
import { datacenterOptions } from '../utils/datacenters'
import DockerfileModal from './DockerfileModal.vue'
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

const props = defineProps({
  mode: { type: String, default: 'default' },      // 'default' | 'pod'
  modelValue: { type: Boolean, default: false },    // pod mode: open
  initial: { type: Object, default: null },         // pod mode: the pod's own configuration, or null for the default
  podName: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue', 'apply'])
const forPod = computed(() => props.mode === 'pod')

const ui = useUiStore()
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
  { key: 'volume', label: t('config.volume') },
  { key: 'folders', label: t('config.folders') },
  { key: 'environment', label: t('config.environment') },
  ...(forPod.value ? [] : [{ key: 'adapters', label: t('adapters.section') }]),
  { key: 'options', label: t('config.options') },
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
watch(keyInfo, (k) => { panamaCfg.bucket = k.panama_bucket || panamaDefaults.value.bucket; panamaCfg.region = k.panama_region || panamaDefaults.value.region; panamaCfg.profile = k.panama_profile || panamaDefaults.value.profile }, { immediate: true })
const panamaCfgChanged = () => { const k = keyInfo.value; return panamaCfg.bucket !== (k.panama_bucket || panamaDefaults.value.bucket) || panamaCfg.region !== (k.panama_region || panamaDefaults.value.region) || panamaCfg.profile !== (k.panama_profile || panamaDefaults.value.profile) }
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
}

/** The datacenter menu: RunPod's list with S3 support and our cards at the secure-cloud price; the saved id is kept even when the list lacks it. */
const dcList = ref([])
const dcEntry = computed(() => dcList.value.find((d) => d.value === cfg.value?.data_center_id) || null)
const dcCards = computed(() => dcEntry.value?.cards || [])   // read-only: what a volume pod can get there, at the secure-cloud price
const dcOptions = computed(() => datacenterOptions(dcList.value, { value: '', text: t('config.datacenterAny') }, cfg.value?.data_center_id))
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

async function loadDatacenters() {
  try { dcList.value = (await podsAPI.datacenters()).datacenters || [] } catch { /* the saved id stays selectable */ }
}

async function load() {
  overStudio.value = studioStore.open   // opened from inside the Adapter Studio (the Claude key): it must sit above it
  loadDatacenters()
  loadVolumes()
  loading.value = true; error.value = null
  if (forPod.value) {
    // the pod's own configuration through the API's preview (its derived rows), else the default as saved
    try { take(props.initial ? await mountsAPI.preview(props.initial) : (await mounts.load()) || {}) }
    catch (e) { error.value = e.response?.data?.detail || e.message }
    if (!cfg.value) error.value ||= mounts.error
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

function body() {
  const env = {}
  for (const r of envRows.value) if (r.key) env[r.key] = r.value
  return { ...cfg.value, env }
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
async function focusSection() {
  const where = ui.configFocus
  ui.configFocus = ''
  if (where === 'adapters') { tab.value = 'adapters'; await nextTick(); document.querySelector('[data-testid="section-adapters"]')?.scrollIntoView({ block: 'start' }) }
  if (where === 'claude') {
    tab.value = 'runpod'; await nextTick()
    const input = document.getElementById('cfg-claude-key')
    input?.scrollIntoView({ block: 'center' })
    input?.focus({ preventScroll: true })
  }
}

async function save() {
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
  if (newPanama.access || newPanama.secret) {
    try { keyInfo.value = await settingsAPI.set({ panama_aws_access_key: newPanama.access || undefined, panama_aws_secret_key: newPanama.secret || undefined }); newPanama.access = ''; newPanama.secret = ''; await panamaStore.loadStatus() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  if (newClaude.value) {
    try { keyInfo.value = await settingsAPI.set({ anthropic_api_key: newClaude.value }); claudeSaved = true; newClaude.value = ''; await settingsStore.load() }
    catch (e) { error.value = e.response?.data?.detail || e.message; saving.value = false; return }
  }
  const r = await mounts.save(body())
  saving.value = false
  if (!r.ok) { error.value = mounts.error; return }
  take(r.value)
  followNoSpend(r.value)
  ui.configOpen = false
}

async function reset() {
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
