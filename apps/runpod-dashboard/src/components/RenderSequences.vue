<template>
  <div class="border rounded p-2 mb-2" data-testid="pod-outputs-render">
    <div class="fw-semibold">{{ $t('outputs.render.title') }}</div>
    <div class="small text-body-secondary mb-1">{{ $t('outputs.render.desc') }}</div>
    <div v-if="settingsNote" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-settings" :data-source="settingsNote === 'settingsPod' ? 'pod' : 'default'">{{ $t(`outputs.render.${settingsNote}`) }}</div>
    <div v-if="renders.old || plan?.old" class="alert alert-info py-1 px-2 small mb-2" data-testid="pod-outputs-render-restart">{{ $t('outputs.render.restart') }}</div>
    <template v-else>
      <div v-if="presetSupported" class="small mb-2" data-testid="pod-outputs-render-preset-block">
        <label class="mb-0">{{ $t('outputs.render.preset') }}
          <select v-model="prefs.preset" class="form-select form-select-sm" :disabled="running" data-testid="pod-outputs-render-preset"><option value="none">{{ $t('outputs.render.presetStandard') }}</option><option value="tunnel">{{ $t('outputs.render.presetTunnel') }}</option></select>
        </label>
        <div v-if="tunnel" class="text-body-secondary mt-1" data-testid="pod-outputs-render-tunnel-fixed">{{ $t('outputs.render.tunnelFixed') }}</div>
        <div v-for="(w, i) in plan?.warnings || []" :key="i" class="alert alert-warning py-1 px-2 mt-1 mb-0" data-testid="pod-outputs-render-preset-warning"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ w }}</div>
      </div>
      <div class="small mb-2" role="radiogroup" data-testid="pod-outputs-render-kind">
        <label v-for="k in KINDS" :key="k" class="d-flex gap-2 align-items-center"><input v-model="prefs.kind" type="radio" class="form-check-input mt-0" :value="k" :disabled="tunnel" :data-testid="`pod-outputs-render-kind-${k}`" />{{ $t(k === 'review' ? 'outputs.render.kindReview' : 'outputs.render.kindProxy') }}</label>
      </div>
      <div v-if="isReview" class="mb-2">
        <label class="small mb-0 d-block">{{ $t('outputs.render.approvedBy') }}
          <input v-model="approvedBy" type="text" class="form-control form-control-sm" :placeholder="$t('outputs.render.approvedPlaceholder')" data-testid="pod-outputs-render-approved-by" autocomplete="off" />
        </label>
        <div v-if="!approvedBy.trim()" class="small text-warning" data-testid="pod-outputs-render-approved-hint">{{ $t('outputs.render.approvedHint') }}</div>
        <div class="d-flex gap-3 flex-wrap small mt-1" data-testid="pod-outputs-render-codecs">
          <label class="d-flex gap-2 align-items-center"><input v-model="prefs.h264" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-codec-h264" />{{ $t('outputs.render.codecH264') }}</label>
          <label class="d-flex gap-2 align-items-center"><input v-model="prefs.prores" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-codec-prores" />{{ $t('outputs.render.codecProres') }}</label>
        </div>
        <div v-if="prefs.prores && !prefs.h264" class="small text-body-secondary mt-1" data-testid="pod-outputs-render-prores-hint">{{ $t('outputs.render.proresOnlyHint') }}</div>
        <div class="small text-body-secondary mt-1" data-testid="pod-outputs-render-review-note">{{ $t('outputs.render.reviewNote') }}</div>
      </div>
      <div class="d-flex gap-3 flex-wrap align-items-end mb-2">
        <label v-if="!tunnel" class="small mb-0">{{ $t('outputs.render.size') }}
          <select v-model="prefs.width" class="form-select form-select-sm" data-testid="pod-outputs-render-width"><option v-for="o in widthOptions" :key="o.v" :value="o.v">{{ o.label }}</option></select>
        </label>
        <div v-if="items.length" class="small text-body-secondary w-100 order-last" data-testid="pod-outputs-render-source">
          <template v-if="planning && !plan">{{ $t('outputs.render.sourceReading') }}</template>
          <template v-else-if="!srcGroups.length">{{ $t('outputs.render.sourceUnknown') }}</template>
          <template v-else><div v-for="(l, i) in sourceLines" :key="i" data-testid="pod-outputs-render-source-line">{{ l }}</div></template>
        </div>
        <div v-if="prefs.width !== 'source'" class="small text-body-secondary w-100 order-last" data-testid="pod-outputs-render-downscale-hint">{{ $t('outputs.render.downscaleHint') }}</div>
        <label v-if="!tunnel" class="small mb-0">{{ $t('outputs.render.fps') }}
          <select v-model="prefs.fps" class="form-select form-select-sm" data-testid="pod-outputs-render-fps"><option v-for="f in FPS_CHOICES" :key="f" :value="f">{{ f === 'auto' ? $t('outputs.render.fpsAuto') : `${f} fps` }}</option></select>
        </label>
        <label class="small mb-0">{{ $t('outputs.render.where') }}
          <select v-model="prefs.where" class="form-select form-select-sm" data-testid="pod-outputs-render-where"><option v-for="w in WHERE_CHOICES" :key="w" :value="w" :data-ok="whereOk(w) ? 'true' : 'false'">{{ whereLabel(w) }}</option></select>
        </label>
        <label class="small mb-0" :title="$t('outputs.render.colourGlobalTitle')">{{ $t('outputs.render.colourGlobal') }}
          <select id="col-all" :value="colourShown" class="form-select form-select-sm" data-testid="pod-outputs-render-colour-all" :data-uniform="uniformColour || ''" :data-override="colourAll || ''" @change="setColourAll($event.target.value)"><option value="">{{ $t('outputs.render.colourPerSeq') }}</option><option v-for="c in COLOURS" :key="c" :value="c">{{ $t(`edl.colours.${c}`) }}</option></select>
        </label>
      </div>
      <div class="small mb-2" data-testid="pod-outputs-render-adapters">
        <div v-for="id in ['pod', 'local']" :key="id" class="d-flex align-items-baseline gap-2" data-testid="pod-outputs-render-adapter" :data-id="id" :data-ok="adapters[id].ok ? 'true' : 'false'">
          <i class="fa-solid fa-circle dot" :class="adapters[id].ok ? 'text-success' : 'text-danger'" aria-hidden="true"></i>
          <span class="fw-semibold">{{ $t(id === 'pod' ? 'outputs.render.adapterPod' : 'outputs.render.adapterLocal') }}</span>
          <span class="text-body-secondary" data-testid="pod-outputs-render-adapter-reason">{{ adapterText(id) }}</span>
        </div>
        <div v-if="problem && !problem.blocker" class="text-body-secondary mt-1" data-testid="pod-outputs-render-no-ffmpeg-note">{{ problem.kind === 'broken' ? problem.reason : $t('outputs.render.noFfmpeg.note') }}</div>
      </div>
      <FfmpegAlert v-if="problem && problem.blocker" :problem="problem" :busy="planning" @check="checkAgain" />
      <div v-if="!items.length" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-none">{{ $t('outputs.render.noSequences') }}</div>
      <div v-else class="small mb-2" data-testid="pod-outputs-render-plan" :data-sequences="summary.sequences" :data-frames="summary.frames">
        <template v-if="planning && !plan"><BSpinner small class="me-2 flex-shrink-0" />{{ $t('outputs.render.planning') }}</template>
        <template v-else-if="plan">{{ planText }}</template>
      </div>
      <div v-if="plan && !plan.old && items.length" class="small mb-2" data-testid="pod-outputs-render-pod">
        <div v-if="plan.pod_cpu" :class="plan.pod_cpu.cores < 8 ? 'text-warning' : 'text-body-secondary'" data-testid="pod-outputs-render-pod-cpu" :data-warn="plan.pod_cpu.cores < 8 ? 'true' : 'false'">{{ $t('outputs.render.podCpu', { cores: plan.pod_cpu.cores, ram: Math.round((plan.pod_cpu.mem_mb || 0) / 1024), free: Math.round(plan.pod_cpu.free_gb || 0) }) }}</div>
        <div v-if="outputGb" class="text-body-secondary" data-testid="pod-outputs-render-output-size">{{ $t('outputs.render.outputSize', { gb: outputGb, codec: isReview && prefs.prores ? 'ProRes' : 'H.264' }) }}</div>
        <div v-for="(n, i) in plan.notes || []" :key="i" class="text-warning" data-testid="pod-outputs-render-note">{{ n }}</div>
        <div class="text-body-secondary" data-testid="pod-outputs-render-cpu-hint">{{ $t('outputs.render.cpuHint') }}</div>
      </div>
      <section v-if="items.length" class="small mb-2" data-testid="pod-outputs-render-clipnames" :data-open="'true'">
        <div class="d-flex align-items-center gap-2 mb-1">
          <span class="fw-semibold" data-testid="pod-outputs-render-sequences-title">{{ $t('outputs.render.sequencesTitle', { n: items.length }) }}</span>
          <BButton v-if="colourRows.length" variant="link" size="sm" class="p-0 ms-auto" data-testid="pod-outputs-render-colour-copy" @click="copyColour"><i class="fa-regular fa-copy me-1"></i>{{ colourCopied ? $t('outputs.render.colourCopied') : $t('outputs.render.colourCopy') }}</BButton>
        </div>
        <div class="d-flex align-items-center gap-2 flex-wrap mb-1" data-testid="pod-outputs-render-select-bar">
          <BButton variant="outline-light" size="sm" data-testid="pod-outputs-render-select-all" @click="selectShown(true)">{{ $t('outputs.render.selectAll') }}</BButton>
          <BButton variant="outline-light" size="sm" data-testid="pod-outputs-render-select-none" @click="selectShown(false)">{{ $t('outputs.render.selectNone') }}</BButton>
          <BButton variant="outline-light" size="sm" data-testid="pod-outputs-render-summary-open" @click="summaryOpen = true"><i class="fa-regular fa-rectangle-list me-1"></i>{{ $t('outputs.render.summaryOpen') }}</BButton>
          <span class="text-body-secondary" data-testid="pod-outputs-render-selected-count">{{ $t('outputs.render.selectedCount', { n: chosen.length, m: items.length }) }}</span>
          <BFormInput v-model="filterText" size="sm" class="ms-auto" style="max-width: 16rem" :placeholder="$t('outputs.render.filterSequences')" data-testid="pod-outputs-render-filter" autocomplete="off" />
        </div>
        <div class="text-body-secondary mb-1">{{ $t('outputs.render.clipNamesNote') }}</div>
        <div v-if="(tunnel || anyColourNeeded) && anyColourMissing" class="my-1 text-body-secondary" data-testid="pod-outputs-render-colour-hint">{{ $t('edl.colourHint') }}</div>
        <div v-if="edlNeeded && edl.seen && !edl.old && !edl.loaded" class="d-flex align-items-center gap-2 text-warning my-1" data-testid="edl-none-line"><span>{{ $t('edl.noneLine') }}</span><BButton size="sm" variant="outline-primary" :disabled="edl.loading" data-testid="edl-none-load" @click="edl.load()"><BSpinner v-if="edl.loading" small class="me-1" />{{ $t('edl.noneLoad') }}</BButton></div>
        <div v-if="planning && isReview && reviewRows.length < (plan?.sequences || []).length" class="text-body-secondary" data-testid="pod-outputs-render-review-planning"><BSpinner small class="me-2 flex-shrink-0" />{{ $t('outputs.render.reviewPlanning') }}</div>
        <div v-if="blockedCount" class="text-danger my-1" data-testid="pod-outputs-render-blocked-summary">{{ $t(blockedCount === 1 ? 'edl.blockedOne' : 'edl.blocked', { n: blockedCount }) }}</div>
        <div v-if="!filtered.length" class="text-body-secondary mb-2" data-testid="pod-outputs-render-filter-none">{{ $t('outputs.render.filterNone') }}</div>
        <div v-for="i in pageItems" :key="seqKey(i)" class="border rounded p-2 mb-2 d-flex gap-2 align-items-start" :class="{ 'opacity-50': !isSel(i) }" data-testid="pod-outputs-render-clip-row" :data-name="i.name" :data-selected="isSel(i) ? 'true' : 'false'" :data-blocked="rowBlocked(i) ? 'true' : 'false'">
          <div class="position-relative flex-shrink-0 rounded overflow-hidden d-flex align-items-center justify-content-center text-body-secondary" style="width: 8.5rem; height: 4.8rem; background: #14161b" data-testid="pod-outputs-render-thumb">
            <SequenceThumb v-if="thumbs[seqKey(i)]" :tile="thumbs[seqKey(i)].tile" :base="thumbs[seqKey(i)].base" :scope="scope" :volume-name="volumeName" :offline="!thumbs[seqKey(i)].base" auto />
            <i v-else class="fa-solid fa-film"></i>
          </div>
          <div class="flex-grow-1" style="min-width: 0">
          <div class="d-flex align-items-center gap-2">
            <input type="checkbox" class="form-check-input mt-0 flex-shrink-0" :checked="isSel(i)" :aria-label="$t('outputs.render.selectRow', { name: i.name })" data-testid="pod-outputs-render-select" :data-name="i.name" @change="toggleSel(i, $event.target.checked)" />
            <input type="text" class="form-control form-control-sm font-monospace" :value="clipOf(i)" :list="edlOn ? `edl-clips-${i.name}` : undefined" :aria-label="$t('outputs.render.clipNameFor', { name: i.name })" data-testid="pod-outputs-render-clipname" :data-name="i.name" @input="clipEdits[`${i.dir}/${i.name}`] = $event.target.value" />
            <span v-if="edlOn" class="badge fw-normal flex-shrink-0" :class="edl.matchOf(clipOf(i)) === 'match' ? 'text-bg-success' : 'text-bg-warning'" data-testid="pod-outputs-render-clip-match" :data-match="edl.matchOf(clipOf(i))">{{ edl.matchOf(clipOf(i)) === 'match' ? $t('edl.matches') : $t('edl.notIn') }}</span>
          </div>
          <datalist v-if="edlOn" :id="`edl-clips-${i.name}`"><option v-for="e in edl.forShot(shotOfClip(i.name))" :key="e.clip" :value="e.clip" /></datalist>
          <div v-if="clipProblem(clipOf(i))" class="text-danger" data-testid="pod-outputs-render-clipname-error">{{ $t(`outputs.render.${clipProblem(clipOf(i))}`) }}</div>
          <div class="d-flex align-items-center gap-2 flex-wrap mt-1 text-body-secondary" data-testid="pod-outputs-render-row-facts">
            <span v-if="rowOf(i)?.colour || rowOf(i)?.source" class="font-monospace" data-testid="pod-outputs-render-row-source">{{ rowFacts(rowOf(i)) }}</span>
            <span v-if="rowColour(i)" :class="rowColour(i).src === 'none' ? 'text-warning' : ''" data-testid="pod-outputs-render-row-colour" :data-source="rowColour(i).src">{{ rowColour(i).text ? rowColour(i).text : rowColour(i).how ? $t('outputs.render.rowColour', { name: rowColour(i).name, how: rowColour(i).how }) : $t('outputs.render.rowColourBare', { name: rowColour(i).name }) }}</span>
            <span v-if="rowOf(i)?.header_transfer" data-testid="pod-outputs-render-header-transfer">{{ $t('edl.headerSays', { t: rowOf(i).header_transfer }) }}</span>
            <span v-if="rowOf(i)?.colour?.verdict === 'refused'" class="badge text-bg-danger fw-normal" data-testid="pod-outputs-render-row-refused">{{ $t('outputs.render.colourRefused', { reason: rowOf(i).colour.refusal || '' }) }}</span>
            <span v-if="isReview && rowOf(i)?.shot && rowOf(i)?.next_version != null" data-testid="pod-outputs-render-review-shot" :data-shot="rowOf(i).shot" :data-version="rowOf(i).next_version" :title="reviewFolder(rowOf(i).shot, rowOf(i).next_version)"><span class="font-monospace">{{ $t('outputs.render.reviewShot', { shot: rowOf(i).shot, version: v3(rowOf(i).next_version) }) }}</span> <span>{{ $t('outputs.render.reviewFolder', { folder: reviewFolder(rowOf(i).shot, rowOf(i).next_version) }) }}</span></span>
          </div>
          <div class="d-flex gap-1 flex-wrap mt-1" data-testid="pod-outputs-render-row-actions">
            <BButton size="sm" variant="outline-light" :disabled="!thumbs[seqKey(i)]" :title="$t('outputs.render.framesOpen')" data-testid="pod-outputs-render-frames-open" :data-name="i.name" @click="framesFor = seqKey(i)"><i class="fa-regular fa-eye me-1"></i>{{ $t('outputs.render.framesOpen') }}</BButton>
            <BButton size="sm" variant="outline-light" :title="$t('outputs.render.colourEdit')" data-testid="pod-outputs-render-colour-edit" :data-name="i.name" @click="colourFor = seqKey(i)"><i class="fa-solid fa-palette me-1"></i><span data-testid="pod-outputs-render-colour-edit-label">{{ colourButtonLabel(i) }}</span></BButton>
            <BButton v-if="reviewDoneOf(i)" size="sm" variant="outline-light" :title="$t('outputs.render.reviewPlay')" data-testid="pod-outputs-render-review-play" :data-shot="reviewDoneOf(i).shot" @click="playReview(reviewDoneOf(i))"><i class="fa-solid fa-play me-1"></i>{{ $t('outputs.render.reviewPlay') }}</BButton>
            <BButton v-else size="sm" variant="outline-light" disabled data-testid="pod-outputs-render-review-play-disabled"><i class="fa-solid fa-play me-1"></i>{{ $t('outputs.render.reviewPlay') }}</BButton>
          </div>
          <div v-if="reviewDoneOf(i)" class="text-success mt-1" data-testid="pod-outputs-render-review-done" :data-shot="reviewDoneOf(i).shot" :data-version="reviewDoneOf(i).version">{{ $t('outputs.render.reviewDone', { shot: reviewDoneOf(i).shot, version: v3(reviewDoneOf(i).version), folder: reviewDoneOf(i).folder }) }}</div>
          <div v-if="jobSeqOf(i)" class="d-flex gap-2 align-items-center flex-wrap mt-1" data-testid="pod-outputs-render-seq" :data-state="jobSeqOf(i).state" :data-where="jobSeqOf(i).where || ''" :data-name="i.name">
            <span v-if="jobSeqOf(i).clip_name && jobSeqOf(i).clip_name !== jobSeqOf(i).name" class="font-monospace text-body-secondary" data-testid="pod-outputs-render-seq-clip">→ {{ jobSeqOf(i).clip_name }}</span>
            <span v-if="jobSeqOf(i).where" class="badge text-bg-secondary" data-testid="pod-outputs-render-seq-where">{{ $t(`outputs.render.whereBadge.${jobSeqOf(i).where}`) }}</span>
            <span :class="jobSeqOf(i).state === 'failed' ? 'text-danger' : 'text-body-secondary'" data-testid="pod-outputs-render-seq-state">{{ $t(`outputs.render.state.${jobSeqOf(i).state}`) }}<template v-if="jobSeqOf(i).state === 'rendering' && jobSeqOf(i).frames_total">{{ ` ${jobSeqOf(i).frames_done} / ${jobSeqOf(i).frames_total}` }}</template></span>
            <BProgress v-if="jobSeqOf(i).state === 'rendering' && jobSeqOf(i).frames_total" :value="jobSeqOf(i).frames_done || 0" :max="jobSeqOf(i).frames_total" height="4px" style="width: 7rem" animated striped data-testid="pod-outputs-render-seq-bar" />
            <span v-if="jobSeqOf(i).state === 'skipped' && (jobSeqOf(i).reason || jobSeqOf(i).skip)" class="text-body-secondary" data-testid="pod-outputs-render-seq-reason">{{ jobSeqOf(i).reason || jobSeqOf(i).skip }}</span>
            <span v-if="jobSeqOf(i).error" class="text-danger" data-testid="pod-outputs-render-seq-error">{{ jobSeqOf(i).error }}</span>
            <span v-else-if="jobSeqOf(i).warning" class="text-warning" data-testid="pod-outputs-render-seq-warning">{{ jobSeqOf(i).warning }}</span>
          </div>
          <div v-if="tunnel" class="d-flex align-items-center gap-2 mt-1 flex-wrap"><label class="mb-0" :for="`tc-${i.name}`">{{ $t('outputs.render.startTimecode') }}</label>
            <input :id="`tc-${i.name}`" type="text" class="form-control form-control-sm font-monospace" style="width: 8rem" :placeholder="$t('edl.tcPlaceholder')" :value="tcShown(i)" data-testid="pod-outputs-render-start-timecode" :data-name="i.name" @input="tcEdits[`${i.dir}/${i.name}`] = $event.target.value" />
            <span class="text-body-secondary" data-testid="pod-outputs-render-timecode-source">{{ tcSourceText(i) }}</span></div>
          <div v-if="tunnel && tcProblemOf(i)" class="text-danger" data-testid="pod-outputs-render-timecode-error">{{ $t('outputs.render.timecodeBad') }}</div>
          <div v-if="rowOutputs(i).length" class="mt-1" data-testid="pod-outputs-render-outputs"><div v-for="n in rowOutputs(i)" :key="n" class="font-monospace text-break text-body-secondary" data-testid="pod-outputs-render-output-name">{{ n }}</div></div>
          <SeqFlags v-if="rowOf(i)?.flags?.length" :flags="rowOf(i).flags" :row="rowOf(i)" :stem="i.name" :override="!!edlOverride[i.name]" :candidates="cands[i.name] || []" @update:override="(v) => (edlOverride[i.name] = v)" @pick="(c) => (clipEdits[`${i.dir}/${i.name}`] = c)" />
          </div>
        </div>
        <div v-if="filtered.length > PAGE_SIZES[0]" class="d-flex align-items-center gap-2 flex-wrap mb-2" data-testid="pod-outputs-render-pager">
          <BButton variant="outline-light" size="sm" :disabled="page === 0" data-testid="pod-outputs-render-page-prev" @click="page--">‹</BButton>
          <span data-testid="pod-outputs-render-page-info">{{ pageInfo }}</span>
          <BButton variant="outline-light" size="sm" :disabled="page >= pageCount - 1" data-testid="pod-outputs-render-page-next" @click="page++">›</BButton>
          <select v-model.number="pageSize" class="form-select form-select-sm ms-auto" style="width: auto" :aria-label="$t('outputs.render.pageSize')" data-testid="pod-outputs-render-page-size"><option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ $t('outputs.render.perPage', { n }) }}</option></select>
        </div>
        <div v-for="c in convs" :key="c" class="text-body-secondary" data-testid="pod-outputs-render-colour-conversion">{{ $t('outputs.render.colourConversion', { what: c }) }}</div>
        <div v-if="convs.some(noTransform)" class="text-body-secondary" data-testid="pod-outputs-render-colour-note">{{ $t('outputs.render.colourNoTransform') }}</div>
      </section>
      <DpxViewerModal :frames="framesTile ? framesTile.tile.frames : []" :base="framesTile ? framesTile.base : ''" :sequence="framesItem" :pod-id="pod.id" @close="framesFor = null" />
      <SelectionSummaryModal :open="summaryOpen" :rows="summaryRows" :total="items.length" @close="summaryOpen = false" />
      <ClipColourModal :open="!!colourItem" :name="colourItem ? colourItem.name : ''" :header="colourItem ? rowOf(colourItem)?.header_transfer || '' : ''" :model-value="colourItem ? colourOf(colourItem) : ''" :colours="COLOURS" :empty-label="colourEmptyLabel" :assumption="colourItem ? rowOf(colourItem)?.colour_assumption || '' : ''" :ocio="colourItem && ocioOf(colourItem) ? t('outputs.render.rowColourOcio', { label: ocioOf(colourItem).label }) : ''" :header-disagrees="!!(colourItem && rowOf(colourItem)?.header_disagrees)" :suggested="colourItem && rowOf(colourItem)?.suggested_colour ? colourName(rowOf(colourItem).suggested_colour) : ''" @update:model-value="(v) => colourItem && (colourIn[seqKey(colourItem)] = v)" @close="colourFor = null" />
      <div v-for="(n, i) in estimates" :key="i" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-estimate">{{ n }}</div>
      <div v-if="skipped" class="small text-body-secondary mb-2" data-testid="pod-outputs-render-skipped">{{ $t('outputs.render.skippedNames', { n: skipped }) }}</div>
      <div v-if="plan && !skipExisting && (isReview || toSkip)" class="small text-warning mb-1" data-testid="pod-outputs-render-redo-note">{{ $t(isReview ? 'outputs.render.newVersions' : 'outputs.render.replaceProxies') }}</div>
      <div v-if="allSkipped" class="small text-warning mb-1" data-testid="pod-outputs-render-all-skipped">{{ $t('outputs.render.allSkipped') }}</div>
      <div v-for="s in incompleteList" :key="`${s.dir}/${s.name}`" class="small text-warning mb-1" data-testid="pod-outputs-render-incomplete" :data-name="s.name"><i class="fa-solid fa-triangle-exclamation me-1"></i><span class="font-monospace">{{ s.name }}</span>: {{ $t('outputs.render.incomplete', { ranges: missingText(s.missing) }) }}</div>
      <label class="d-flex align-items-center gap-2 small mb-1"><input :checked="skipExisting" type="checkbox" class="form-check-input mt-0" :disabled="running" data-testid="pod-outputs-render-skip-existing" @change="emit('update:skipExisting', $event.target.checked)" />{{ $t('outputs.render.skipExisting') }}</label>
      <div v-if="localWhilePreviews" class="small text-warning mb-2" data-testid="pod-outputs-render-local-hint"><i class="fa-solid fa-triangle-exclamation me-1"></i>{{ $t('outputs.render.localWhilePreviews') }}</div>
      <label v-if="summary.incomplete && !isReview" class="d-flex align-items-center gap-2 small mb-2"><input v-model="prefs.allowPartial" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-allow-partial" />{{ $t('outputs.render.allowPartial') }}</label>
      <div v-for="(w, i) in warnings" :key="i" class="alert alert-warning py-1 px-2 small mb-2" data-testid="pod-outputs-render-warning">{{ w }}</div>
      <label v-if="prefs.where !== 'local'" class="d-flex align-items-center gap-2 small mb-2"><input v-model="prefs.pull" type="checkbox" class="form-check-input mt-0" data-testid="pod-outputs-render-pull" />{{ $t('outputs.render.pull') }}</label>
      <div v-if="!publishStore.old && publishStore.loaded" class="small mb-2" data-testid="pod-outputs-render-publish">
        <div v-for="id in ['s3', 'slack']" :key="id" class="mb-1">
          <label class="d-flex align-items-center gap-2"><input v-model="pub[id]" type="checkbox" class="form-check-input mt-0" :disabled="!pubReady(id).ok" :data-testid="`pod-outputs-render-publish-${id}`" />{{ $t(id === 's3' ? 'publish.render.s3' : 'publish.render.slack') }}</label>
          <div v-if="!pubReady(id).ok" class="text-warning ms-4" :data-testid="`pod-outputs-render-publish-${id}-reason`">{{ pubReady(id).reason }} <BButton variant="link" size="sm" class="p-0" :data-testid="`pod-outputs-render-publish-${id}-settings`" @click="id === 'slack' ? openPublishConnect() : openPublishSettings()">{{ $t(id === 'slack' ? 'publish.render.connect' : 'publish.render.settings') }}</BButton></div>
        </div>
        <div v-if="pub.s3" class="text-body-secondary font-monospace" data-testid="pod-outputs-render-publish-plan">{{ $t('publish.render.willPublish', { dest: `${s3Dest(publishStore.settings.s3.bucket, publishStore.settings.s3.prefix)}${isReview ? 'deliver/' : '.proxies/'}…` }) }}</div>
        <div v-if="publishOn && !isReview" class="mt-1"><label class="mb-0" for="pod-render-approved">{{ $t('outputs.render.approvedBy') }}</label><BFormInput id="pod-render-approved" v-model.trim="approvedBy" size="sm" data-testid="pod-outputs-render-approved-by" /><div v-if="!approvedBy.trim()" class="text-warning" data-testid="pod-outputs-render-publish-approved-hint">{{ $t('publish.render.approvedHint') }}</div></div>
      </div>
      <div v-if="startError && !problem" class="text-danger small mb-2" data-testid="pod-outputs-render-error">{{ startError }}</div>
      <div class="d-flex gap-2 align-items-center mb-2">
        <BButton variant="primary" size="sm" :disabled="!canStart" :title="$t('outputs.render.startTitle')" data-testid="pod-outputs-render-start" @click="start"><BSpinner v-if="starting" small class="me-1" /><i v-else class="fa-solid fa-film me-1"></i>{{ $t('outputs.render.start') }}</BButton>
        <BButton v-if="running" variant="outline-warning" size="sm" data-testid="pod-outputs-render-stop" @click="stop"><i class="fa-solid fa-stop me-1"></i>{{ $t('outputs.render.stop') }}</BButton>
      </div>
      <div v-if="job" class="mb-2" data-testid="pod-outputs-render-job" :data-state="job.state" :data-job="job.job_id">
        <BProgress :value="percent" :max="100" :animated="running" :striped="running" height="0.6rem" :data-percent="percent" data-testid="pod-outputs-render-progress" />
        <div class="small mt-1" data-testid="pod-outputs-render-status">{{ statusText }}</div>
        <div v-if="eta" class="small text-body-secondary" data-testid="pod-outputs-render-eta">{{ $t('outputs.render.eta', { time: eta }) }}</div>
        <div v-if="job.state === 'pulling'" class="small text-info" data-testid="pod-outputs-render-syncing"><BSpinner small class="me-2 flex-shrink-0" />{{ $t('outputs.render.syncing') }}<template v-if="job.pulled_files"> · {{ $t('outputs.render.syncingDetail', { files: job.pulled_files, size: sizeText(job.pulled_bytes || 0) }) }}</template></div>
        <ul v-if="reviewDone.length && reviewDone[0].files.length" class="list-unstyled small mb-1" data-testid="pod-outputs-render-review-files"><li v-for="f in reviewDone[0].files" :key="f.name" class="font-monospace" :data-codec="f.codec">{{ f.name }}<span v-if="!/\.mp4$/i.test(f.name)" class="text-body-secondary font-sans-serif"> · {{ $t('outputs.render.notPlayable') }}</span></li></ul>
        <div v-if="reviewDone.length && reviewDone[0].codecs.length" class="small text-body-secondary" data-testid="pod-outputs-render-review-codecs">{{ $t('outputs.render.codecsLine', { codecs: reviewDone[0].codecs.join(', ') }) }}</div>
        <div v-if="job.publish" class="small d-flex align-items-center gap-2" data-testid="pod-outputs-render-publish-state" :data-state="job.publish.state">{{ $t('publish.render.summary', { state: job.publish.state }) }}<BButton variant="link" size="sm" class="p-0" data-testid="pod-outputs-render-publish-open" @click="$emit('publish')">{{ $t('publish.render.open') }}</BButton></div>
        <div v-if="finishedJob" class="small" :class="job.state === 'failed' ? 'text-danger' : 'text-success'" data-testid="pod-outputs-render-summary">{{ summaryText }}</div>
      </div>
      <div class="d-flex gap-2 align-items-center flex-wrap pt-2 border-top">
        <BButton variant="outline-danger" size="sm" data-testid="pod-outputs-render-clear" @click="clear"><i class="fa-regular fa-trash-can me-1"></i>{{ $t('outputs.render.clear') }}</BButton>
        <span v-if="cleared" class="small text-body-secondary" data-testid="pod-outputs-render-cleared">{{ cleared }}</span>
        <span class="small text-body-secondary" data-testid="pod-outputs-render-clear-note">{{ $t('outputs.render.clearNote') }}</span>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * RenderSequences: the "Render sequences" option of the Previews window (docs/ADR-048). The sequences are the DPX tiles the Outputs window lists; the core renders each into an H.264 proxy ON THE POD (then synced here) or ON THIS PC (ffmpeg, from the synced frames).
 * Size, frame rate, where, sync; a plan line from the core; Start; progress of the store's job (polled there, so closing the window loses nothing); Stop; a summary; Clear for the copies on this PC. All wording is in outputs.render.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRendersStore } from '../stores/renders'
