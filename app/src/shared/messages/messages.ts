/**
 * 画面に表示する文言の一元管理。
 * 参照元: 詳細設計書 8章(エラーハンドリング設計)、4章(処理フロー設計)の完了・案内メッセージ。
 * Main/Renderer双方から同じ文言を参照し、表記のゆれを防ぐ。
 */

export const VALIDATION_MESSAGES = {
  nameRequired: '取引先名称を入力してください',
  maxLength: (label: string, max: number): string => `${label}は${max}文字以内で入力してください`,
  postalCodeFormat: '郵便番号は半角数字とハイフンで入力してください(例: 123-4567)',
  phoneFormat: '電話番号は半角数字・ハイフン・括弧で入力してください',
  emailFormat: 'メールアドレスの形式が正しくありません',
  furiganaFormat: 'フリガナは全角カタカナで入力してください(ひらがなは自動的に変換されます)',
  companyNameRequired: '氏名・屋号を入力してください',
  companyAddressRequired: '住所を入力してください',
  quoteClientRequired: '取引先を選択してください',
  issueDateRequired: '発行日を入力してください',
  lineItemsRequired: '明細行を1行以上入力してください',
  lineItemNameRequired: '品名を入力してください',
  lineItemQuantityInvalid: '数量は0より大きい数値を、小数第2位までで入力してください',
  lineItemUnitPriceInvalid: '単価は0以上の整数で入力してください',
  dateInvalid: '日付は「YYYY-MM-DD」形式の正しい日付で入力してください',
  paymentDateRequired: '入金日を入力してください',
  validUntilBeforeIssueDate: '発行日より前の日付が入力されています(保存は可能です)'
} as const

export const CLIENT_MESSAGES = {
  createSuccess: '取引先を登録しました',
  updateSuccess: '取引先を更新しました',
  deactivateConfirm: '本当に利用停止にしますか',
  deactivateSuccess: '取引先を利用停止にしました',
  notFound: '指定された取引先が見つかりません',
  emptyList: '該当する取引先がありません'
} as const

export const BACKUP_MESSAGES = {
  exportSuccess: (filePath: string): string => `保存しました(保存先: ${filePath})`,
  exportFailure: '保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください',
  importIntro:
    '選択したファイルの内容で、現在のデータを復元します。復元するファイルはこの後の画面で選択できます。',
  importWarning: '現在のデータがエクスポートファイルの内容で置き換わります。よろしいですか',
  importSuccess: (count: number, pdfHashMismatchCount = 0): string =>
    pdfHashMismatchCount > 0
      ? `復元が完了しました(${count}件)。PDFファイルの改変が疑われる書類が${pdfHashMismatchCount}件あります。該当の見積書・請求書の詳細画面でご確認ください`
      : `復元が完了しました(${count}件)`,
  importParseFailure:
    '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください',
  importVersionTooNew:
    'このファイルは新しいバージョンの事務HUBで作成されたため復元できません。アプリを更新してください',
  importTransactionFailure: '復元に失敗しました。データは復元前の状態に戻しました',
  importSafeguardRestoreFailure:
    '復元に失敗した上、退避データへの復旧にも失敗しました。データが破損している可能性があります。エクスポートファイルからの復元をお試しいただくか、サポートにご連絡ください'
} as const

export const COMPANY_MESSAGES = {
  saveSuccess: '自社情報を保存しました'
} as const

export const QUOTE_MESSAGES = {
  draftSaveSuccess: '見積書を下書き保存しました',
  finalizeSuccess: 'PDFとして保存しました',
  companyProfileNotSet: '自社情報が未設定です。先に自社情報を設定してください',
  pdfSaveFailure: 'PDFの保存に失敗しました',
  draftSaveFailure: '下書きの保存に失敗しました',
  numberingFailure: '番号の採番に失敗しました。もう一度お試しください',
  notFound: '対象の見積書が見つかりません',
  finalizedNotEditable: 'PDF保存済みの見積書は編集できません',
  emptyList: '該当する見積書がありません',
  hashMismatchWarning: 'PDFファイルの改変が疑われます'
} as const

export const INVOICE_MESSAGES = {
  draftSaveSuccess: '請求書を下書き保存しました',
  finalizeSuccess: 'PDFとして保存しました',
  companyProfileNotSet: '自社情報が未設定です。先に自社情報を設定してください',
  pdfSaveFailure: 'PDFの保存に失敗しました',
  draftSaveFailure: '下書きの保存に失敗しました',
  numberingFailure: '番号の採番に失敗しました。もう一度お試しください',
  notFound: '対象の請求書が見つかりません',
  finalizedNotEditable: 'PDF保存済みの請求書は編集できません',
  emptyList: '該当する請求書がありません',
  hashMismatchWarning: 'PDFファイルの改変が疑われます',
  markAsPaidSuccess: '入金済みにしました',
  markAsUnpaidSuccess: '未収に戻しました',
  markAsUnpaidTitle: '未収に戻しますか',
  markAsUnpaidDescription: '入金日の記録はクリアされます。この操作は「はい」を押すと確定します。',
  paymentRequiresFinalized: 'PDF保存済みの請求書のみ入金ステータスを変更できます',
  convertSuccess: '見積書から請求書(下書き)を作成しました',
  convertRequiresFinalized: 'PDF保存済みの見積書のみ請求書に変換できます'
} as const

export const STARTUP_MESSAGES = {
  databaseError:
    'データを読み込めませんでした。ファイルが破損している可能性があります。エクスポートファイルからの復元をお試しください'
} as const
