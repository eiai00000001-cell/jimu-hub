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
  dateRangeInvalid: '発行日の終了日は、開始日以降の日付を入力してください',
  amountRangeInvalid: '金額の上限は、下限以上の金額を入力してください',
  dateInvalid: '日付は「YYYY-MM-DD」形式の正しい日付で入力してください',
  paymentDateRequired: '入金日を入力してください',
  validUntilBeforeIssueDate: '発行日より前の日付が入力されています(保存は可能です)'
} as const

export const NAVIGATION_MESSAGES = {
  confirmLeave: '入力中の内容は保存されません。この画面を離れてよろしいですか'
} as const

export const CLIENT_MESSAGES = {
  createSuccess: '取引先を登録しました',
  updateSuccess: '取引先を更新しました',
  deactivateConfirm: '本当に利用停止にしますか',
  deactivateSuccess: '取引先を利用停止にしました',
  confirmReactivate: 'この取引先を利用中に戻します。よろしいですか',
  reactivateSuccess: '取引先を利用中に戻しました',
  alreadyActive: '既に「利用中」の取引先です',
  notFound: '指定された取引先が見つかりません',
  emptyList: '該当する取引先がありません'
} as const

export const ACCOUNT_MESSAGES = {
  nameRequired: '科目の名称を入力してください',
  nameTooLong: '科目の名称は30文字以内で入力してください',
  nameDuplicated: '同じ区分に同じ名称の科目があります',
  deactivateBlocked: '「売上高」は請求書の入金記録で使うため、利用停止にできません',
  inUse: '利用済みの科目は削除できません。利用停止にしてください',
  notFound: '指定された勘定科目が見つかりません',
  confirmDeactivateTitle: '勘定科目を利用停止にしますか',
  confirmDeactivate: (name: string): string =>
    `「${name}」を利用停止にします。登録済みの記録はそのまま残り、新しい記録の選択肢には表示されなくなります。`,
  confirmDelete: (name: string): string => `「${name}」を削除します。よろしいですか`
} as const

export const RECORD_MESSAGES = {
  dateRequired: '日付を入力してください',
  dateOutOfRange: '日付は2000年〜2099年の範囲で入力してください',
  amountInvalid: '金額は1円以上9,999,999,999円以下の整数で入力してください',
  accountRequired: '勘定科目を選択してください',
  descriptionRequired: '摘要・メモを入力してください',
  descriptionTooLong: '摘要・メモは200文字以内で入力してください',
  reasonTooLong: '変更理由は200文字以内で入力してください',
  dateRangeInvalid: '日付の終了日は、開始日以降の日付を入力してください',
  accountKindMismatch: '勘定科目が種別と一致しません',
  inactiveNotSelectable: '利用停止中の勘定科目・取引先は選択できません',
  notFound: '対象の記録が見つかりません',
  notEditable: '取消済の記録は編集できません',
  autoRecordFieldLocked: '請求書から作成された入金記録の種別・金額・取引先は変更できません',
  autoRecordDeleteBlocked: '請求書側で入金済みを取り消すと、この入金記録は取消済になります',
  historyWriteFailure: '履歴を記録できなかったため、変更できませんでした',
  noChange: '変更はありません',
  invoiceRecordExists: 'この請求書には、有効な入金記録が既にあります',
  createSuccess: '記録を登録しました',
  updateSuccess: '記録を更新しました',
  deleteSuccess: '記録を削除しました',
  emptyList: '該当する記録がありません',
  recordHashWarning: 'この記録の改変が疑われます',
  confirmDeleteTitle: 'この記録を削除しますか',
  confirmDeleteDescription:
    '削除した記録は一覧・集計・CSVには表示されなくなります。履歴には残り、元に戻すことはできません。'
} as const

export const RECEIPT_MESSAGES = {
  typeInvalid: '領収書として添付できるのは、PDF・JPEG・PNGのファイルです',
  tooLarge: '領収書は1ファイル10MBまでです',
  countExceeded: '領収書は1つの記録につき5件までです',
  tokenDuplicated: '同じ領収書が重複して指定されています',
  removeInvalid: '外す領収書の指定が正しくありません',
  tokenInvalid: '選択したファイルが無効になりました。もう一度ファイルを選択してください',
  storeFailure: '領収書の保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください',
  notFound:
    '領収書ファイルが見つかりません。データは復元されていますが、領収書ファイルは別途お手元のバックアップからご用意ください',
  mismatchWarning: 'ファイルの改変が疑われます',
  missingWarning: 'ファイルが見つかりません',
  openMismatchConfirm:
    'このファイルは、保存時から変更されているか、領収書として読み取れない可能性があります(改変が疑われます)。それでも開きますか?',
  unreadableWarning: '画像を表示できません。「開く」でご確認ください',
  pdfNotPreviewable: 'PDFはアプリ内では表示できません。「開く(OS標準アプリ)」でご確認ください'
} as const

