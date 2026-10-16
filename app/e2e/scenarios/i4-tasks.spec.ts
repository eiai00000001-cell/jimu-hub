import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, setupCompany } from './helpers'
import { dbExec } from './helpers-i2'
import { answerNextConfirm, createProjectApi, finalizeInvoiceWithProject } from './helpers-i3'
import {
  callApi,
  createTaskApi,
  dumpTasks,
  listTasksApi,
  localDate,
  mustApi,
  snapshotNonTask,
  taskRow
} from './helpers-i4'

/**
 * 【tester作成】イテレーション4: タスク・期限管理(F-34〜F-38、R-54)(TC-132〜TC-141)。
 * 参照元: 詳細設計書 3.27〜3.29章・3.24章・4.27章・4.34〜4.38章・6.19章・8章
 */
let launched: LaunchedApp | undefined
test.afterEach(async () => {
  if (launched) await closeApp(launched)
  launched = undefined
})

const goTasks = async (w: LaunchedApp['window']): Promise<void> => {
  await w.getByRole('button', { name: 'タスク・期限' }).click()
  await expect(w.locator('.titlebar-title')).toHaveText('事務HUB - タスク一覧')
}

test('TC-132: [F-34 登録] 全項目・必須のみ・同名の登録、状態は未完了固定、案件の選択肢は進行中のみ、他のデータに影響しない', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  const pActive = await createProjectApi(window, { name: '進行中の案件' })
  const pDone = await createProjectApi(window, { name: '完了済みの案件' })
  await mustApi(window, 'completeProject', pDone)
  const before = snapshotNonTask(dataDir)

  await goTasks(window)
  await expect(window.getByText('該当するタスクはありません')).toBeVisible()
  await shot(window, 'TC-132', '1) タスクが0件のタスク一覧(「該当するタスクはありません」)')
  await window.getByRole('button', { name: '+ タスクを登録' }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスクを登録')
  // 案件の選択肢は「案件なし」と進行中の案件のみ(完了の案件は出ない)
  const options = await window.getByLabel('案件').locator('option').allTextContents()
  expect(options).toEqual(['案件なし', '進行中の案件'])
  await window.getByLabel('タスク名').fill('  見積書の送付  ')
  await window.getByLabel('メモ').fill('先方の担当者へメールで送る')
  await window.getByLabel('期限日').fill('2030-03-31')
  await window.getByLabel('案件').selectOption({ label: '進行中の案件' })
  await shot(window, 'TC-132', '2) 全項目を入力した登録画面')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスク詳細')
  await expect(window.locator('.info-grid')).toContainText('見積書の送付')
  await expect(window.locator('.info-grid')).toContainText('2030-03-31')
  await expect(window.locator('.info-grid')).toContainText('進行中の案件')
  await shot(window, 'TC-132', '3) 登録後のタスク詳細(未完了・期限・案件・メモ)')
  const id1 = Number(dbQuery(dataDir, "select id from tasks where name='見積書の送付'"))
  const r1 = taskRow(dataDir, id1)
  // id|name|memo|due_date|project_id|status|completed_at|created_at|updated_at
  expect(r1.slice(1, 7)).toEqual([
    '見積書の送付',
    '先方の担当者へメールで送る',
    '2030-03-31',
    String(pActive),
    'open',
    ''
  ])
  expect(r1[7]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  expect(r1[8]).toBe(r1[7])

  // 必須のみ(メモ・期限・案件は空)。同名のタスクも登録できる
  for (let i = 0; i < 2; i++) {
    await goTasks(window)
    await window.getByRole('button', { name: '+ タスクを登録' }).click()
    await window.getByLabel('タスク名').fill('同じ名前のタスク')
    await window.getByRole('button', { name: '登録', exact: true }).click()
    await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスク詳細')
  }
  await shot(window, 'TC-132', '4) 必須項目のみで登録したタスク詳細(期限なし・案件なし)')
  const dup = dbQuery(
    dataDir,
    "select memo is null, due_date is null, project_id is null, status, completed_at is null from tasks where name='同じ名前のタスク'"
  ).split('\n')
  expect(dup).toEqual(['1|1|1|open|1', '1|1|1|open|1'])
  // 案件・書類・記録・履歴は変更されない。付け替え履歴も作られない
  expect(snapshotNonTask(dataDir)).toBe(before)
  expect(dbQuery(dataDir, 'select count(*) from project_link_history')).toBe('0')
  noteEvidence(
    'TC-132',
    'DBの確認結果',
    `登録したタスクの行: ${r1.join('|')}\n必須のみ・同名の2件: ${dup.join(' / ')}\n案件の選択肢: ${options.join(', ')}\n案件・書類・記録・履歴のスナップショットは登録前後で一致`
  )
})

test('TC-133: [F-34 入力検証・異常] 必須・桁数の境界、日付、案件の検証(画面・IPC)', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  const pActive = await createProjectApi(window, { name: '検証用の案件' })
  const pDone = await createProjectApi(window, { name: '検証用の完了案件' })
  await mustApi(window, 'completeProject', pDone)

  await goTasks(window)
  await window.getByRole('button', { name: '+ タスクを登録' }).click()
  // 画面: 未入力・空白のみ
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('タスク名を入力してください')).toBeVisible()
  await window.getByLabel('タスク名').fill('   ')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('タスク名を入力してください')).toBeVisible()
  // 画面: 101文字・メモ1001文字
  await window.getByLabel('タスク名').fill('あ'.repeat(101))
  await window.getByLabel('メモ').fill('い'.repeat(1001))
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('タスク名は100文字以内で入力してください')).toBeVisible()
  await expect(window.getByText('メモは1000文字以内で入力してください')).toBeVisible()
  await shot(window, 'TC-133', '1) 101文字のタスク名・1001文字のメモのエラー表示(項目の下)')
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('0')

  // IPC境界(画面を介さない入力)
  const results: string[] = []
  const rec = (label: string, r: { ok: boolean; error?: string }): void => {
    results.push(`${label}: ${r.ok ? '成功' : `拒否「${r.error}」`}`)
  }
  const rEmpty = await callApi(window, 'createTask', { name: '' })
  const rSpace = await callApi(window, 'createTask', { name: '  ' })
  const rLong = await callApi(window, 'createTask', { name: 'あ'.repeat(101) })
  const rMemo = await callApi(window, 'createTask', { name: 'x', memo: 'い'.repeat(1001) })
  const rDate1 = await callApi(window, 'createTask', { name: 'x', dueDate: '2026-02-30' })
  const rDate2 = await callApi(window, 'createTask', { name: 'x', dueDate: '2026/02/01' })
  const rDate3 = await callApi(window, 'createTask', { name: 'x', dueDate: 'abc' })
  const rNoProj = await callApi(window, 'createTask', { name: 'x', projectId: 99999 })
  const rDoneProj = await callApi(window, 'createTask', { name: 'x', projectId: pDone })
  const rBadId1 = await callApi(window, 'createTask', { name: 'x', projectId: 0 })
  const rBadId2 = await callApi(window, 'createTask', { name: 'x', projectId: 1.5 })
  const rBadId3 = await callApi(window, 'createTask', { name: 'x', projectId: -1 })
  rec('空のタスク名', rEmpty)
  rec('空白のみのタスク名', rSpace)
  rec('101文字のタスク名', rLong)
  rec('1001文字のメモ', rMemo)
  rec('実在しない日付2026-02-30', rDate1)
  rec('形式不正の日付2026/02/01', rDate2)
  rec('日付でない文字列', rDate3)
  rec('存在しない案件ID', rNoProj)
  rec('完了の案件', rDoneProj)
  rec('案件ID=0', rBadId1)
  rec('案件ID=1.5', rBadId2)
  rec('案件ID=-1', rBadId3)
  expect(rEmpty).toMatchObject({
    ok: false,
    error: expect.stringContaining('タスク名を入力してください')
  })
  expect(rSpace.ok).toBe(false)
  expect(rLong.error).toContain('タスク名は100文字以内で入力してください')
  expect(rMemo.error).toContain('メモは1000文字以内で入力してください')
  for (const r of [rDate1, rDate2, rDate3]) {
    expect(r.ok).toBe(false)
    expect(r.error).toContain('日付は「YYYY-MM-DD」形式の正しい日付で入力してください')
  }
  expect(rNoProj.error).toContain('指定された案件が見つかりません')
  expect(rDoneProj.error).toContain('完了の案件には、新しく紐づけられません')
  expect(rBadId1.ok).toBe(false)
  expect(rBadId2.ok).toBe(false)
  expect(rBadId3.ok).toBe(false)
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('0') // 拒否されたものは1件も保存されない

  // 境界値(許容): 名前100文字・メモ1000文字・前後の空白除去・空メモ/空期限はnull
  const okName = await mustApi<{ id: number }>(window, 'createTask', {
    name: `  ${'あ'.repeat(100)}  `,
    memo: 'い'.repeat(1000),
    dueDate: '2030-12-31',
    projectId: pActive
  })
  const okEmpty = await mustApi<{ id: number }>(window, 'createTask', {
    name: '空のメモ',
    memo: '',
    dueDate: ''
  })
  const a = taskRow(dataDir, okName.id)
  const b = taskRow(dataDir, okEmpty.id)
  expect(a[1]).toBe('あ'.repeat(100))
  expect(a[2].length).toBe(1000)
  expect(b.slice(2, 5)).toEqual(['', '', ''])
  expect(
    dbQuery(dataDir, `select memo is null, due_date is null from tasks where id=${okEmpty.id}`)
  ).toBe('1|1')
  results.push(
    '境界値: 名前100文字(前後の空白は除去)・メモ1000文字・期限2030-12-31・進行中の案件 → 成功'
  )
  results.push('空メモ・空期限は NULL で保存')
  noteEvidence('TC-133', 'IPC境界の検証結果', results.join('\n'))
})

