import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { Database } from '../db/db'
import { AccountRepository } from '../repositories/account.repository'
import { AccountService, AccountError } from './account.service'

describe('AccountService(F-17)', () => {
  let db: Database
  let service: AccountService

  beforeEach(() => {
    db = new Database(':memory:')
    db.initialize()
    service = new AccountService(new AccountRepository(db))
  })
  afterEach(() => db.close())

  function idOf(name: string): number {
    return service.listAccounts({ includeInactive: true }).find((a) => a.name === name)!.id
  }

  function useAccount(accountId: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO cash_records (record_date, kind, amount, account_id, description) VALUES ('2026-10-01', 'expense', 100, ?, 'x')"
      )
      .run(accountId)
  }

  it('一覧は経費→収入、表示順で返し、既定は利用中のみ。includeInactiveで利用停止も含める', () => {
    const list = service.listAccounts()
    expect(list).toHaveLength(14)
    expect(list[0]).toMatchObject({ name: '通信費', kind: 'expense' })
    expect(list[12]).toMatchObject({ name: '売上高', kind: 'income' })
    service.deactivateAccount(idOf('通信費'))
    expect(service.listAccounts()).toHaveLength(13)
    expect(service.listAccounts({ includeInactive: true })).toHaveLength(14)
    expect(service.listAccounts({ kind: 'income' }).map((a) => a.name)).toEqual([
      '売上高',
      '雑収入'
    ])
  })

  it('deletableは初期科目でなく未使用の場合のみtrue', () => {
    const { id } = service.createAccount({ name: '研修費', kind: 'expense' })
    const used = service.createAccount({ name: '書籍費', kind: 'expense' }).id
    useAccount(used)
    const list = service.listAccounts()
    expect(list.find((a) => a.id === id)!.deletable).toBe(true)
    expect(list.find((a) => a.id === used)!.deletable).toBe(false)
    expect(list.find((a) => a.name === '通信費')!.deletable).toBe(false)
  })

  it('追加: 前後の空白を除去し、同区分の最大値+10の表示順で利用中・非初期として登録する', () => {
    const { id } = service.createAccount({ name: '  研修費  ', kind: 'expense' })
    const created = service.listAccounts().find((a) => a.id === id)!
    expect(created).toMatchObject({
      name: '研修費',
      status: 'active',
      isDefault: false,
      sortOrder: 130
    })
  })

  it('追加・名称変更: 空欄・31文字以上・同区分の同名(利用停止含む)は拒否し、別区分の同名は許可する', () => {
    expect(() => service.createAccount({ name: '   ', kind: 'expense' })).toThrow(
      '科目の名称を入力してください'
    )
    expect(() => service.createAccount({ name: 'あ'.repeat(31), kind: 'expense' })).toThrow()
    expect(() => service.createAccount({ name: '通信費', kind: 'expense' })).toThrow(AccountError)
    service.deactivateAccount(idOf('通信費'))
    expect(() => service.createAccount({ name: '通信費', kind: 'expense' })).toThrow(
      '同じ区分に同じ名称の科目があります'
    )
    expect(() => service.createAccount({ name: '通信費', kind: 'income' })).not.toThrow()
    expect(() => service.renameAccount(idOf('雑費'), '通信費')).toThrow(
      '同じ区分に同じ名称の科目があります'
    )
  })

  it('名称変更: 初期科目も変更でき、自身と同じ名称への変更は許可する。存在しないidは拒否する', () => {
    const id = idOf('雑費')
    expect(service.renameAccount(id, '  諸経費 ')).toEqual({ success: true })
    expect(service.listAccounts().find((a) => a.id === id)!.name).toBe('諸経費')
    expect(() => service.renameAccount(id, '諸経費')).not.toThrow()
    expect(() => service.renameAccount(9999, 'x')).toThrow('指定された勘定科目が見つかりません')
  })

  it('利用停止・再開: 売上高(default_keyあり)は利用停止できない', () => {
    const id = idOf('通信費')
    service.deactivateAccount(id)
    expect(service.listAccounts({ includeInactive: true }).find((a) => a.id === id)!.status).toBe(
      'inactive'
    )
    service.reactivateAccount(id)
    expect(service.listAccounts().find((a) => a.id === id)!.status).toBe('active')
    expect(() => service.deactivateAccount(idOf('売上高'))).toThrow(
      '「売上高」は請求書の入金記録で使うため、利用停止にできません'
    )
    expect(() => service.deactivateAccount(9999)).toThrow('指定された勘定科目が見つかりません')
  })

  it('削除: 初期科目・使用済み(削除済み記録を含む)は拒否し、未使用の追加科目は削除できる', () => {
    expect(() => service.deleteAccount(idOf('通信費'))).toThrow(
      '利用済みの科目は削除できません。利用停止にしてください'
    )
    const used = service.createAccount({ name: '書籍費', kind: 'expense' }).id
    useAccount(used)
    db.sqlite.exec('UPDATE cash_records SET is_deleted = 1')
    expect(() => service.deleteAccount(used)).toThrow(AccountError)
    const free = service.createAccount({ name: '研修費', kind: 'expense' }).id
    expect(service.deleteAccount(free)).toEqual({ success: true })
    expect(service.listAccounts({ includeInactive: true }).some((a) => a.id === free)).toBe(false)
    expect(() => service.deleteAccount(free)).toThrow('指定された勘定科目が見つかりません')
  })
})
