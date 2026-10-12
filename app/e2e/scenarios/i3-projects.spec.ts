import { test, expect } from '@playwright/test'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import { createClientApi, dbQuery, setupCompany } from './helpers'
import { callApi, mustApi } from './helpers-i2'
import {
  answerNextConfirm,
  changeLinkApi,
  createProjectApi,
  getProjectApi,
  saveQuoteDraftApi
} from './helpers-i3'

/**
 * 【tester作成】イテレーション3: 案件管理(F-27〜F-29)の結合シナリオ(TC-105〜TC-109)。
 * 参照元: 詳細設計書 3.22〜3.25章・4.27〜4.29章・6.14章・8章
 */

let launched: LaunchedApp

test.beforeEach(async () => {
  launched = await launchApp()
})
test.afterEach(async () => {
  await closeApp(launched)
})

test('TC-105: [F-27] 案件の登録・編集(画面)。案件名・取引先・期間・メモがDBまで一致し、状態は進行中で始まる。同名の案件も登録できる', async () => {
  const { window, dataDir } = launched
  const clientId = await createClientApi(window, '案件確認用商事株式会社')

  await window.getByRole('button', { name: '案件管理' }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件一覧')
  await expect(window.getByText('該当する案件がありません')).toBeVisible()
  await shot(window, 'TC-105', '案件一覧(0件の状態)')

  // 登録
  await window.getByRole('button', { name: '+ 案件を登録' }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件を登録')
  await window.getByLabel('案件名').fill('  Webサイト制作  ')
  await window.getByLabel('取引先').selectOption({ label: '案件確認用商事株式会社' })
  await window.getByLabel('開始日').fill('2026-10-01')
  await window.getByLabel('終了日').fill('2026-12-31')
  await window.getByLabel('メモ').fill('初回の打ち合わせ済み')
  await shot(window, 'TC-105', '案件登録画面(入力後)')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('案件を保存しました')).toBeVisible()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件詳細')
  await expect(window.getByText('Webサイト制作', { exact: true }).first()).toBeVisible()
  await expect(window.getByText('案件確認用商事株式会社').first()).toBeVisible()
  await expect(window.getByText('初回の打ち合わせ済み')).toBeVisible()
  await shot(window, 'TC-105', '案件詳細(登録直後。案件名は前後の空白を除去、状態は進行中)')

  const row = dbQuery(
    dataDir,
    'select name,client_id,start_date,end_date,memo,status from projects order by id'
  )
  expect(row).toBe(`Webサイト制作|${clientId}|2026-10-01|2026-12-31|初回の打ち合わせ済み|active`)

  // 編集(状態は変わらない)
  await window.getByRole('button', { name: '編集' }).click()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件を編集')
  await expect(window.getByLabel('案件名')).toHaveValue('Webサイト制作')
  await window.getByLabel('案件名').fill('Webサイト制作(第2期)')
  await window.getByLabel('メモ').fill('')
  await window.getByRole('button', { name: '保存', exact: true }).click()
  await expect(window.getByText('案件を保存しました')).toBeVisible()
  expect(
    dbQuery(dataDir, "select name,ifnull(memo,''),status,updated_at>=created_at from projects")
  ).toBe('Webサイト制作(第2期)||active|1')

  // 同名の案件も登録できる(基本設計書8.1章★29)
  const id2 = await createProjectApi(window, { name: 'Webサイト制作(第2期)' })
  expect(id2).toBe(2)
  expect(dbQuery(dataDir, "select count(*) from projects where name='Webサイト制作(第2期)'")).toBe(
    '2'
  )

  // 一覧: 登録の新しい順(idの降順)
  await window.getByRole('button', { name: '案件管理' }).click()
  await expect(window.locator('tbody tr')).toHaveCount(2)
  await expect(window.locator('tbody tr').first()).toContainText('Webサイト制作(第2期)') // 新しい順(2件目に登録した案件が先頭)
  noteEvidence(
    'TC-105',
    'DB照合(登録・編集・同名登録)',
    `${row}\n編集後: ${dbQuery(dataDir, 'select id,name,status from projects order by id')}`
  )
  await shot(window, 'TC-105', '案件一覧(同名の案件が2件。新しい順)')
})

test('TC-106: [F-27] 案件の入力値検証・異常系(画面とIPC)。案件名・メモ・期間・取引先・存在しないID', async () => {
  const { window, dataDir } = launched
  const active = await createClientApi(window, '利用中の取引先')
  const stopped = await createClientApi(window, '利用停止の取引先')
  await mustApi(window, 'deactivateClient', stopped)

  // 画面: 案件名の未入力(空白のみ)
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('button', { name: '+ 案件を登録' }).click()
  await window.getByLabel('案件名').fill('   ')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('案件名を入力してください')).toBeVisible()
  // 期間の逆転
  await window.getByLabel('案件名').fill('期間確認')
  await window.getByLabel('開始日').fill('2026-12-31')
  await window.getByLabel('終了日').fill('2026-10-01')
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('終了日は、開始日以降の日付を入力してください')).toBeVisible()
  await shot(window, 'TC-106', '案件名の未入力・期間の逆転のエラー表示')
  // 101文字
  await window.getByLabel('開始日').fill('')
  await window.getByLabel('終了日').fill('')
  await window.getByLabel('案件名').fill('あ'.repeat(101))
  await window.getByRole('button', { name: '登録', exact: true }).click()
  await expect(window.getByText('案件名は100文字以内で入力してください')).toBeVisible()
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('0') // いずれも保存されない

  // 画面から離れる際の確認(サイドバー)
  window.once('dialog', (d) => void d.accept())

  // IPC(画面外)の境界値・異常系
  const log: string[] = []
  const rec = async (label: string, p: Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const r = await p
    log.push(`${label}: ${r.ok ? 'OK' : `拒否「${r.error}」`}`)
  }
  const base = { clientId: null, startDate: '', endDate: '', memo: '' }
  const ok100 = await callApi(window, 'createProject', { ...base, name: 'あ'.repeat(100) })
  expect(ok100.ok).toBe(true) // 100文字は登録できる
  log.push('案件名100文字: OK')
  const r101 = await callApi(window, 'createProject', { ...base, name: 'あ'.repeat(101) })
  expect(r101.error).toContain('案件名は100文字以内で入力してください')
  const rBlank = await callApi(window, 'createProject', { ...base, name: ' 　 ' })
  expect(rBlank.ok).toBe(false)
  const rMemo = await callApi(window, 'createProject', {
    ...base,
    name: 'メモ',
    memo: 'a'.repeat(1001)
  })
  expect(rMemo.error).toContain('メモは1000文字以内で入力してください')
  const rMemo1000 = await callApi(window, 'createProject', {
    ...base,
    name: 'メモ1000',
    memo: 'a'.repeat(1000)
  })
  expect(rMemo1000.ok).toBe(true)
  const rDate = await callApi(window, 'createProject', {
    ...base,
    name: '日付',
    startDate: '2026-02-30'
  })
  expect(rDate.ok).toBe(false)
  const rPeriod = await callApi(window, 'createProject', {
    ...base,
    name: '期間',
    startDate: '2026-10-02',
    endDate: '2026-10-01'
  })
  expect(rPeriod.error).toContain('終了日は、開始日以降の日付を入力してください')
  const rSame = await callApi(window, 'createProject', {
    ...base,
    name: '同日',
    startDate: '2026-10-01',
    endDate: '2026-10-01'
  })
  expect(rSame.ok).toBe(true) // 開始日と終了日が同じ日は許容
  const rStopped = await callApi(window, 'createProject', {
    ...base,
    name: '停止取引先',
    clientId: stopped
  })
  expect(rStopped.error).toBe('利用停止中の取引先は選択できません')
  const rNoClient = await callApi(window, 'createProject', {
    ...base,
    name: '無い取引先',
    clientId: 99999
  })
  expect(rNoClient.ok).toBe(false)
  await rec('案件名101文字', Promise.resolve(r101))
  await rec('案件名が空白のみ', Promise.resolve(rBlank))
  await rec('メモ1001文字', Promise.resolve(rMemo))
  log.push('メモ1000文字: OK')
  await rec('存在しない日付(2026-02-30)', Promise.resolve(rDate))
  await rec('終了日が開始日より前', Promise.resolve(rPeriod))
  log.push('開始日=終了日: OK')
  await rec('利用停止の取引先', Promise.resolve(rStopped))
  await rec('存在しない取引先', Promise.resolve(rNoClient))

  // 編集時は、現在値が利用停止の取引先でも保存できる。ほかの利用停止の取引先へは変更できない
  const pStop = await createProjectApi(window, { name: '現在値が停止', clientId: active })
  await mustApi(window, 'deactivateClient', active)
  const keep = await callApi(window, 'updateProject', pStop, {
    ...base,
    name: '現在値が停止(改名)',
    clientId: active
  })
  expect(keep.ok).toBe(true)
  const change = await callApi(window, 'updateProject', pStop, {
    ...base,
    name: 'x',
    clientId: stopped
  })
  expect(change.error).toBe('利用停止中の取引先は選択できません')
  log.push('編集で現在値が利用停止の取引先: OK、別の利用停止の取引先へ変更: 拒否')
  // 存在しないID
  const nf1 = await callApi(window, 'updateProject', 99999, { ...base, name: 'x' })
  const nf2 = await callApi(window, 'deleteProject', 99999)
  const nf3 = await callApi(window, 'getProject', 99999)
  expect(nf1.error).toBe('指定された案件が見つかりません')
  expect(nf2.error).toBe('指定された案件が見つかりません')
  expect(nf3.error).toBe('指定された案件が見つかりません')
  log.push(`存在しないIDの更新・削除・取得: 「${nf1.error}」`)
  // 不正な型
  const bad = await callApi(window, 'createProject', { name: 123 })
  expect(bad.ok).toBe(false)
  const badId = await callApi(window, 'deleteProject', -1)
  expect(badId.ok).toBe(false)
  log.push('不正な型・負のID: 拒否')
  noteEvidence('TC-106', 'IPC境界の入力値検証結果', log.join('\n'))
})