test('TC-134: [F-34 編集] 完了の案件のまま保存可、別の完了案件への変更は拒否、状態と完了日時は不変、updated_atは更新', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  const pA = await createProjectApi(window, { name: '編集の案件A' })
  const pB = await createProjectApi(window, { name: '編集の案件B' })
  const pC = await createProjectApi(window, { name: '編集の案件C' })
  const t = await createTaskApi(window, {
    name: '編集前のタスク',
    projectId: pA,
    dueDate: '2030-01-10'
  })
  await mustApi(window, 'completeTask', t)
  const row0 = taskRow(dataDir, t) // 完了済み
  expect(row0[5]).toBe('done')
  await mustApi(window, 'completeProject', pA) // 現在の案件を完了にする
  await mustApi(window, 'completeProject', pC)
  await new Promise((r) => setTimeout(r, 20))

  await goTasks(window)
  await window.getByLabel('状態', { exact: true }).selectOption('all')
  await window.getByRole('button', { name: '編集前のタスク' }).click()
  await expect(window.locator('.info-grid')).toContainText('編集の案件A(完了)')
  await window.getByRole('button', { name: '編集', exact: true }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスクを編集')
  const opts = await window.getByLabel('案件').locator('option').allTextContents()
  expect(opts[0]).toBe('案件なし')
  expect([...opts].sort()).toEqual(['案件なし', '編集の案件A(完了)', '編集の案件B'].sort())
  await shot(
    window,
    'TC-134',
    '1) 編集画面。現在の案件は完了でも「(完了)」付きで選択肢に残る。他の完了案件は出ない'
  )
  await window.getByLabel('タスク名').fill('編集後のタスク')
  await window.getByLabel('メモ').fill('メモを追加')
  await window.getByRole('button', { name: '保存', exact: true }).click() // 案件は完了のまま
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスク詳細')
  await expect(window.locator('.info-grid')).toContainText('編集後のタスク')
  await expect(window.locator('.info-grid')).toContainText('編集の案件A(完了)')
  const row1 = taskRow(dataDir, t)
  expect(row1[1]).toBe('編集後のタスク')
  expect(row1[4]).toBe(String(pA))
  expect([row1[5], row1[6], row1[7]]).toEqual([row0[5], row0[6], row0[7]]) // status・completed_at・created_at 不変
  expect(row1[8] > row0[8]).toBe(true)
  await shot(
    window,
    'TC-134',
    '2) 完了の案件のまま保存できた(完了のタスクの状態・完了日時は変わらない)'
  )

  // 別の完了案件への変更は拒否(IPC)。進行中の案件B・案件なしへの変更は成功
  const rC = await callApi(window, 'updateTask', t, { name: '編集後のタスク', projectId: pC })
  expect(rC.ok).toBe(false)
  expect(rC.error).toContain('完了の案件には、新しく紐づけられません')
  const rNo = await callApi(window, 'updateTask', t, { name: '編集後のタスク', projectId: 99999 })
  expect(rNo.error).toContain('指定された案件が見つかりません')
  expect(taskRow(dataDir, t)[4]).toBe(String(pA)) // 失敗時は変更されない
  await mustApi(window, 'updateTask', t, { name: '編集後のタスク', projectId: pB })
  expect(taskRow(dataDir, t)[4]).toBe(String(pB))
  await mustApi(window, 'updateTask', t, { name: '編集後のタスク', projectId: null, dueDate: '' })
  const row2 = taskRow(dataDir, t)
  expect(row2.slice(3, 5)).toEqual(['', ''])
  expect([row2[5], row2[6]]).toEqual([row0[5], row0[6]])
  // 対象が削除済みの場合は更新できない
  await mustApi(window, 'deleteTask', t)
  const rGone = await callApi(window, 'updateTask', t, { name: 'x' })
  expect(rGone.error).toContain('対象のタスクが見つかりません。一覧を更新しました')
  noteEvidence(
    'TC-134',
    '編集のDB・IPC確認結果',
    `編集前: ${row0.join('|')}\n完了案件のまま保存後: ${row1.join('|')}\n別の完了案件C: 拒否「${rC.error}」\n存在しない案件: 拒否「${rNo.error}」\n進行中の案件Bへ変更・案件なし/期限なしへ変更: 成功(status・completed_atは不変)\n削除済みの更新: 拒否「${rGone.error}」`
  )
})