import { usePreviewsStore } from '../stores/previews'
import { useConfirmStore } from '../stores/confirm'
import { errorText } from '../stores/toast'
import { t } from '../i18n'
import { sizeText } from '../utils/outputs'
import { rendersAPI } from '../api/renders'
import FfmpegAlert from './FfmpegAlert.vue'
import { usePublishStore } from '../stores/publish'
import { useUiStore } from '../stores/ui'
import { s3Dest, targetState, timecodeProblem } from '../utils/publish'
import { useEdlStore, shotOfClip } from '../stores/edl'
import { edlAPI } from '../api/edl'
import SeqFlags from './SeqFlags.vue'
import SequenceThumb from './SequenceThumb.vue'
import ClipColourModal from './ClipColourModal.vue'
import DpxViewerModal from './DpxViewerModal.vue'
import SelectionSummaryModal from './SelectionSummaryModal.vue'
import { fmtEta } from '../utils/syncs'
import { sourceGroups, dimsText, scaledHeight, colourGroups, colourLine, conversions, noTransform, refusals, colourText, WIDTHS, FPS_CHOICES, WHERE_CHOICES, KINDS, clipProblem, outputNames, REVIEW_WIDTH, DEFAULT_WIDTH, APPROVED_KEY, reviewFolder, versionName, fpsFor, missingText, adapterMap, whereState, ffmpegProblem, planSummary, jobPercent, currentSequence, isActive } from '../utils/renders'

