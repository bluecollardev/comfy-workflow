<template>
  <table class="table table-sm table-borderless align-middle mb-0 small">
    <thead>
      <tr class="text-body-secondary">
        <th>{{ $t('mcp.colName') }}</th><th>{{ $t('mcp.colType') }}</th><th class="text-center">{{ $t('mcp.colRequired') }}</th>
        <th>{{ $t('mcp.colDefault') }}</th><th>{{ $t('mcp.colOptions') }}</th><th>{{ $t('mcp.colDescription') }}</th>
      </tr>
    </thead>
    <tbody>
      <template v-for="p in params" :key="p.name">
        <tr data-testid="mcp-docs-param" :data-name="prefix + p.name">
          <td class="text-nowrap">
            <button v-if="p.children.length" type="button" class="btn btn-link btn-sm p-0 me-1" :title="$t('mcp.docsNested')" data-testid="mcp-docs-nested-toggle" @click="toggle(p.name)">
              <i class="fa-solid" :class="open[p.name] ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            </button>
            <code>{{ p.name }}</code>
          </td>
          <td class="text-nowrap text-body-secondary" data-col="type">{{ p.type }}</td>
          <td class="text-center" data-col="required"><i v-if="p.required" class="fa-solid fa-check text-success" :title="$t('mcp.colRequired')"></i></td>
          <td data-col="default"><code v-if="p.default !== ''">{{ p.default }}</code></td>
          <td data-col="options">
            <BBadge v-for="o in p.options" :key="o" variant="secondary" class="me-1 fw-normal">{{ o }}</BBadge>
            <span v-if="p.range" class="text-body-secondary">{{ p.range }}</span>
          </td>
          <td class="text-body-secondary" data-col="description">{{ p.description }}</td>
        </tr>
        <tr v-if="p.children.length && open[p.name]" data-testid="mcp-docs-nested">
          <td colspan="6" class="ps-4"><McpParams :params="p.children" :prefix="prefix + p.name + '.'" /></td>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<script setup>
/** McpParams: the parameter table of one tool (Name, Type, Required, Default, Options, Description); a property with `properties` gets a collapsed sub-table. */
import { ref } from 'vue'

defineOptions({ name: 'McpParams' })
defineProps({ params: { type: Array, required: true }, prefix: { type: String, default: '' } })
const open = ref({})
const toggle = (n) => { open.value = { ...open.value, [n]: !open.value[n] } }
</script>