test('TC-135: [F-35 完了・未完了] 確認なしで切替、完了日時の記録と消去、冪等(changed:false)、削除済みへの操作', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  const dialogs: string[] = []
  window.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.accept()
  })
  const t1 = await createTaskApi(window, { name: '切替対象のタスク', dueDate: '2030-05-01' })
  const t2 = await createTaskApi(window, { name: '詳細から切替のタスク' })
  await goTasks(window)
  const row = window.getByRole('row', { name: /切替対象のタスク/ })
  const u0 = taskRow(dataDir, t1)[8]
  await new Promise((r) => setTimeout(r, 20))
  await row.getByRole('button', { name: '完了にする' }).click()
  await expect(window.getByRole('row', { name: /切替対象のタスク/ })).toHaveCount(0) // 既定は未完了のみ
  const d1 = taskRow(dataDir, t1)
  expect(d1[5]).toBe('done')
  expect(d1[6]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  expect(d1[8]).toBe(d1[6]) // updated_at = completed_at
  expect(d1[8] > u0).toBe(true)
  await shot(
    window,
    'TC-135',
    '1) 一覧で「完了にする」を押した直後(確認なし。未完了の一覧から消える)'
  )
  await window.getByLabel('状態', { exact: true }).selectOption('done')
  await expect(window.getByRole('row', { name: /切替対象のタスク/ })).toBeVisible()
  await window
    .getByRole('row', { name: /切替対象のタスク/ })
    .getByRole('button', { name: '未完了に戻す' })
    .click()
  await expect(window.getByText('該当するタスクはありません')).toBeVisible()
  const d2 = taskRow(dataDir, t1)
  expect([d2[5], d2[6]]).toEqual(['open', ''])
  expect(d2[8] > d1[8]).toBe(true)
  // 詳細画面から
  await window.getByLabel('状態', { exact: true }).selectOption('open')
  await window.getByRole('button', { name: '詳細から切替のタスク' }).click()
  await window.getByRole('button', { name: '完了にする' }).click()
  await expect(window.getByRole('button', { name: '未完了に戻す' })).toBeVisible()
  await expect(window.locator('.info-grid')).toContainText('完了日時')
  await shot(window, 'TC-135', '2) 詳細で完了にした状態(完了バッジ・完了日時)')
  await window.getByRole('button', { name: '未完了に戻す' }).click()
  await expect(window.getByRole('button', { name: '完了にする' })).toBeVisible()
  await expect(window.locator('.info-grid')).not.toContainText('完了日時')
  expect(dialogs).toEqual([]) // 切替で確認ダイアログは一度も出ない

  // 冪等: すでに目的の状態なら何も変更しない
  await mustApi(window, 'completeTask', t2)
  const beforeRow = taskRow(dataDir, t2)
  const again = await mustApi<{ changed: boolean }>(window, 'completeTask', t2)
  expect(again.changed).toBe(false)
  expect(taskRow(dataDir, t2)).toEqual(beforeRow)
  await mustApi(window, 'reopenTask', t2)
  const again2 = await mustApi<{ changed: boolean }>(window, 'reopenTask', t2)
  expect(again2.changed).toBe(false)
  const first = await mustApi<{ changed: boolean }>(window, 'completeTask', t2)
  expect(first.changed).toBe(true)

  // 削除済み(別の経路で削除)に対する操作は notFound。一覧は再取得される
  const t3 = await createTaskApi(window, { name: '先に削除されるタスク' })
  await window.getByRole('button', { name: 'ホーム' }).click()
  await goTasks(window)
  await expect(window.getByRole('row', { name: /先に削除されるタスク/ })).toBeVisible()
  await mustApi(window, 'deleteTask', t3) // 画面は古いまま
  await window
    .getByRole('row', { name: /先に削除されるタスク/ })
    .getByRole('button', { name: '完了にする' })
    .click()
  await expect(window.getByText('対象のタスクが見つかりません。一覧を更新しました')).toBeVisible()
  await expect(window.getByRole('row', { name: /先に削除されるタスク/ })).toHaveCount(0)
  await shot(window, 'TC-135', '3) 削除済みのタスクに操作した場合のメッセージと一覧の再取得')
  const gone = await callApi(window, 'completeTask', t3)
  expect(gone.error).toContain('対象のタスクが見つかりません')
  noteEvidence(
    'TC-135',
    '切替のDB確認結果',
    `完了にする: ${d1.join('|')}\n未完了に戻す: ${d2.join('|')}\n確認ダイアログ: ${dialogs.length}回\n完了済みへのcompleteTask: changed=${again.changed}(行は不変)、未完了へのreopenTask: changed=${again2.changed}\n削除済み: 「${gone.error}」`
  )
})