test('TC-107: [F-27] 案件の削除。紐づけ0件のみ(画面は削除ボタンを出さない・IPCは拒否)。確認で「いいえ」なら削除しない。付け替え履歴は削除後も残る', async () => {
  const { window, dataDir } = launched
  const clientId = await createClientApi(window, '削除確認商事')
  await setupCompany(window)
  const p = await createProjectApi(window, { name: '削除の確認' })
  const q = await saveQuoteDraftApi(window, clientId, p)

  // 紐づけがある間: 画面に削除ボタンは出ず、IPCは拒否する
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: '削除の確認' }).click()
  await expect(window.getByRole('button', { name: '削除' })).toHaveCount(0)
  const denied = await callApi(window, 'deleteProject', p)
  expect(denied.error).toBe(
    '紐づけがあるため削除できません。完了にして、一覧の絞り込みでご確認ください'
  )
  expect((await getProjectApi(window, p)).deletable).toBe(false)
  await shot(window, 'TC-107', '紐づけのある案件の詳細(削除ボタンなし)')

  // 紐づけを外す→削除できる。「いいえ」では削除されない
  await mustApi(window, 'changeProjectLink', { targetType: 'quote', targetId: q, projectId: null })
  await window.getByRole('button', { name: '案件管理' }).click()
  await window.getByRole('cell', { name: '削除の確認' }).click()
  await expect(window.getByRole('button', { name: '削除' })).toBeVisible()
  const no = answerNextConfirm(window, false)
  await window.getByRole('button', { name: '削除' }).click()
  expect(await no).toBe('この案件を削除します。削除すると元に戻せません。よろしいですか')
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('1')
  // 「はい」で削除され、一覧へ戻る
  const yes = answerNextConfirm(window, true)
  await window.getByRole('button', { name: '削除' }).click()
  await yes
  await expect(window.getByText('案件を削除しました')).toBeVisible()
  await expect(window.locator('.titlebar-title')).toHaveText('事務HUB - 案件一覧')
  expect(dbQuery(dataDir, 'select count(*) from projects')).toBe('0')
  // 付け替え履歴(assign→unassign)は、案件を削除した後も残る(外部キーで参照しない。6.15章)
  const hist = dbQuery(
    dataDir,
    'select kind,from_project_name,to_project_name from project_link_history order by id'
  )
  expect(hist).toBe('assign||削除の確認\nunassign|削除の確認|')
  await shot(window, 'TC-107', '削除後の案件一覧(削除しました)')
  noteEvidence(
    'TC-107',
    '削除後のDB(案件0件、付け替え履歴は残る)',
    `projects=0\n${hist}\n拒否文言: ${denied.error}`
  )
  // 追記専用: 履歴の更新・削除はトリガーで拒否される
  expect(() => dbExecWrite(dataDir, "update project_link_history set target_label='x'")).toThrow()
  expect(() => dbExecWrite(dataDir, 'delete from project_link_history')).toThrow()
})

