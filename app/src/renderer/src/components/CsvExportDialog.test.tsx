// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CsvExportDialog } from './CsvExportDialog'

const year = String(new Date().getFullYear())

describe('CsvExportDialog(F-24)', () => {
  let exportCsv: ReturnType<typeof vi.fn>
  beforeEach(() => {
    exportCsv = vi.fn()
    window.jimuhubApi = { exportCsv } as unknown as Window['jimuhubApi']
  })

  it('初期値は当年1月〜12月。出力すると期間を渡し、成功時は保存先と件数を表示する(閉じるに切替)', async () => {
    exportCsv.mockResolvedValue({ success: true, filePath: '/tmp/out.csv', count: 36 })
    render(<CsvExportDialog onClose={vi.fn()} />)
    expect(screen.getByLabelText(/開始年月/)).toHaveValue(`${year}-01`)
    expect(screen.getByLabelText(/終了年月/)).toHaveValue(`${year}-12`)
    await userEvent.click(screen.getByText('出力'))
    await waitFor(() =>
      expect(exportCsv).toHaveBeenCalledWith({ fromMonth: `${year}-01`, toMonth: `${year}-12` })
    )
    expect(
      await screen.findByText('CSVを出力しました。保存先: /tmp/out.csv(36件)')
    ).toBeInTheDocument()
    expect(screen.getByText('閉じる')).toBeInTheDocument()
  })

  it('入力エラー: 未入力・終了が開始より前は項目の下に表示し、出力しない', async () => {
    render(<CsvExportDialog onClose={vi.fn()} />)
    await userEvent.clear(screen.getByLabelText(/開始年月/))
    await userEvent.click(screen.getByText('出力'))
    expect(await screen.findByText('年月を正しく入力してください')).toBeInTheDocument()
    expect(exportCsv).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(/開始年月/), '2026-12')
    await userEvent.clear(screen.getByLabelText(/終了年月/))
    await userEvent.type(screen.getByLabelText(/終了年月/), '2026-01')
    await userEvent.click(screen.getByText('出力'))
    expect(
      await screen.findByText('終了年月は、開始年月以降を指定してください')
    ).toBeInTheDocument()
    expect(exportCsv).not.toHaveBeenCalled()
  })

  it('0件の場合は案内を表示する', async () => {
    exportCsv.mockResolvedValue({
      success: false,
      reason: 'empty',
      error: '対象期間に出力する記録がありません'
    })
    render(<CsvExportDialog onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('出力'))
    expect(await screen.findByText('対象期間に出力する記録がありません')).toBeInTheDocument()
  })

  it('書き込み失敗はエラーを表示し、再試行できる。保存ダイアログのキャンセルでは何も表示しない', async () => {
    exportCsv
      .mockResolvedValueOnce({
        success: false,
        reason: 'error',
        error: 'CSVファイルの保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください'
      })
      .mockResolvedValueOnce({ success: false, reason: 'canceled' })
      .mockResolvedValueOnce({ success: true, filePath: '/tmp/a.csv', count: 1 })
    render(<CsvExportDialog onClose={vi.fn()} />)
    await userEvent.click(screen.getByText('出力'))
    expect(
      await screen.findByText(
        'CSVファイルの保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください'
      )
    ).toBeInTheDocument()
    await userEvent.click(screen.getByText('出力'))
    await waitFor(() => expect(exportCsv).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(/保存に失敗/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('出力'))
    expect(await screen.findByText(/CSVを出力しました/)).toBeInTheDocument()
  })

  it('キャンセルでダイアログを閉じる', async () => {
    const onClose = vi.fn()
    render(<CsvExportDialog onClose={onClose} />)
    await userEvent.click(screen.getByText('キャンセル'))
    expect(onClose).toHaveBeenCalled()
  })
})