const props = defineProps({ thumbs: { type: Object, default: () => ({}) }, scope: { type: String, default: '' }, volumeName: { type: String, default: '' }, skipExisting: { type: Boolean, default: true }, scopeLabel: { type: String, default: '' }, pod: { type: Object, required: true }, items: { type: Array, default: () => [] }, skipped: { type: Number, default: 0 } })
const renders = useRendersStore(), confirm = useConfirmStore()
const previewsJob = usePreviewsStore()
/** A render on this PC competes with the preview decoding for the same CPU, memory and disk; one on the pod does not (Lucas, 2026-11-19: 'that's if local'). A hint, never a block. */
const localWhilePreviews = computed(() => previewsJob.running && (prefs.where === 'local' || !!plan.value?.sequences?.some((q) => q.where === 'local')))
const prefs = renders.prefs
const isReview = computed(() => prefs.kind === 'review')
// Publishing when done (never remembered: a send is always per run)
const publishStore = usePublishStore(), uiStore = useUiStore()
const pub = reactive({ s3: false, slack: false })
const pubReady = (id) => targetState(publishStore.settings, id)
const publishOn = computed(() => pub.s3 || pub.slack)
// Publishing no longer needs Sync: a render that stayed on the pod is published from the volume, streamed through this PC (core renders.publishSeq).
watch(() => pub.s3, (v) => { if (!v) pub.slack = false })   // Slack announces an upload: it needs S3
const openPublishSettings = () => { uiStore.configFocus = 'publishing'; uiStore.configOpen = true }
const openPublishConnect = () => { uiStore.connectTab = 'slack'; uiStore.connectOpen = true }
const v3 = (n) => versionName(n).slice(1)
const approvedBy = ref((() => { try { return localStorage.getItem(APPROVED_KEY) || '' } catch { return '' } })())   // remembered like the other approvals
watch(approvedBy, (v) => { try { localStorage.setItem(APPROVED_KEY, v.trim()) } catch { /* storage blocked: it lasts this window */ } })
watch(() => prefs.kind, (k) => { prefs.width = k === 'review' ? REVIEW_WIDTH : DEFAULT_WIDTH })   // both start at the source size (IMAX 4K)
const codecs = computed(() => [...(prefs.h264 ? ['h264'] : []), ...(prefs.prores ? ['prores422hq'] : [])])
const src0 = computed(() => plan.value?.sequences?.find((s) => s.source?.width)?.source)
const widthOptions = computed(() => [{ v: 'source', label: src0.value ? t('outputs.render.sourceResSize', { w: src0.value.width, h: src0.value.height }) : t('outputs.render.sourceRes') }, ...[...WIDTHS].reverse().map((w) => ({ v: w.px, label: t(`outputs.render.${w.id}`) }))])
const outputGb = computed(() => { const n = (plan.value?.sequences || []).reduce((a, s) => a + (Number(s.estimate?.output_gb) || 0), 0); return n > 0 ? Math.round(n * 10) / 10 : 0 })
const eta = computed(() => { const j = job.value; return j && j.state === 'rendering' && j.rate_fps > 0 && j.frames_total > j.frames_done ? fmtEta(Math.round((j.frames_total - j.frames_done) / j.rate_fps)) : '' })
// Source size and colour, read from the headers by the core (a cheap pass over every sequence)
const srcGroups = computed(() => sourceGroups(plan.value))
const nSeq = (n) => t(n === 1 ? 'outputs.render.colourCountOne' : 'outputs.render.colourCount', { n })
const sourceLines = computed(() => srcGroups.value.map((g) => {
  const many = srcGroups.value.length > 1, w = prefs.width
  if (w === 'source' || typeof w !== 'number') return many ? `${g.width} × ${g.height}${g.bits ? ` · ${g.bits}-bit` : ''}: ${nSeq(g.count)}` : dimsText(g)
  const from = `${g.width} × ${g.height}`, to = `${w} × ${scaledHeight(g, w)}`
  return `${t('outputs.render.downscaleFrom', { from, to })}${many ? ` (${nSeq(g.count)})` : ''}`
}))
const colourGs = computed(() => colourGroups(plan.value))
const convs = computed(() => conversions(plan.value))
const refusalList = computed(() => refusals(colourGs.value))
const colourOpen = ref(prefs.kind === 'review'), colourRowsOpen = ref(false), colourFilter = ref(''), colourCopied = ref(false)
watch(isReview, (r) => { colourOpen.value = r })   // open for a Review, closed for a quick proxy
const colourRows = computed(() => (plan.value?.sequences || []).filter((s) => (s.colour || s.source) && (!colourFilter.value || s.name.toLowerCase().includes(colourFilter.value.toLowerCase()))))
async function copyColour() { try { await navigator.clipboard.writeText(colourText(plan.value)); colourCopied.value = true; setTimeout(() => (colourCopied.value = false), 2000) } catch { colourCopied.value = false } }
const estimates = computed(() => [...new Set((plan.value?.sequences || []).map((s) => s.estimate?.note).filter(Boolean))])
const settingsNote = ref('')
const plan = ref(null), planning = ref(false), starting = ref(false), startError = ref(''), startErrObj = ref(null), cleared = ref('')
/** The review rows only for sequences the core has planned as reviews (a shot and a version): while the review plan is still on its way the plan on screen is the quick proxy's, which has neither, and printed 'undefined'. */
const reviewRows = computed(() => (plan.value?.sequences || []).filter((x) => x.shot && x.next_version != null))

