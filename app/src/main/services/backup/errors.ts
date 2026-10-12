/** 復元ファイルの解析エラー(形式不正・必須ファイルの欠落・不正なエントリ等) */
export class BackupParseError extends Error {}

/** 容量上限の超過(復元ファイルの大きさ・展開後の合計サイズ・空き容量不足) */
export class BackupSizeLimitError extends BackupParseError {}

/** 展開先の空き容量が不足している */
export class BackupDiskShortError extends Error {}

/** 確認時から復元ファイルが変更された(サイズ・更新日時の不一致) */
export class BackupFileChangedError extends Error {}

/** 復元ファイルが、現在のアプリより新しい版で作られている */
export class BackupVersionTooNewError extends Error {}
