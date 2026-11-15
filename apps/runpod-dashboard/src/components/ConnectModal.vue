<template>
  <BModal :model-value="ui.connectOpen" :title="$t('connect.title')" size="lg" lazy ok-only :ok-title="$t('connect.done')" ok-variant="outline-light" data-testid="connect-modal" @update:model-value="ui.connectOpen = $event">
    <p class="text-body-secondary small">{{ $t('connect.intro') }}</p>
    <BTabs lazy content-class="pt-3" @activate-tab="(i) => (ui.connectTab = TABS[i] || 'mcp')">
      <BTab :title="$t('connect.mcp')" :active="ui.connectTab === 'mcp'" data-testid="connect-tab-mcp"><McpPane :active="ui.connectOpen && ui.connectTab === 'mcp'" /></BTab>
      <BTab :title="$t('connect.repositories')" :active="ui.connectTab === 'repositories'" data-testid="connect-tab-repositories">
        <h6 class="mb-2" data-testid="connect-accounts-heading">{{ $t('connect.accounts') }}</h6>
        <GitAccountsPane :active="ui.connectOpen && ui.connectTab === 'repositories'" />
        <hr class="my-3" />
        <h6 class="mb-2" data-testid="connect-repositories-heading">{{ $t('connect.repositories') }}</h6>
        <RepositoriesPane :active="ui.connectOpen && ui.connectTab === 'repositories'" />
      </BTab>
    </BTabs>
  </BModal>
</template>

<script setup>
/**
 * ConnectModal — the third-party things to connect, in one place: MCP first (the two endpoints, with a setup per client, and the shell guard),
 * then Repositories, which holds the Git accounts (GitHub / GitLab OAuth) on top and the repositories attached to the project below.
 * `ui.connectOpen` opens it on `ui.connectTab`; `ui.accountsOpen` / `ui.repositoriesOpen` are the same flag (the Repositories tab) seen from older callers.
 */
import { useUiStore } from '../stores/ui'
import GitAccountsPane from './GitAccountsPane.vue'
import RepositoriesPane from './RepositoriesPane.vue'
import McpPane from './McpPane.vue'

const ui = useUiStore()
const TABS = ['mcp', 'repositories']
</script>