const clipEdits = reactive({})   // `${dir}/${name}` -> an edited clip name (outputs are named with it; the frames are never renamed)
const clipOf = (i) => clipEdits[`${i.dir}/${i.name}`] ?? i.name
// Which sequences are generated: every one unless it is unticked. The map lives outside the pages and the filter, so neither loses a tick; All and None act on what the filter shows.
const seqKey = (i) => `${i.dir}/${i.name}`
const deselected = reactive({})
const isSel = (i) => !deselected[seqKey(i)]
const chosen = computed(() => props.items.filter(isSel))
const filterText = ref(''), PAGE_SIZES = [10, 25, 50], pageSize = ref(10), page = ref(0)
const filtered = computed(() => { const q = filterText.value.trim().toLowerCase(); return q ? props.items.filter((i) => i.name.toLowerCase().includes(q) || clipOf(i).toLowerCase().includes(q)) : props.items })
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize.value)))
const pageItems = computed(() => filtered.value.slice(page.value * pageSize.value, (page.value + 1) * pageSize.value))
const pageInfo = computed(() => (filtered.value.length ? `${page.value * pageSize.value + 1}–${Math.min(filtered.value.length, (page.value + 1) * pageSize.value)} of ${filtered.value.length}` : '0'))
watch([filterText, pageSize], () => { page.value = 0 })
watch(pageCount, (n) => { if (page.value > n - 1) page.value = n - 1 })
const toggleSel = (i, on) => { if (on) delete deselected[seqKey(i)]; else deselected[seqKey(i)] = true }
const selectShown = (on) => { for (const i of filtered.value) toggleSel(i, on) }
// The Tunnel proxy preset (docs/ADR-050): H.264 1920x1080 proxies named with the clip name, tagged Rec.709, with a start timecode per sequence (the DPX header wins when it has one)
const presetSupported = computed(() => !!plan.value?.settings && plan.value.settings.preset !== undefined)
const tunnel = computed(() => presetSupported.value && prefs.preset === 'tunnel')
const tcEdits = reactive({})
const rowOf = (i) => (plan.value?.sequences || []).find((s) => s.dir === i.dir && s.name === i.name) || null
/** The start timecode starts EMPTY: after the plan it shows what the core resolved (the DPX header or the EDL), and typing overrides it. */
const tcShown = (i) => tcEdits[`${i.dir}/${i.name}`] ?? rowOf(i)?.start_timecode ?? ''
const tcSourceText = (i) => {
  const e = tcEdits[`${i.dir}/${i.name}`]
  if (e) return t('edl.tcField')
  const r = rowOf(i), src = r?.timecode_source, tc = r?.start_timecode || ''
  return src === 'EDL' ? t('edl.tcFromEdl', { tc }) : src === 'DPX header' ? t('edl.tcFromHeader', { tc }) : src === 'sequence field' ? t('edl.tcField') : ''
}
const tcProblemOf = (i) => { const e = tcEdits[`${i.dir}/${i.name}`]; return e ? timecodeProblem(e) : '' }
const tcBad = computed(() => tunnel.value && chosen.value.some((i) => tcProblemOf(i)))
// The EDL decides what may be delivered: flags per sequence, a colour chosen per sequence (no default), the clip-name picker
const edl = useEdlStore()
const edlOn = computed(() => edl.loaded && !edl.old)
const edlNeeded = computed(() => tunnel.value)
onMounted(() => edl.ensure())
const COLOURS = ['linear-p3-d65', 'linear-rec709', 'p3-d65-gamma26', 'p3-d65-srgb', 'p3-d65-gamma22', 'kodak-log']
// Frames whose header says log or linear (or that the core says have no stated colour) need the colour STATED, for a Review and for the Tunnel preset: no default, remembered for the run once seen
const colourSeen = reactive({})
const needsColour = (i) => tunnel.value || !!colourSeen[`${i.dir}/${i.name}`]
const anyColourNeeded = computed(() => Object.values(colourSeen).some(Boolean))
function noteColour(p) { for (const r of p?.sequences || []) if (r.colour_source !== 'ocio-record' && ((r.flags || []).some((f) => f.code === 'colour-not-stated') || /log|linear|density/i.test(r.header_transfer || ''))) colourSeen[`${r.dir}/${r.name}`] = true }
const colourIn = reactive({}), colourAll = ref(''), edlOverride = reactive({}), cands = reactive({})
const colourOf = (i) => colourIn[`${i.dir}/${i.name}`] || ''
const effColour = (i) => colourOf(i) || colourAll.value
/** The colour the core derives when nobody states it (render.colour.mode known): shown as the select's first option, never sent as a statement. */
/** This sequence's line in the running or finished job: where it ran, its state and frames, a skip reason, an error. */
const jobSeqOf = (i) => (job.value?.sequences || []).find((q) => q.dir === i.dir && q.name === i.name) || null
/** The colour record ComfyUI-OCIO wrote next to the sequence, when the plan found a usable one (its own choice and the one for all still win). */
const ocioOf = (i) => { const r = rowOf(i); return r && r.colour_source === 'ocio-record' && r.ocio ? r.ocio : null }
const defaultColour = (i) => { const r = rowOf(i); return r && r.colour_source === 'guess' && r.colour_in ? r.colour_in : '' }
/** What colour this row will be rendered from, and why: its own choice, the one for all, the default derived from the header, the configuration, or no conversion. Always said, set or not. */
const rowColour = (i) => {
  const own = colourOf(i), all = colourAll.value, def = defaultColour(i), r = rowOf(i)
  if (own) return { name: colourName(own), how: t('outputs.render.rowColourOwn'), src: 'own' }
  if (all) return { name: colourName(all), how: t('outputs.render.rowColourAll'), src: 'all' }
  if (ocioOf(i)) return { name: colourName(r.colour_in), how: '', src: 'ocio', text: t('outputs.render.rowColourOcio', { label: ocioOf(i).label }) }   // stated by the writer, not guessed
  if (def) return { name: colourName(def), how: t('outputs.render.rowColourDefault'), src: 'default' }
  if (r?.colour_in && r.colour_source === 'configuration') return { name: colourName(r.colour_in), how: t('outputs.render.rowColourConfig'), src: 'configuration' }
  if (needsColour(i)) return { name: t('outputs.render.rowColourNone'), how: t('outputs.render.rowColourSkipped'), src: 'none' }
  const what = r?.colour?.conversion
  return r?.colour ? { name: what ? String(what).replace(/^none:\s*/, '') : t('outputs.render.rowColourPlain'), how: '', src: 'plain' } : null
}
// The colour id a row will really use, in the same order as rowColour: its own, the global override, the OCIO record, the default, the configured one
const rowColourId = (i) => { const r = rowOf(i); return colourOf(i) || colourAll.value || (ocioOf(i) ? r.colour_in : '') || defaultColour(i) || (r?.colour_in && r.colour_source === 'configuration' ? r.colour_in : '') || '' }
// When every selected sequence ends up with the same colour, the global select shows it by default (nothing is stated by a person: the source of each row stays what it was)
const uniformColour = computed(() => { const ids = chosen.value.map(rowColourId); return ids.length && ids.every((x) => x && x === ids[0]) ? ids[0] : '' })
const colourShown = computed(() => colourAll.value || uniformColour.value || '')
/** The global override replaces the colour of every sequence, including ones set one by one; "Per sequence" goes back to each sequence's record or default. */
function setColourAll(v) { if (v === colourShown.value) return; colourAll.value = v; if (v) for (const k of Object.keys(colourIn)) delete colourIn[k] }
const colourButtonLabel = (i) => { const c = rowColour(i); return c && ['own', 'all', 'ocio', 'default', 'configuration'].includes(c.src) ? c.name : t('outputs.render.colourButtonNone') }
const framesFor = ref(null)   // the seqKey of the sequence whose frames are open in the viewer (the source DPX frames the render will use)
const framesTile = computed(() => (framesFor.value ? props.thumbs[framesFor.value] || null : null))
const framesItem = computed(() => props.items.find((i) => seqKey(i) === framesFor.value) || null)
const summaryOpen = ref(false)
const summaryRows = computed(() => chosen.value.map((i) => ({ key: seqKey(i), name: i.name, clip: clipOf(i), colour: rowColour(i), edl: edlOn.value ? edl.matchOf(clipOf(i)) : '', outputs: rowOutputs(i) })))
const colourFor = ref(null)   // the seqKey of the row whose colour window is open
const colourItem = computed(() => props.items.find((i) => seqKey(i) === colourFor.value) || null)
const colourEmptyLabel = computed(() => { const i = colourItem.value; if (!i) return ''; if (colourAll.value) return t('edl.colourAllIs', { name: colourName(colourAll.value) }); if (ocioOf(i)) return t('outputs.render.rowColourOcio', { label: ocioOf(i).label }); const d = defaultColour(i); return d ? t('edl.colourDefault', { name: colourName(d) }) : t('edl.colourChoose') })
const anyColourMissing = computed(() => chosen.value.some((i) => needsColour(i) && !effColour(i) && !defaultColour(i) && !ocioOf(i)))
const rowFacts = (r) => { const c = r.colour, sz = c ? `${c.width} × ${c.height}` : r.source ? `${r.source.width} × ${r.source.height}` : '', bits = c?.bits ?? r.source?.bits; return [sz, c?.transfer_name, bits ? `${bits}-bit` : ''].filter(Boolean).join(' · ') }
const rowOutputs = (i) => { const r = rowOf(i); return r ? outputNames(r, { kind: prefs.kind, codecs: codecs.value, width: prefs.width }) : [] }
const colourName = (c) => (c === 'kodak-log' ? 'Kodak log' : t(`edl.colours.${c}`, c))
const blockedOf = (r) => (r?.flags || []).some((f) => f.level === 'block' && !(f.code === 'frames-differ-from-edl' && edlOverride[r.name]))
const rowBlocked = (i) => blockedOf(rowOf(i))
const blockedCount = computed(() => (plan.value?.sequences || []).filter(blockedOf).length)
const allBlocked = computed(() => !!plan.value?.sequences?.length && blockedCount.value === plan.value.sequences.length)
const overrideBody = () => { const o = Object.fromEntries(Object.entries(edlOverride).filter(([, v]) => v)); return Object.keys(o).length ? { edl_override: o } : {} }
async function loadCands(p) {
  for (const r of p?.sequences || []) {
    if (!(r.flags || []).some((f) => f.code === 'ambiguous-edl-element') || cands[r.name]) continue
    cands[r.name] = r.candidates || []
    if (!cands[r.name].length) { try { const l = await edlAPI.lookup({ clip: r.name }); cands[r.name] = (l.candidates || []).map((c) => (typeof c === 'string' ? c : c.clip)) } catch { cands[r.name] = [] } }
  }
}
watch(tunnel, (on) => { if (on) { prefs.kind = 'proxy'; nextTick(() => { prefs.width = 1920 }) } else prefs.width = DEFAULT_WIDTH })
const clipBad = computed(() => chosen.value.some((i) => clipProblem(clipOf(i))) || tcBad.value)
/** Sent with the sequence only when it differs from the sequence's own name. */
const sequences = computed(() => chosen.value.map((i) => ({ ...i, fps: fpsFor(prefs.fps, i.name), ...(clipOf(i) !== i.name ? { clip_name: clipOf(i) } : {}), ...(tunnel.value && tcEdits[`${i.dir}/${i.name}`] ? { start_timecode: tcEdits[`${i.dir}/${i.name}`] } : {}), ...((tunnel.value || colourSeen[`${i.dir}/${i.name}`]) && effColour(i) ? { colour_in: effColour(i) } : {}) })))
const outputList = computed(() => (plan.value?.sequences || []).flatMap((s) => outputNames(s, { kind: prefs.kind, codecs: codecs.value, width: prefs.width })))
const podArg = () => (prefs.where === 'local' ? {} : { pod_id: props.pod.id })
let planSeq = 0, timer = null
async function replan() {
  const my = ++planSeq
  if (!chosen.value.length) { plan.value = null; planning.value = false; return }
  planning.value = true
  try {
    const p = await rendersAPI.plan({ ...podArg(), sequences: sequences.value, width: prefs.width, where: prefs.where, kind: prefs.kind, skip_existing: props.skipExisting, ...(isReview.value ? { codecs: codecs.value } : {}), ...(tunnel.value ? { preset: 'tunnel' } : {}), ...overrideBody() })
    if (my === planSeq) { plan.value = p; if (p.settings && !seeded) seed(p); loadCands(p); noteColour(p) }
  } catch (e) { if (my === planSeq) plan.value = { old: false, pod_ok: false, reason: errorText(e), adapters: [], total_frames: 0, sequences: [] } } finally { if (my === planSeq) planning.value = false }
}
const later = () => { clearTimeout(timer); timer = setTimeout(replan, 150) }
watch(() => [props.skipExisting, prefs.preset, chosen.value.map(seqKey).join('|'), props.items.map((i) => tcEdits[`${i.dir}/${i.name}`] ?? '').join('|'), JSON.stringify(colourIn) + colourAll.value, JSON.stringify(edlOverride), prefs.kind, codecs.value.join(), props.items.map((i) => clipOf(i)).join('|'), props.items.map((i) => `${i.dir}/${i.name}:${i.first}-${i.last}:${i.fps}`).join('|'), prefs.width, prefs.fps, prefs.where, props.pod.id, props.pod.status], later)
watch(() => renders.finished, later)
onMounted(() => { replan(); renders.watch(); publishStore.loadSettings() })
onBeforeUnmount(() => { clearTimeout(timer); planSeq++ })
/** The window starts from the settings of the pod's configuration (or the default's) that the core reports with the plan; its own changes are per run and never saved. Once per opening. */
let seeded = false
async function seed(p) {
  seeded = true
  const s = p.settings, review = s.kind === 'review'
  settingsNote.value = p.settings_source === 'pod' ? 'settingsPod' : 'settingsDefault'
  prefs.kind = s.kind || 'proxy'; prefs.where = s.where || 'auto'; prefs.fps = s.fps ?? 'auto'
  // a core with the publish-when-done settings starts the three boxes from the configuration (unticked unless it says so); an older core keeps its old default of Sync ticked
  const newCore = s.publish !== undefined
  if (s.preset !== undefined) prefs.preset = s.preset === 'tunnel' ? 'tunnel' : 'none'
  prefs.pull = newCore ? s.pull === true : s.pull !== false
  pub.s3 = !!(newCore && s.publish?.s3); pub.slack = !!(newCore && s.publish?.slack && pub.s3)
  if (typeof s.skip_existing === 'boolean') emit('update:skipExisting', s.skip_existing)   // the Skip existing the configuration starts from (previews and render share it)
  prefs.h264 = (s.codecs || ['h264']).includes('h264'); prefs.prores = (s.codecs || []).includes('prores422hq')
  await nextTick()   // the kind watcher sets the width first; the configured width wins
  prefs.width = (review ? s.review_width : s.proxy_width) ?? 'source'
}
function checkAgain() { startErrObj.value = null; startError.value = ''; return replan() }

