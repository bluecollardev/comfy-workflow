import { test, expect, modal } from './fixtures'
import { t } from './i18n'

// Connect › MCP › Remote servers (docs/ADR-019): BH's console as an MCP server this app uses.
const openMcp = async (page) => {
  await page.getByTestId('open-connect').click()
  const dialog = modal(page, t('connect.title'))
  await dialog.getByRole('tab', { name: t('connect.mcp') }).click()
  await expect(dialog.getByTestId('connect-mcp')).toBeVisible()
  return dialog
}

test.describe('Connect › MCP › Remote servers', () => {
  test('no key: says so; a saved key is shown by its last four characters only and Check lists the tools and who it is', async ({ page }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const remote = dialog.getByTestId('mcp-remote')
    await expect(remote.getByTestId('remote-url')).toContainText('panama-console.beinghuman.studio/api/mcp')
    await expect(remote.getByTestId('remote-key-state')).toContainText(t('remoteMcp.keyUnset'))
    await remote.getByTestId('remote-key-input').fill('console-key-abcd1234')
    await remote.getByTestId('remote-key-save').click()
    await expect(remote.getByTestId('remote-key-state')).toContainText('••••1234')
    await expect(remote.getByTestId('remote-key-state')).not.toContainText('console-key')
    await expect(remote.getByTestId('remote-result')).toHaveAttribute('data-ok', 'true')
    await expect(remote.getByTestId('remote-who')).toContainText('Lucas')
    await expect(remote.getByTestId('remote-tools')).toContainText('list_shots')
    await expect(remote.getByTestId('remote-no-exports')).toBeVisible()
    await expect(remote.getByTestId('remote-key-input')).toHaveValue('')
  })

  test('a refused key shows the reason, not just a failure; removing the key puts the unset line back', async ({ page }) => {
    await page.goto('/')
    const dialog = await openMcp(page)
    const remote = dialog.getByTestId('mcp-remote')
    await remote.getByTestId('remote-key-input').fill('bad-key-0000')
    await remote.getByTestId('remote-key-save').click()
    await expect(remote.getByTestId('remote-result')).toHaveAttribute('data-ok', 'false')
    await expect(remote.getByTestId('remote-result-error')).toContainText(t('remoteMcp.hint.bad-key'))
    await remote.getByTestId('remote-key-remove').click()
    await expect(remote.getByTestId('remote-key-state')).toContainText(t('remoteMcp.keyUnset'))
  })
})