import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
function dbExecWrite(dataDir: string, sql: string): void {
  execFileSync('sqlite3', [join(dataDir, 'data.sqlite'), sql], { stdio: 'pipe' })
}

test('TC-108: [F-28] 案件の一覧・検索。案件名・取引先・状態・期間のAND条件、LIKEのエスケープ、新しい順、件数、0件、期間エラー', async () => {
  const { window } = launched
  const c1 = await createClientApi(window, '検索確認A社')
  const c2 = await createClientApi(window, '検索確認B社')
  const base = { startDate: '', endDate: '', memo: '' }
  const ids = {
    web: await createProjectApi(window, {
      ...base,
      name: 'Webサイト制作',
      clientId: c1,
      startDate: '2026-04-01',
      endDate: '2026-06-30'
    }),
    pct: await createProjectApi(window, {
      ...base,
      name: '100%達成キャンペーン',
      clientId: c2,
      startDate: '2026-07-01'
    }),
    und: await createProjectApi(window, {
      ...base,
      name: 'a_b案件',
      clientId: c1,
      endDate: '2026-05-15'
    }),
    nodate: await createProjectApi(window, { ...base, name: '日付なし案件', clientId: null }),
    done: await createProjectApi(window, {
      ...base,
      name: '完了済みWeb改修',
      clientId: c1,
      startDate: '2026-01-01',
      endDate: '2026-03-31'
    }),
    other: await createProjectApi(window, {
      ...base,
      name: 'axb案件',
      clientId: c2,
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    })
  }
  await mustApi(window, 'completeProject', ids.done)

  const names = async (filter: Record<string, unknown>): Promise<string[]> => {
    const list = await mustApi<Array<{ name: string }>>(window, 'listProjects', filter)
    return list.map((x) => x.name)
  }
  const log: string[] = []
  const check = async (
    label: string,
    filter: Record<string, unknown>,
    expected: string[]
  ): Promise<void> => {
    const got = await names(filter)
    log.push(`${label}: ${JSON.stringify(filter)} -> ${got.join(' / ') || '(0件)'}`)
    expect(got, label).toEqual(expected)
  }
  // 初期(状態の既定は進行中)と並び順(idの降順)
  await check('既定(フィルタなし=すべて)', {}, [
    'axb案件',
    '完了済みWeb改修',
    '日付なし案件',
    'a_b案件',
    '100%達成キャンペーン',
    'Webサイト制作'
  ])
  await check('状態=進行中', { status: 'active' }, [
    'axb案件',
    '日付なし案件',
    'a_b案件',
    '100%達成キャンペーン',
    'Webサイト制作'
  ])
  await check('状態=完了', { status: 'completed' }, ['完了済みWeb改修'])
  await check('キーワード(部分一致・大文字小文字)', { keyword: 'web' }, [
    '完了済みWeb改修',
    'Webサイト制作'
  ])
  await check('キーワードの_は文字どおり', { keyword: 'a_b' }, ['a_b案件'])
  await check('キーワードの%は文字どおり', { keyword: '100%' }, ['100%達成キャンペーン'])
  await check('取引先', { clientId: c2 }, ['axb案件', '100%達成キャンペーン'])
  await check('キーワード+取引先+状態(AND)', { keyword: 'Web', clientId: c1, status: 'active' }, [
    'Webサイト制作'
  ])
  // 期間(重なり判定)
  await check(
    '期間=2026-05-01〜2026-05-31(重なる案件)',
    { periodFrom: '2026-05-01', periodTo: '2026-05-31' },
    ['a_b案件', 'Webサイト制作']
  )
  await check('期間の開始日のみ(2026-08-01以降)', { periodFrom: '2026-08-01' }, [
    'axb案件',
    '100%達成キャンペーン'
  ])
  await check('期間の終了日のみ(2026-02-01まで)', { periodTo: '2026-02-01' }, [
    '完了済みWeb改修',
    'a_b案件'
  ])
  await check(
    '期間の端(案件の終了日=期間の開始日)',
    { periodFrom: '2026-06-30', periodTo: '2026-06-30' },
    ['Webサイト制作']
  )
  await check(
    '期間を指定すると、開始日・終了日とも未入力の案件は対象外',
    { periodFrom: '2000-01-01', periodTo: '2099-12-31' },
    ['axb案件', '完了済みWeb改修', 'a_b案件', '100%達成キャンペーン', 'Webサイト制作']
  )
  await check('該当なし', { keyword: '存在しない案件名' }, [])
  const bad = await callApi(window, 'listProjects', {
    periodFrom: '2026-10-02',
    periodTo: '2026-10-01'
  })
  expect(bad.error).toContain('期間の終了日は、開始日以降の日付を入力してください')
  log.push(`期間の逆転(IPC): 拒否「${bad.error}」`)
  const badStatus = await callApi(window, 'listProjects', { status: 'unknown' })
  expect(badStatus.ok).toBe(false)
  log.push('状態に列挙値以外(IPC): 拒否')
  noteEvidence('TC-108', '検索条件ごとの結果(IPC)', log.join('\n'))

  // 画面: 初期表示は進行中、件数表示、絞り込み、0件、期間エラー
  await window.getByRole('button', { name: '案件管理' }).click()
  await expect(window.locator('tbody tr')).toHaveCount(5)
  await expect(window.getByText('5件', { exact: true })).toBeVisible()
  await shot(window, 'TC-108', '案件一覧の初期表示(状態=進行中の5件、件数・収支列)')
  await window.locator('#project-status').selectOption('all')
  await expect(window.locator('tbody tr')).toHaveCount(6)
  await window.locator('#project-keyword').fill('Web')
  await expect(window.locator('tbody tr')).toHaveCount(2)
  await window.locator('#project-client').selectOption({ label: '検索確認B社' })
  await expect(window.getByText('該当する案件がありません')).toBeVisible()
  await shot(window, 'TC-108', '該当0件の表示')
  await window.locator('#project-client').selectOption({ label: 'すべて' })
  await window.locator('#project-keyword').fill('')
  await window.getByLabel('期間の開始日').fill('2026-10-02')
  // 開始日のみ(10/02以降): 終了日が未入力、または10/02以降の案件のみ(期間の重なり)
  await expect(window.locator('tbody tr')).toHaveCount(1)
  await expect(window.locator('tbody tr')).toContainText('100%達成キャンペーン')
  await window.getByLabel('期間の終了日').fill('2026-10-01')
  await expect(window.getByText('期間の終了日は、開始日以降の日付を入力してください')).toBeVisible()
  await expect(window.locator('tbody tr')).toHaveCount(1) // 範囲エラーの間は再取得せず、直前の表示を維持
  await expect(window.locator('tbody tr')).toContainText('100%達成キャンペーン')
  await shot(window, 'TC-108', '期間の範囲エラー(直前の一覧を維持)')
})