const adapters = computed(() => adapterMap(plan.value?.adapters?.length ? plan.value.adapters : [{ id: 'pod', ok: !!plan.value?.pod_ok, reason: plan.value?.reason }]))
const ws = computed(() => (plan.value ? whereState(prefs.where, plan.value.adapters?.length ? plan.value.adapters : [{ id: 'pod', ok: !!plan.value.pod_ok, reason: plan.value.reason }, { id: 'local', ok: false, reason: '' }]) : { ok: false, why: [] }))
const whereOk = (w) => (plan.value ? whereState(w, plan.value.adapters || []).ok : true)
const whereLabel = (w) => `${t(w === 'auto' ? 'outputs.render.whereAuto' : w === 'pod' ? 'outputs.render.wherePod' : 'outputs.render.whereLocal')}${plan.value && !whereOk(w) ? ` (${t('outputs.render.adapterNo')})` : ''}`
const adapterText = (id) => (adapters.value[id].ok ? t('outputs.render.adapterOk') : adapters.value[id].reason || (id === 'pod' ? t('outputs.render.podNeeded') : t('outputs.render.adapterNo')))
const problem = computed(() => ffmpegProblem(plan.value?.adapters, prefs.where, startErrObj.value))
const warnings = computed(() => {
  if (!plan.value || plan.value.old || ws.value.ok || !props.items.length) return []
  const out = ws.value.why.filter((w) => w && !(problem.value && w === problem.value.reason))
  if (!out.length && !problem.value) out.push(plan.value.reason || t('outputs.render.podNeeded'))
  return out
})
const summary = computed(() => planSummary(plan.value))
/** How many of the plan's sequences already exist (the core's `skip` reason); with Skip existing ticked and none left to do, Start waits. */
const toSkip = computed(() => plan.value?.totals?.skipped ?? (plan.value?.sequences || []).filter((s) => s.skip).length)
const allSkipped = computed(() => props.skipExisting && !!plan.value && props.items.length > 0 && !plan.value.old && (plan.value.sequences || []).length > 0 && (plan.value.totals ? plan.value.totals.to_render === 0 : (plan.value.sequences || []).every((s) => s.skip)))
const incompleteList = computed(() => (plan.value?.sequences || []).filter((s) => s.complete === false || (s.complete === undefined && (Array.isArray(s.gaps) ? s.gaps.length : Number(s.gaps)) > 0)).slice(0, 20))
const one = (n, k) => t(`outputs.render.${k}${n === 1 ? 'One' : 'Many'}`, { n })
const planText = computed(() => {
  const s = summary.value, parts = [one(s.sequences, 'sequence'), one(s.frames, 'frame')]
  if (s.pod && s.local) parts.push(t('outputs.render.usingPod', { n: s.pod }), t('outputs.render.usingLocal', { n: s.local }))
  else parts.push(t(s.local ? 'outputs.render.renderedOnLocal' : 'outputs.render.renderedOnPod'))
  if (plan.value?.totals) parts.push(t(props.skipExisting ? 'outputs.render.toRenderSkip' : 'outputs.render.toRenderAgain', { n: props.skipExisting ? plan.value.totals.to_render : s.sequences, skipped: plan.value.totals.skipped }))
  else if (s.rendered) parts.push(t('outputs.render.alreadyRendered', { n: s.rendered }))
  if (s.incomplete) parts.push(t('outputs.render.completeCounts', { complete: s.complete, incomplete: s.incomplete }))
  return parts.join(' · ')
})

