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
  emailFormat: 'メールアドレスの形式が正しくありません'
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
  importWarning: '現在のデータがエクスポートファイルの内容で置き換わります。よろしいですか',
  importSuccess: (count: number): string => `復元が完了しました(${count}件)`,
  importParseFailure:
    '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください',
  importVersionTooNew:
    'このファイルは新しいバージョンの事務HUBで作成されたため復元できません。アプリを更新してください',
  importTransactionFailure: '復元に失敗しました。データは復元前の状態に戻しました'
} as const

export const STARTUP_MESSAGES = {
  databaseError:
    'データを読み込めませんでした。ファイルが破損している可能性があります。エクスポートファイルからの復元をお試しください'
} as const