test('TC-109: [F-29] 案件の完了・再開。確認ダイアログ(はい・いいえ)、データは残る、完了案件は新規紐づけの候補から外れ、再開で戻る', async () => {
  const { window, dataDir } = launched
  const clientId = await createClientApi(window, '完了確認商事')
  await setupCompany(window)
  const p = await createProjectApi(window, { name: '完了の確認' })
  const other = await createProjectApi(window, { name: '別の案件' })
  const q = await saveQuoteDraftApi(window, clientId, p)

  await window.getByRole('button', { name: '案件管理' }).click()
  const row = window.getByRole('row').filter({ hasText: '完了の確認' })
  // 「いいえ」: 何も変わらない
  const no = answerNextConfirm(window, false)
  await row.getByRole('button', { name: '完了' }).click()
  expect(await no).toBe('この案件を完了にします。完了にしても、データは残ります。よろしいですか')
  expect(dbQuery(dataDir, `select status from projects where id=${p}`)).toBe('active')
  // 「はい」: 一覧から完了へ。既定の絞り込み(進行中)から消える
  const yes = answerNextConfirm(window, true)
  await row.getByRole('button', { name: '完了' }).click()
  await yes
  await expect(window.getByRole('row').filter({ hasText: '完了の確認' })).toHaveCount(0)
  expect(dbQuery(dataDir, `select status from projects where id=${p}`)).toBe('completed')
  // 完了にしても紐づけ・データは変わらない
  expect(dbQuery(dataDir, `select project_id from quotes where id=${q}`)).toBe(String(p))
  // 候補: 完了の案件は新しい紐づけの候補から除外される
  const sel = await mustApi<Array<{ id: number }>>(window, 'listSelectableProjects')
  expect(sel.map((x) => x.id)).toEqual([other])
  // 現在の案件が完了の場合は、includeIdで候補に含められる(変更ダイアログ用)
  const selWith = await mustApi<Array<{ id: number }>>(window, 'listSelectableProjects', p)
  expect(selWith.map((x) => x.id).sort()).toEqual([p, other].sort())
  // 完了案件への新規紐づけは拒否される
  const q2 = await saveQuoteDraftApi(window, clientId, null)
  const denied = await changeLinkApi(window, 'quote', q2, p)
  expect(denied.error).toBe('完了の案件には、新しく紐づけられません')
  // 詳細画面: 完了バッジ・再開ボタン。「再開」の確認
  await window.locator('#project-status').selectOption('completed')
  await window.getByRole('cell', { name: '完了の確認' }).click()
  await expect(window.getByRole('button', { name: '再開' })).toBeVisible()
  await expect(window.getByText('完了', { exact: true }).first()).toBeVisible()
  await shot(window, 'TC-109', '完了の案件の詳細(完了バッジ・再開ボタン・紐づけは残る)')
  const reopenNo = answerNextConfirm(window, false)
  await window.getByRole('button', { name: '再開' }).click()
  expect(await reopenNo).toBe('この案件を進行中に戻します。よろしいですか')
  expect(dbQuery(dataDir, `select status from projects where id=${p}`)).toBe('completed')
  const reopenYes = answerNextConfirm(window, true)
  await window.getByRole('button', { name: '再開' }).click()
  await reopenYes
  await expect(window.getByRole('button', { name: '完了', exact: true })).toBeVisible()
  expect(dbQuery(dataDir, `select status from projects where id=${p}`)).toBe('active')
  // 再開すると候補に戻り、紐づけられる
  const ok = await changeLinkApi(window, 'quote', q2, p)
  expect(ok.ok).toBe(true)
  // IPCガード: 目的の状態への再指定
  const again = await callApi(window, 'reopenProject', p)
  expect(again.error).toBe('すでに進行中の案件です')
  await mustApi(window, 'completeProject', p)
  const again2 = await callApi(window, 'completeProject', p)
  expect(again2.error).toBe('すでに完了の案件です')
  noteEvidence(
    'TC-109',
    '完了・再開の結果',
    `候補(完了中): ${JSON.stringify(sel)}\n完了案件への新規紐づけ: ${denied.error}\n再指定: ${again.error} / ${again2.error}\n再開後の紐づけ: changed=${JSON.stringify(ok.value)}`
  )
  expect(callApi).toBeDefined()
})
