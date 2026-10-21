<template>
  <BModal :model-value="ui.connectOpen" :title="$t('connect.title')" size="lg" lazy ok-only :ok-title="$t('connect.done')" ok-variant="outline-light" data-testid="connect-modal" @update:model-value="ui.connectOpen = $event">
    <p class="text-body-secondary small">{{ $t('connect.intro') }}</p>
    <BTabs lazy content-class="pt-3" @activate-tab="(i) => (ui.connectTab = TABS[i] || 'accounts')">
      <BTab :title="$t('connect.accounts')" :active="ui.connectTab === 'accounts'" data-testid="connect-tab-accounts"><GitAccountsPane :active="ui.connectOpen && ui.connectTab === 'accounts'" /></BTab>
      <BTab :title="$t('connect.repositories')" :active="ui.connectTab === 'repositories'" data-testid="connect-tab-repositories"><RepositoriesPane :active="ui.connectOpen && ui.connectTab === 'repositories'" /></BTab>
      <BTab :title="$t('connect.mcp')" :active="ui.connectTab === 'mcp'" data-testid="connect-tab-mcp"><McpPane :active="ui.connectOpen && ui.connectTab === 'mcp'" /></BTab>
    </BTabs>
  </BModal>
</template>

<script setup>
/**
 * ConnectModal — the third-party things to connect, in one place: Accounts (GitHub / GitLab OAuth),
 * Repositories (attached to the project) and MCP (the two endpoints, with a setup per client).
 * `ui.connectOpen` opens it on `ui.connectTab`; `ui.accountsOpen` / `ui.repositoriesOpen` are the
 * same flags seen from older callers.
 */
import { useUiStore } from '../stores/ui'
import GitAccountsPane from './GitAccountsPane.vue'
import RepositoriesPane from './RepositoriesPane.vue'
import McpPane from './McpPane.vue'

const ui = useUiStore()
const TABS = ['accounts', 'repositories', 'mcp']
</script>