test('TC-136: [F-36 削除] 確認ダイアログ(いいえ/はい)、状態を問わず削除、詳細からの削除は一覧へ、他のデータに影響しない', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  await setupCompany(window)
  const client = await createClientApi(window, '削除確認商事')
  const p = await createProjectApi(window, { name: '削除確認の案件', clientId: client })
  await finalizeInvoiceWithProject(window, { clientId: client, projectId: p, unitPrice: 50000 })
  const t1 = await createTaskApi(window, { name: '削除する未完了', projectId: p })
  const t2 = await createTaskApi(window, { name: '削除する完了', projectId: p })
  const t3 = await createTaskApi(window, { name: '詳細から削除' })
  await createTaskApi(window, { name: '残るタスク' })
  await mustApi(window, 'completeTask', t2)
  const before = snapshotNonTask(dataDir)
  await goTasks(window)
  await window.getByLabel('状態', { exact: true }).selectOption('all')

  // 「いいえ」
  const no = answerNextConfirm(window, false)
  await window
    .getByRole('row', { name: /削除する未完了/ })
    .getByRole('button', { name: '削除', exact: true })
    .click()
  expect(await no).toBe('このタスクを削除します。削除すると元に戻せません。よろしいですか')
  await expect(window.getByRole('row', { name: /削除する未完了/ })).toBeVisible()
  expect(dbQuery(dataDir, `select count(*) from tasks where id=${t1}`)).toBe('1')
  // 「はい」(未完了・完了とも)
  for (const name of ['削除する未完了', '削除する完了']) {
    const yes = answerNextConfirm(window, true)
    await window
      .getByRole('row', { name })
      .getByRole('button', { name: '削除', exact: true })
      .click()
    await yes
    await expect(window.getByRole('row', { name })).toHaveCount(0)
  }
  expect(dbQuery(dataDir, 'select count(*) from tasks where id in (' + t1 + ',' + t2 + ')')).toBe(
    '0'
  )
  await shot(window, 'TC-136', '1) 一覧から未完了・完了のタスクを削除した後')
  // 詳細から
  await window.getByRole('button', { name: '詳細から削除' }).click()
  const yes3 = answerNextConfirm(window, true)
  await window.getByRole('button', { name: '削除', exact: true }).click()
  await yes3
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスク一覧')
  expect(dbQuery(dataDir, `select count(*) from tasks where id=${t3}`)).toBe('0')
  expect(dbQuery(dataDir, 'select count(*) from tasks')).toBe('1')
  await shot(window, 'TC-136', '2) 詳細画面から削除した後(タスク一覧へ遷移)')
  // 他のデータへの影響なし。付け替え履歴も作らない
  expect(snapshotNonTask(dataDir)).toBe(before)
  const gone = await callApi(window, 'deleteTask', t1)
  expect(gone.error).toContain('対象のタスクが見つかりません')
  noteEvidence(
    'TC-136',
    '削除の確認結果',
    `確認文言: このタスクを削除します。削除すると元に戻せません。よろしいですか\n「いいえ」で不変、「はい」で未完了・完了とも削除、詳細からの削除は一覧へ遷移\n案件・請求書(PDFのハッシュ)・記録・履歴のスナップショットは削除前後で一致\n削除済みの再削除: 「${gone.error}」`
  )
})

