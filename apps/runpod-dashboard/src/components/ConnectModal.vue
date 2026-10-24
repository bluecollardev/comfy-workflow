<template>
  <BModal :model-value="ui.connectOpen" :title="$t('connect.title')" size="lg" lazy ok-only :ok-title="$t('connect.done')" ok-variant="outline-light" data-testid="connect-modal" @show="ui.connectShown++" @update:model-value="ui.connectOpen = $event">
    <p class="text-body-secondary small">{{ $t('connect.intro') }}</p>
    <BTabs lazy content-class="pt-3" @activate-tab="(i) => (ui.connectTab = TABS[i] || 'accounts')">
      <BTab :title="$t('connect.accounts')" :active="ui.connectTab === 'accounts'" data-testid="connect-tab-accounts"><GitAccountsPane :active="ui.connectOpen && ui.connectTab === 'accounts'" /></BTab>
      <BTab :title="$t('connect.repositories')" :active="ui.connectTab === 'repositories'" data-testid="connect-tab-repositories"><RepositoriesPane :active="ui.connectOpen && ui.connectTab === 'repositories'" /></BTab>
      <BTab :title="$t('connect.mcp')" :active="ui.connectTab === 'mcp'" data-testid="connect-tab-mcp"><McpPane :active="ui.connectOpen && ui.connectTab === 'mcp'" /></BTab>
      <BTab :title="$t('connect.import')" :active="ui.connectTab === 'import'" data-testid="connect-tab-import"><ImportPane :active="ui.connectOpen && ui.connectTab === 'import'" /></BTab>
    </BTabs>
  </BModal>
</template>

<script setup>
/**
 * ConnectModal — the third-party things to connect, in one place: Accounts (GitHub / GitLab OAuth),
 * Repositories (attached to the project), MCP (the two endpoints, with a setup per client) and Import (a package folder
 * into ComfyUI-Shared through an adapter, docs/ADR-008).
 * `ui.connectOpen` opens it on `ui.connectTab`; `ui.accountsOpen` / `ui.repositoriesOpen` are the
 * same flags seen from older callers.
 */
import { useUiStore } from '../stores/ui'
import GitAccountsPane from './GitAccountsPane.vue'
import RepositoriesPane from './RepositoriesPane.vue'
import McpPane from './McpPane.vue'
import ImportPane from './ImportPane.vue'

const ui = useUiStore()
const TABS = ['accounts', 'repositories', 'mcp', 'import']
</script>