/** The job this window shows: one that is running, or the one started from this window. A finished job from earlier is history (Queue > Generations), not part of this form. */
const shownJobId = ref('')
const job = computed(() => { const j = renders.jobForPod(props.pod.id); return j && (isActive(j) || j.job_id === shownJobId.value) ? j : null })
const running = computed(() => isActive(job.value))
const finishedJob = computed(() => !!job.value && ['done', 'failed', 'cancelled'].includes(job.value.state))
const percent = computed(() => jobPercent(job.value))
const statusText = computed(() => {
  const j = job.value
  if (!j) return ''
  if (j.state === 'queued') return t('outputs.render.queued')
  const base = t('outputs.render.progress', { i: currentSequence(j), n: (j.sequences || []).length, done: j.frames_done || 0, total: j.frames_total || 0 })
  return j.rate_fps ? `${base} · ${t('outputs.render.progressRate', { fps: Math.round(j.rate_fps) })}` : base
})
const summaryText = computed(() => {
  const j = job.value
  if (j.state === 'cancelled') return j.summary || t('outputs.render.jobCancelled')
  if (j.state === 'failed') return j.error || j.summary || t('outputs.render.jobFailed')
  return j.summary || t('outputs.render.summaryDefault', { n: (j.sequences || []).length })
})
/** A finished review job: each shot's version and folder, and a Play that opens the viewer on it. */
const reviewDone = computed(() => {
  const j = job.value
  if (!j || j.state !== 'done' || (j.kind || '') !== 'review') return []
  return (j.sequences || []).filter((x) => ['rendered', 'pulled', 'done'].includes(x.state)).map((x) => { const shot = x.shot || j.shot || '', version = x.version ?? j.version ?? 0; return { s: x, shot, version, folder: reviewFolder(shot, version), files: x.files || j.files || [], codecs: j.codecs || [] } })
})
const reviewDoneOf = (i) => reviewDone.value.find((r) => r.s.dir === i.dir && r.s.name === i.name) || null
const emit = defineEmits(['play', 'publish', 'update:skipExisting'])
function playReview(r) { renders.play = { dir: r.s.dir, name: r.s.name, review: true }; emit('play') }