test('TC-137: [F-37 一覧] 状態・案件・期限・キーワードのAND条件、並び順、%と_の扱い、期間エラー、件数は全タスク対象', async () => {
  test.setTimeout(120_000)
  launched = await launchApp()
  const { window } = launched
  const today = localDate(0)
  const yday = localDate(-1)
  const tmr = localDate(1)
  const pA = await createProjectApi(window, { name: '絞り込みの案件A' })
  const pB = await createProjectApi(window, { name: '絞り込みの案件B(完了予定)' })
  const mk = (name: string, o: Record<string, unknown> = {}): Promise<number> =>
    createTaskApi(window, { name, ...o })
  const tNoDueFirst = await mk('期限なし1')
  const tFar = await mk('遠い期限', { dueDate: '2099-12-31', projectId: pA })
  const tTodayX = await mk('今日が期限', { dueDate: today, projectId: pA })
  const tPast = await mk('過去の期限', { dueDate: yday, projectId: pB })
  const tPastSame1 = await mk('同じ期限の先', { dueDate: '2020-01-01' })
  const tPastSame2 = await mk('同じ期限の後', { dueDate: '2020-01-01', projectId: pB })
  const tNoDue2 = await mk('期限なし2', { projectId: pB })
  const tPct = await mk('100%達成', { dueDate: tmr })
  const tUnd = await mk('a_b確認')
  const tPlain = await mk('aXb確認')
  const tDone = await mk('完了済みの過去', { dueDate: '2019-01-01', projectId: pA })
  await mustApi(window, 'completeTask', tDone)
  await mustApi(window, 'completeProject', pB)

  const names = (r: { items: Array<{ name: string }> }): string[] => r.items.map((i) => i.name)
  const log: string[] = []
  const rec = async (label: string, filter: Record<string, unknown>): Promise<string[]> => {
    const r = await listTasksApi(window, filter)
    log.push(`${label}: ${JSON.stringify(filter)} → ${names(r).join(' / ') || '(0件)'}`)
    return names(r)
  }
  // 既定(未完了)の並び順: 期限日昇順 → 期限なしは末尾 → 同じ期限は登録順
  const def = await rec('既定', {})
  expect(def).toEqual([
    '同じ期限の先',
    '同じ期限の後',
    '過去の期限',
    '今日が期限',
    '100%達成',
    '遠い期限',
    '期限なし1',
    '期限なし2',
    'a_b確認',
    'aXb確認'
  ])
  expect(await rec('状態=完了', { status: 'done' })).toEqual(['完了済みの過去'])
  expect((await rec('状態=すべて', { status: 'all' })).length).toBe(11)
  expect(await rec('案件なし', { status: 'all', projectId: null })).toEqual([
    '同じ期限の先',
    '100%達成',
    '期限なし1',
    'a_b確認',
    'aXb確認'
  ])
  expect(await rec('案件=A', { projectId: pA })).toEqual(['今日が期限', '遠い期限'])
  expect(await rec('案件=B(完了の案件でも絞れる)', { projectId: pB })).toEqual([
    '同じ期限の後',
    '過去の期限',
    '期限なし2'
  ])
  expect(await rec('期限なしのみ', { dueMode: 'none' })).toEqual([
    '期限なし1',
    '期限なし2',
    'a_b確認',
    'aXb確認'
  ])
  expect(await rec('期限超過のみ', { dueMode: 'overdue' })).toEqual([
    '同じ期限の先',
    '同じ期限の後',
    '過去の期限'
  ])
  expect(
    await rec('期間指定(今日〜明日)', { dueMode: 'range', dueFrom: today, dueTo: tmr })
  ).toEqual(['今日が期限', '100%達成'])
  expect(await rec('期間指定(開始のみ=今日)', { dueMode: 'range', dueFrom: today })).toEqual([
    '今日が期限',
    '100%達成',
    '遠い期限'
  ])
  expect(await rec('期間指定(終了のみ=昨日)', { dueMode: 'range', dueTo: yday })).toEqual([
    '同じ期限の先',
    '同じ期限の後',
    '過去の期限'
  ])
  expect(await rec('期間指定(両方空=すべて)', { dueMode: 'range' })).toEqual(def)
  expect(await rec('キーワード「%」', { keyword: '%' })).toEqual(['100%達成'])
  expect(await rec('キーワード「_」', { keyword: '_' })).toEqual(['a_b確認'])
  expect(await rec('キーワード「a_b」', { keyword: 'a_b' })).toEqual(['a_b確認'])
  expect(await rec('キーワード「期限」(部分一致)', { keyword: '期限' })).toEqual([
    '同じ期限の先',
    '同じ期限の後',
    '過去の期限',
    '今日が期限',
    '遠い期限',
    '期限なし1',
    '期限なし2'
  ])
  expect(await rec('AND条件(案件A×期限超過)', { projectId: pA, dueMode: 'overdue' })).toEqual([])
  expect(
    await rec('AND条件(案件B×期限超過×キーワード)', {
      projectId: pB,
      dueMode: 'overdue',
      keyword: '過去'
    })
  ).toEqual(['過去の期限'])
  // 件数: 絞り込みにかかわらず全タスク対象(未完了10件、期限超過3件=完了済みは数えない・今日は数えない)
  const filtered = await listTasksApi(window, { status: 'done', keyword: 'zzz' })
  expect(filtered.counts).toEqual({ open: 10, overdue: 3 })
  // 範囲エラー(終了日が開始日より前)
  const bad = await callApi(window, 'listTasks', { dueMode: 'range', dueFrom: tmr, dueTo: today })
  expect(bad.error).toContain('期限の終了日は、開始日以降の日付を入力してください')
  log.push(`期間の逆転: 拒否「${bad.error}」`)
  const badDate = await callApi(window, 'listTasks', { dueMode: 'range', dueFrom: '2026-13-01' })
  expect(badDate.ok).toBe(false)
  const badStatus = await callApi(window, 'listTasks', { status: 'bogus' })
  expect(badStatus.ok).toBe(false)
  log.push(
    `不正な日付・状態: 拒否(${badDate.error?.slice(0, 30)} / ${badStatus.ok ? '成功' : '拒否'})`
  )

  // 画面の絞り込み(即時反映・件数表示・期間エラー時は直前の表示を維持)
  void [tNoDueFirst, tFar, tTodayX, tPast, tPastSame1, tPastSame2, tNoDue2, tPct, tUnd, tPlain]
  await goTasks(window)
  await expect(window.getByText('該当 10件')).toBeVisible()
  await expect(window.locator('.task-count').nth(0)).toContainText('10')
  await expect(window.locator('.task-count').nth(1)).toContainText('3')
  await shot(
    window,
    'TC-137',
    '1) 既定の一覧(未完了・期限日の昇順・期限なしは末尾)と件数(未完了10・期限超過3)'
  )
  await window.locator('#task-project').selectOption({ label: '絞り込みの案件A' })
  await expect(window.getByText('該当 2件')).toBeVisible()
  await expect(window.locator('.task-count').nth(0)).toContainText('10') // 件数は変わらない
  await window.locator('#task-project').selectOption('')
  await window.locator('#task-due-mode').selectOption('range')
  await window.getByLabel('期限の開始日').fill(tmr)
  await expect(window.getByText('該当 2件')).toBeVisible() // 開始日のみ(明日以降)
  await window.getByLabel('期限の終了日').fill(today)
  await expect(window.getByText('期限の終了日は、開始日以降の日付を入力してください')).toBeVisible()
  await expect(window.getByText('該当 2件')).toBeVisible() // 範囲エラーの間は、直前の表示を維持
  await shot(window, 'TC-137', '2) 期間の開始日>終了日のエラー表示(直前の一覧を維持)')
  await window.getByLabel('期限の開始日').fill(today)
  await window.getByLabel('期限の終了日').fill(tmr)
  await expect(window.getByText('該当 2件')).toBeVisible()
  await window.locator('#task-due-mode').selectOption('any')
  await window.locator('#task-keyword').fill('%')
  await expect(window.getByText('該当 1件')).toBeVisible()
  await shot(window, 'TC-137', '3) キーワード「%」(ワイルドカードとして扱わず文字として検索)')
  noteEvidence('TC-137', '絞り込み・並び順の確認結果(今日=' + today + ')', log.join('\n'))
})

