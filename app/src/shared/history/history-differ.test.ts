import { describe, expect, it } from 'vitest'
import { diffSnapshots } from './history-differ'
import type { RecordSnapshot } from '../types/cash-record'

const base: RecordSnapshot = {
  recordDate: '2026-09-28',
  kind: 'expense',
  amount: 6600,
  withholdingTaxAmount: 0,
  accountId: 1,
  accountName: '通信費',
  description: 'インターネット回線(9月分)',
  clientId: null,
  clientName: null,
  paymentMethod: null,
  taxCategory: null,
  taxAmount: 0,
  invoiceId: null,
  invoiceNumber: null,
  status: 'active',
  isDeleted: false,
  receipts: []
}

describe('diffSnapshots(詳細設計書4.20章)', () => {
  it('登録(変更前なし)はすべての項目を「(なし)→値」で返す', () => {
    const changes = diffSnapshots(null, base)
    expect(changes.find((c) => c.label === '金額')).toEqual({
      label: '金額',
      before: '(なし)',
      after: '¥6,600'
    })
    expect(changes.find((c) => c.label === '種別')?.after).toBe('経費')
  })

  it('変更のあった項目のみ、日本語・円表記に整形して返す', () => {
    const after: RecordSnapshot = {
      ...base,
      paymentMethod: 'credit_card',
      taxCategory: 'standard_10',
      taxAmount: 600
    }
    expect(diffSnapshots(base, after)).toEqual([
      { label: '支払方法', before: '(未選択)', after: 'クレジットカード' },
      { label: '税区分', before: '(未選択)', after: '10%' },
      { label: '消費税額', before: '¥0', after: '¥600' }
    ])
  })

  it('状態・削除・取引先の変化を表示する', () => {
    const after: RecordSnapshot = {
      ...base,
      status: 'cancelled',
      isDeleted: true,
      clientId: 1,
      clientName: 'サンプル商事株式会社'
    }
    const labels = diffSnapshots(base, after).map((c) => [c.label, c.before, c.after])
    expect(labels).toContainEqual(['状態', '有効', '取消済'])
    expect(labels).toContainEqual(['削除', 'なし', 'あり'])
    expect(labels).toContainEqual(['取引先', '(なし)', 'サンプル商事株式会社'])
  })

  it('領収書の追加・外したを表示し、変化が無ければ項目を出さない', () => {
    const added: RecordSnapshot = {
      ...base,
      receipts: [{ id: 1, originalName: 'a.pdf', sha256: 'x', removed: false }]
    }
    expect(diffSnapshots(base, added)).toEqual([
      { label: '領収書', before: '(なし)', after: '追加: a.pdf' }
    ])
    const removed: RecordSnapshot = {
      ...base,
      receipts: [{ id: 1, originalName: 'a.pdf', sha256: 'x', removed: true }]
    }
    expect(diffSnapshots(added, removed)[0]).toMatchObject({ after: '外した: a.pdf' })
    expect(diffSnapshots(added, added)).toEqual([])
  })
})
