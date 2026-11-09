// Which MCP tool answers each of the app's calls (docs/ADR-028: anything the app can do, the MCP can do). The keys are the core's dispatch table in
// electron/core.cjs (namespace.method, what the page calls over IPC); the values are tool names, or `window: <why>` for what needs a window or the OS.
// parity.test.mjs fails when the table has a call this map lacks, or a mapped tool does not exist.
export const PARITY = {
  'mounts.get': 'get_configuration', 'mounts.put': 'set_configuration', 'mounts.preview': 'preview_configuration', 'mounts.reset': 'reset_configuration', 'mounts.env': 'get_local_env', 'mounts.dirs': 'list_dirs',
  'pods.dashboard': 'list_pods', 'pods.list': 'list_pods', 'pods.get': 'get_pod', 'pods.create': 'create_pod', 'pods.stop': 'stop_pod', 'pods.resume': 'resume_pod', 'pods.remove': 'delete_pod',
  'pods.gpus': 'list_gpus', 'pods.volume': 'get_volume_info', 'pods.datacenters': 'list_datacenters', 'pods.setIdle': 'set_idle_stop', 'pods.rename': 'rename_pod', 'pods.setRound': 'set_pod_round', 'pods.renameRound': 'rename_round', 'pods.deleteRound': 'delete_round', 'pods.rounds': 'list_pods', 'pods.credits': 'get_credits', 'pods.details': 'get_pod', 'pods.recreate': 'recreate_pod',
  'history.list': 'get_history', 'history.spend': 'get_spend_history', 'history.runs': 'get_comfy_runs', 'history.logs': 'get_comfy_logs', 'history.export': 'export_history', 'pods.config': 'get_pod_config', 'pods.setConfig': 'set_pod_config',
  'volumes.list': 'list_volumes', 'volumes.create': 'create_volume', 'volumes.resize': 'resize_volume', 'volumes.remove': 'delete_volume', 'volumes.useAsDefault': 'set_default_volume',
  'governance.summary': 'governance',
  'settings.get': 'get_settings', 'settings.set': 'set_settings', 'settings.checkAnthropic': 'check_anthropic_key',
  'git.accounts': 'git_accounts', 'git.disconnect': 'git_accounts', 'git.repos': 'git_accounts', 'git.connect': 'window: the OAuth round trip runs in a browser the person signs in to',
  'repositories.list': 'repositories', 'repositories.add': 'repositories', 'repositories.remove': 'repositories', 'repositories.search': 'repositories', 'repositories.branches': 'repositories', 'repositories.folders': 'repositories',
  'remote.status': 'remote_mcp', 'remote.check': 'remote_mcp', 'remote.setKey': 'set_settings',
  'configio.export': 'config_export', 'configio.suggestedName': 'config_export', 'configio.plan': 'config_import_plan', 'configio.apply': 'config_import_apply', 'configio.undo': 'config_undo', 'configio.backups': 'config_backups',
  'panama.status': 'panama_status', 'panama.rounds': 'panama_rounds', 'panama.size': 'panama_round_size', 'panama.files': 'panama_round_files', 'panama.stageDrop': 'panama_stage', 'panama.pull': 'panama_pull', 'panama.job': 'panama_job', 'panama.cancel': 'panama_cancel', 'panama.remove': 'panama_remove',
  'panama.podRounds': 'panama_rounds', 'panama.podPlan': 'panama_pod_plan', 'panama.podPull': 'panama_pull', 'panama.podJob': 'panama_job', 'panama.podCancel': 'panama_cancel', 'panama.podRemove': 'panama_remove', 'panama.podPlace': 'panama_place', 'queue.plan': 'plan_round_import', 'queue.importMany': 'import_rounds', 'queue.import': 'import_round', 'queue.list': 'queue_list', 'queue.cancelTask': 'queue_task', 'queue.cancelImport': 'queue_task', 'queue.retryTask': 'queue_task', 'queue.setLimits': 'queue_task', 'runflows.list': 'list_pod_workflows', 'runflows.run': 'run_pod_workflows', 'runflows.job': 'run_workflows_job', 'runflows.cancel': 'run_workflows_job',
  'imports.list': 'adapters_list', 'imports.detect': 'import_detect', 'imports.plan': 'import_plan', 'imports.apply': 'import_apply', 'imports.source': 'adapter_manage', 'imports.save': 'adapter_save', 'imports.spec': 'adapter_spec',
  'imports.draftPreview': 'package_summary', 'imports.draft': 'adapter_draft', 'imports.validateSource': 'adapter_manage', 'imports.describe': 'package_describe', 'imports.syncAfter': 'sync_after',
  'imports.remove': 'adapter_manage', 'imports.template': 'adapter_manage', 'imports.getPrompt': 'adapter_manage', 'imports.savePrompt': 'adapter_manage', 'imports.rename': 'adapter_manage', 'imports.history': 'adapter_manage', 'imports.duplicate': 'adapter_manage',
  'studio.step': "window: the Adapter Studio's chat loop; the MCP client is itself the model that writes the adapter (adapter_spec, package_tree, package_file, adapter_save, import_plan)",
  'studio.saveChecked': 'adapter_save', 'studio.document': 'adapter_document', 'studio.tree': 'package_tree', 'studio.file': 'package_file', 'studio.problems': 'adapter_problems', 'studio.context': 'package_summary',
  'images.env': 'image_env', 'images.dockerfile': 'image_dockerfile',
  'mcp.endpoints': 'mcp_endpoints', 'mcp.targets': 'mcp_endpoints',
  'mcp.probe': 'window: probes the servers this app itself serves, from the Connect tab',
  'mcp.serve': "window: switches the app's own MCP hosting on and off, and a client connected to it already has it",
}
// The streams the page opens outside the dispatch table: a pod's logs (get_logs), the sync job (sync, sync_status), the idle watch (set_idle_stop).
export const STREAMS = { logs: 'get_logs', sync: 'sync', 'sync-status': 'sync_status' }