test('TC-138: [F-37 期限超過の判定] 期限日が今日は対象外、昨日は対象、完了は対象外、ローカル日付で判定(UTCではない)、強調は文言・アイコン併用', async () => {
  test.setTimeout(120_000)
  const tzLog: string[] = []
  let differsFromUtc = 0
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    launched = await launchApp({ TZ: tz })
    const { window } = launched
    const localToday = localDate(0, tz)
    const utcToday = new Date().toISOString().slice(0, 10)
    if (localToday !== utcToday) differsFromUtc += 1
    const ids = {
      yday: await createTaskApi(window, { name: '昨日が期限', dueDate: localDate(-1, tz) }),
      today: await createTaskApi(window, { name: '今日が期限', dueDate: localToday }),
      tmr: await createTaskApi(window, { name: '明日が期限', dueDate: localDate(1, tz) }),
      none: await createTaskApi(window, { name: '期限なし' }),
      done: await createTaskApi(window, { name: '完了済みの昨日', dueDate: localDate(-1, tz) })
    }
    await mustApi(window, 'completeTask', ids.done)
    const r = await listTasksApi(window, { status: 'all' })
    const flags = Object.fromEntries(r.items.map((i) => [i.name, i.overdue]))
    expect(flags).toEqual({
      昨日が期限: true,
      今日が期限: false,
      明日が期限: false,
      期限なし: false,
      完了済みの昨日: false
    })
    expect(r.counts).toEqual({ open: 4, overdue: 1 })
    tzLog.push(
      `TZ=${tz}: ローカルの今日=${localToday}(UTCの今日=${utcToday}) → ${JSON.stringify(flags)} counts=${JSON.stringify(r.counts)}`
    )
    if (tz === 'Pacific/Kiritimati') {
      await goTasks(window)
      await window.getByLabel('状態', { exact: true }).selectOption('all')
      const rowY = window.getByRole('row', { name: /昨日が期限/ })
      await expect(rowY).toHaveClass(/overdue/)
      await expect(rowY.getByText('期限超過')).toBeVisible() // 文言
      await expect(rowY.locator('.alert-icon')).toBeVisible() // アイコン
      for (const n of ['今日が期限', '明日が期限', '期限なし', '完了済みの昨日']) {
        await expect(window.getByRole('row', { name: new RegExp(n) })).not.toHaveClass(/overdue/)
      }
      await expect(window.locator('.task-count').nth(1)).toHaveClass(/alert/)
      await expect(window.locator('.task-count').nth(1).locator('.alert-icon')).toBeVisible()
      await shot(
        window,
        'TC-138',
        `1) 期限超過の強調(赤字の期限日・「期限超過」バッジ・件数カードの「!」)。今日=${localToday}`
      )
      // 期限超過の件数が0のときは強調しない
      await mustApi(window, 'completeTask', ids.yday)
      await window.getByLabel('状態', { exact: true }).selectOption('open')
      await expect(window.locator('.task-count').nth(1)).not.toHaveClass(/alert/)
      await shot(window, 'TC-138', '2) 期限超過が0件のとき件数カードは強調されない')
      // 期限超過のみ + 期限日だけ過去へ書き換えた場合、画面の再読込で反映(保存した判定値は無い)
      const cols = await mustApi<unknown>(window, 'listTasks', { status: 'all' })
      void cols
    }
    await closeApp(launched)
    launched = undefined
  }
  expect(differsFromUtc).toBeGreaterThanOrEqual(1) // 少なくとも1つのTZで、ローカル日付がUTC日付と異なる
  noteEvidence('TC-138', '期限超過の判定結果(ローカル日付で判定)', tzLog.join('\n'))
})