export const CSV_MESSAGES = {
  monthInvalid: '年月を正しく入力してください',
  monthRangeInvalid: '終了年月は、開始年月以降を指定してください',
  empty: '対象期間に出力する記録がありません',
  writeFailure: 'CSVファイルの保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください',
  success: (filePath: string, count: number): string =>
    `CSVを出力しました。保存先: ${filePath}(${count}件)`
} as const

export const BACKUP_MESSAGES = {
  pdfNotFound:
    'PDFファイルが見つかりません。データは復元されていますが、PDFファイルは別途お手元のバックアップからご用意ください',
  exportSuccess: (filePath: string): string => `保存しました(保存先: ${filePath})`,
  exportFailure: '保存に失敗しました。保存先の空き容量・書き込み権限をご確認ください',
  importIntro:
    '選択したファイルの内容で、現在のデータを復元します。復元するファイルはこの後の画面で選択できます。',
  importWarning: '現在のデータがエクスポートファイルの内容で置き換わります。よろしいですか',
  importSuccess: (
    count: number,
    pdfHashMismatchCount = 0,
    receiptHashMismatchCount = 0,
    recordHashMismatchCount = 0
  ): string => {
    const warnings: string[] = []
    if (pdfHashMismatchCount > 0) {
      warnings.push(
        `PDFファイルの改変が疑われる書類が${pdfHashMismatchCount}件あります。該当の見積書・請求書の詳細画面でご確認ください`
      )
    }
    if (receiptHashMismatchCount > 0) {
      warnings.push(
        `領収書ファイルの改変・欠落が疑われるものが${receiptHashMismatchCount}件あります。該当の入出金・経費の詳細画面でご確認ください`
      )
    }
    if (recordHashMismatchCount > 0) {
      warnings.push(
        `記録の改変が疑われる入出金・経費が${recordHashMismatchCount}件あります。該当の詳細画面でご確認ください`
      )
    }
    return warnings.length > 0
      ? `復元が完了しました(${count}件)。${warnings.join('。')}`
      : `復元が完了しました(${count}件)`
  },
  warnLargeBackup:
    '領収書の容量が大きいため、このファイルは復元できない可能性があります。続行しますか',
  exportTooLarge:
    '領収書・PDFの容量が復元できる上限(1GB)を超えるため、エクスポートを中止しました。復元できないファイルになってしまうため、書き出していません',
  exportPacking: 'ファイルを整理しています…',
  exportProgress: (current: number, total: number): string =>
    `領収書を書き出しています(${current}/${total})`,
  importProgress: (current: number, total: number): string =>
    `領収書・PDFを復元しています(${current}/${total})`,
  importParseFailure:
    '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください',
  importTooLarge: 'ファイルの容量が復元できる上限(1GB)を超えているため、読み込めませんでした',
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
  hashMismatchWarning: 'PDFファイルの改変が疑われます',
  confirmDeleteDraft: 'この下書きを削除します。削除すると元に戻せません。よろしいですか',
  deleteDraftSuccess: '下書きを削除しました',
  finalizedNotDeletable: 'PDF保存済みの見積書は削除できません',
  hasDerivedInvoice: 'この見積書から作成された請求書があるため削除できません'
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
  confirmDeleteDraft: 'この下書きを削除します。削除すると元に戻せません。よろしいですか',
  deleteDraftSuccess: '下書きを削除しました',
  finalizedNotDeletable: 'PDF保存済みの請求書は削除できません',
  hasCashRecord: 'この請求書に紐づく入金記録があるため削除できません',
  paymentRecordCreateFailure: '入金記録を作成できなかったため、入金済みにできませんでした',
  paymentRecordCancelFailure: '入金記録を取消できなかったため、未収に戻せませんでした',
  markAsPaidSuccess: '入金済みにしました',
  markAsUnpaidSuccess: '未収に戻しました',
  markAsUnpaidTitle: '未収に戻しますか',
  markAsUnpaidDescription:
    '入金済みを取り消します。連動する入金記録は「取消済」として残ります。入金日の記録はクリアされます。',
  paymentRequiresFinalized: 'PDF保存済みの請求書のみ入金ステータスを変更できます',
  convertSuccess: '見積書から請求書(下書き)を作成しました',
  convertRequiresFinalized: 'PDF保存済みの見積書のみ請求書に変換できます'
} as const

export const STARTUP_MESSAGES = {
  databaseError:
    'データを読み込めませんでした。ファイルが破損している可能性があります。エクスポートファイルからの復元をお試しください'
} as const