const canStart = computed(() => !!plan.value && !allBlocked.value && !plan.value.old && chosen.value.length > 0 && ws.value.ok && !clipBad.value && !allSkipped.value && !(isReview.value && refusalList.value.length) && (!summary.value.incomplete || (prefs.allowPartial && !isReview.value)) && (!isReview.value || (!!approvedBy.value.trim() && codecs.value.length > 0)) && (!publishOn.value || !!approvedBy.value.trim()) && !running.value && !starting.value)
async function start() {
  starting.value = true; startError.value = ''; startErrObj.value = null
  const fixed = prefs.fps !== 'auto'
  try {
    const started = await renders.start({ ...podArg(), sequences: sequences.value, width: prefs.width, where: prefs.where, kind: prefs.kind, skip_existing: props.skipExisting, ...(tunnel.value ? { preset: 'tunnel' } : {}), ...overrideBody(), ...(isReview.value ? { approved_by: approvedBy.value.trim(), codecs: codecs.value } : publishOn.value ? { approved_by: approvedBy.value.trim() } : {}), ...(publishOn.value ? { publish: { targets: [...(pub.s3 ? ['s3'] : []), ...(pub.slack ? ['slack'] : [])] } } : {}), ...(fixed ? { fps: Number(prefs.fps) } : {}), ...(prefs.where !== 'local' ? { pull: !!prefs.pull } : {}), ...(summary.value.incomplete && prefs.allowPartial && !isReview.value ? { allow_partial: true } : {}) })
    if (started?.job_id) shownJobId.value = started.job_id
    if (started?.job_id && props.scopeLabel) renders.scopes[started.job_id] = props.scopeLabel   // the job keeps the scope it started with
  } catch (e) { startErrObj.value = e; startError.value = errorText(e) } finally { starting.value = false }
}
const stop = () => job.value && renders.cancel(job.value.job_id).catch((e) => { startError.value = errorText(e) })
async function clear() {
  if (!(await confirm.ask(t('outputs.render.clearConfirm'), { title: t('outputs.render.clear'), okLabel: t('outputs.render.clearOk') }))) return
  try {
    const r = await renders.clearLocal()
    cleared.value = r.removed ? t('outputs.render.cleared', { n: r.removed, size: sizeText(r.bytes) }) : t('outputs.render.clearedNone')
  } catch (e) { cleared.value = errorText(e) }
}
</script>

<style scoped>
.dot { font-size: 0.5rem; }
.rows { max-height: 12rem; overflow: auto; }
</style>