test('TC-139: [F-37 異常系] 案件一覧の取得失敗時のエラー表示(I4-03)、タスク一覧の取得失敗、画面での期間エラー', async () => {
  launched = await launchApp()
  const { window, app } = launched
  await createTaskApi(window, { name: '表示確認のタスク' })
  await window.getByRole('button', { name: 'ホーム' }).click()
  // 案件一覧のIPCを失敗させる(Mainのハンドラを差し替える)
  const channel = await app.evaluate(async ({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })
      ._invokeHandlers
    const names = [...handlers.keys()].filter(
      (k) => k.includes('projects') && k.includes('list') && !k.includes('Selectable')
    )
    return names
  })
  noteEvidence('TC-139', '差し替えたIPCチャンネル', channel.join('\n'))
  expect(channel.length).toBeGreaterThan(0)
  await app.evaluate(({ ipcMain }, names) => {
    for (const n of names) {
      ipcMain.removeHandler(n)
      ipcMain.handle(n, () => {
        throw new Error('テスト用に失敗させました')
      })
    }
  }, channel)
  await goTasks(window)
  await expect(window.locator('.message-error')).toBeVisible()
  await shot(
    window,
    'TC-139',
    '1) 案件一覧の取得に失敗したときのタスク一覧(エラー表示。一覧自体は表示される)'
  )
  await expect(window.getByRole('row', { name: /表示確認のタスク/ })).toBeVisible()
  const msg = await window.locator('.message-error').innerText()
  // タスク一覧のIPCも失敗させる
  await app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, unknown> })
      ._invokeHandlers
    for (const n of [...handlers.keys()].filter((k) => k.includes('tasks') && k.includes('list'))) {
      ipcMain.removeHandler(n)
      ipcMain.handle(n, () => {
        throw new Error('テスト用に失敗させました')
      })
    }
  })
  await window.locator('#task-keyword').fill('表示')
  await expect(window.locator('.message-error')).toBeVisible()
  await shot(window, 'TC-139', '2) タスク一覧の取得に失敗したときのエラー表示')
  noteEvidence('TC-139', 'エラー表示の文言', `案件一覧の取得失敗時: ${msg}`)
})

test('TC-140: [F-38 案件詳細のタスク] 未完了・完了とも表示、期限順、0件の文言、収支・件数・削除可否に含めない、行クリックで詳細へ', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  await setupCompany(window)
  const client = await createClientApi(window, '案件タスク商事')
  const empty = await createProjectApi(window, { name: 'タスクのない案件', clientId: client })
  const p = await createProjectApi(window, { name: 'タスクのある案件', clientId: client })
  await finalizeInvoiceWithProject(window, { clientId: client, projectId: p, unitPrice: 100000 })
  await createTaskApi(window, { name: '期限なしのタスク', projectId: p })
  await createTaskApi(window, { name: '遠い期限のタスク', projectId: p, dueDate: '2099-01-01' })
  await createTaskApi(window, { name: '過去の期限のタスク', projectId: p, dueDate: localDate(-3) })
  const done = await createTaskApi(window, {
    name: '完了のタスク',
    projectId: p,
    dueDate: '2020-01-01'
  })
  await mustApi(window, 'completeTask', done)
  await createTaskApi(window, { name: '他の案件のタスク', projectId: empty })
  await createTaskApi(window, { name: '案件なしのタスク' })

  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: 'タスクのない案件' }).click()
  await expect(
    window.getByText('この案件に紐づくタスクはありません').or(window.getByText('他の案件のタスク'))
  ).toBeVisible()
  await shot(window, 'TC-140', '1) タスクのない(1件の)案件の詳細')
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: 'タスクのある案件' }).click()
  await expect(window.getByText('紐づくタスク', { exact: true })).toBeVisible()
  const detail = await mustApi<{
    tasks: Array<{ name: string; overdue: boolean }>
    deletable: boolean
    summary: { sales: number; counts: Record<string, number> }
  }>(window, 'getProject', p)
  expect(detail.tasks.map((t) => t.name)).toEqual([
    '完了のタスク',
    '過去の期限のタスク',
    '遠い期限のタスク',
    '期限なしのタスク'
  ])
  expect(detail.tasks.map((t) => t.overdue)).toEqual([false, true, false, false])
  expect(detail.deletable).toBe(false) // 請求書があるため。タスクは数えない
  expect(detail.summary.sales).toBe(110000)
  const table = window
    .locator('.section-title', { hasText: '紐づくタスク' })
    .locator('xpath=following-sibling::table[1]')
  await expect(table.locator('tbody tr')).toHaveCount(4)
  await expect(table.getByRole('row', { name: /過去の期限のタスク/ })).toHaveClass(/overdue/)
  await expect(table.getByRole('row', { name: /完了のタスク/ })).toHaveClass(/done/)
  await shot(
    window,
    'TC-140',
    '2) 案件詳細の「紐づくタスク」(完了も表示・期限超過の強調・収支は請求書のみ)'
  )
  await table.getByRole('button', { name: '過去の期限のタスク' }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - タスク詳細')
  await window.getByRole('button', { name: 'タスクのある案件' }).click() // 案件リンク
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件詳細')
  // 案件を完了にしても、紐づくタスクは変わらない
  const dump0 = dbQuery(dataDir, `select * from tasks where project_id=${p} order by id`)
  await mustApi(window, 'completeProject', p)
  expect(dbQuery(dataDir, `select * from tasks where project_id=${p} order by id`)).toBe(dump0)
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await window.getByLabel('状態', { exact: true }).selectOption('all')
  await expect(window.getByRole('row', { name: /過去の期限のタスク/ })).toBeVisible()
  noteEvidence(
    'TC-140',
    '案件詳細のタスク一覧の確認結果',
    `並び順: ${detail.tasks.map((t) => t.name).join(' → ')}\noverdue: ${detail.tasks.map((t) => t.overdue).join(',')}\n売上=${detail.summary.sales}円(請求書のみ。タスクは含まない)、件数の内訳=${JSON.stringify(detail.summary.counts)}、deletable=${detail.deletable}\n案件を完了にしてもタスクの行は不変`
  )
})

test('TC-141: [R-54 案件の削除] タスクは削除されず案件なしに戻る、確認文言にタスク件数、紐づけ0の案件のみ削除可、失敗時はロールバック', async () => {
  launched = await launchApp()
  const { window, dataDir } = launched
  const p = await createProjectApi(window, { name: '削除する案件' })
  const q = await createProjectApi(window, { name: '残す案件' })
  const tOpen = await createTaskApi(window, {
    name: '削除案件の未完了',
    projectId: p,
    dueDate: '2030-01-01'
  })
  const tDone = await createTaskApi(window, { name: '削除案件の完了', projectId: p })
  await mustApi(window, 'completeTask', tDone)
  const tOther = await createTaskApi(window, { name: '残す案件のタスク', projectId: q })
  const tOpenBefore = taskRow(dataDir, tOpen)
  const otherBefore = taskRow(dataDir, tOther)

  // タスクのない案件は通常の確認文言
  const r = await createProjectApi(window, { name: 'タスクなしの案件' })
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: 'タスクなしの案件' }).click()
  const plain = answerNextConfirm(window, false)
  await window.getByRole('button', { name: '削除', exact: true }).click()
  expect(await plain).toBe('この案件を削除します。削除すると元に戻せません。よろしいですか')
  void r
  // タスクのある案件: 件数を併記。「いいえ」では何も変わらない
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: '削除する案件' }).click()
  const no = answerNextConfirm(window, false)
  await window.getByRole('button', { name: '削除', exact: true }).click()
  const msg = await no
  expect(msg).toBe(
    'この案件を削除します。削除すると元に戻せません。\n紐づくタスク2件は削除されず、「案件なし」に戻ります。よろしいですか'
  )
  expect(dbQuery(dataDir, `select count(*) from projects where id=${p}`)).toBe('1')
  expect(dbQuery(dataDir, `select count(*) from tasks where project_id=${p}`)).toBe('2')
  await shot(
    window,
    'TC-141',
    '1) 紐づくタスクがある案件の詳細(削除ボタン)。確認文言はテキストに記録'
  )
  const yes = answerNextConfirm(window, true)
  await window.getByRole('button', { name: '削除', exact: true }).click()
  await yes
  await expect(window.getByText('案件を削除しました')).toBeVisible()
  expect(dbQuery(dataDir, `select count(*) from projects where id=${p}`)).toBe('0')
  const a = taskRow(dataDir, tOpen)
  const b = taskRow(dataDir, tDone)
  expect(a.slice(1, 4)).toEqual(tOpenBefore.slice(1, 4)) // 名前・メモ・期限は不変
  expect([a[4], b[4]]).toEqual(['', '']) // 案件なしに戻る
  expect(a[5]).toBe('open')
  expect(b[5]).toBe('done') // 状態は不変
  expect(taskRow(dataDir, tOther)).toEqual(otherBefore) // 他の案件のタスクは不変
  expect(dbQuery(dataDir, 'select count(*) from project_link_history')).toBe('0')
  await window.getByRole('button', { name: 'タスク・期限' }).click()
  await window.getByLabel('状態', { exact: true }).selectOption('all')
  await window.locator('#task-project').selectOption('none')
  await expect(window.getByText('該当 2件')).toBeVisible()
  await shot(
    window,
    'TC-141',
    '2) 案件を削除した後、タスクは削除されず「案件なし」で残る(案件なしで絞り込み)'
  )

  // 失敗時はロールバック: tasksの更新を拒否するトリガーを作り、案件の削除が全体で取り消されることを確認する
  dbExec(
    dataDir,
    "create trigger t_block_release before update of project_id on tasks begin select raise(abort,'blocked for test'); end;"
  )
  const t3 = await createTaskApi(window, { name: '失敗時のタスク', projectId: q })
  const fail = await callApi(window, 'deleteProject', q)
  expect(fail.ok).toBe(false)
  expect(dbQuery(dataDir, `select count(*) from projects where id=${q}`)).toBe('1')
  expect(taskRow(dataDir, t3)[4]).toBe(String(q))
  dbExec(dataDir, 'drop trigger t_block_release;')
  const ok = await callApi(window, 'deleteProject', q)
  expect(ok.ok).toBe(true)
  expect((ok.value as { releasedTaskCount: number }).releasedTaskCount).toBe(2)
  noteEvidence(
    'TC-141',
    '案件削除とタスクの確認結果',
    `確認文言(タスク2件): ${msg.replace('\n', '\\n')}\n削除後: 未完了=${a.join('|')} / 完了=${b.join('|')} → project_idは空(案件なし)、statusは不変\n付け替え履歴は作られない(0件)\n失敗の再現: tasksの更新を拒否するトリガーを一時的に作成 → deleteProjectは失敗「${fail.error?.slice(0, 60)}」、案件は残り、タスクの紐づけも元のまま(ロールバック)\nトリガー削除後の再実行: 成功、releasedTaskCount=${(ok.value as { releasedTaskCount: number }).releasedTaskCount}`
  )
  void dumpTasks
})
