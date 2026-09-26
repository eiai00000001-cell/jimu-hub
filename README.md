# 事務HUB

個人事業主である依頼者ご本人向けの、ローカル環境専用デスクトップ業務管理アプリケーションです。本ドキュメントは案件全体を俯瞰するREADMEであり、実装コード(`app/`)・設計書(`docs/`)の入り口として参照してください。

## 1. 文書情報

- 作成日: 2026-09-26
- 対象イテレーション: イテレーション0(プロジェクト方針・基盤構築)
- 参照元: 詳細設計書.md v0.2、デザインガイド.md v0.10、コーディング規約.md v1.0(いずれも `docs/` 配下)

## 2. 実装概要

### 2.1 採用技術(基本設計書2.1章より確定済み)

| 区分 | 採用技術 |
|---|---|
| 実行環境 | Electron(Chromium + Node.js) |
| 言語 | TypeScript(Main/Renderer共通) |
| UIライブラリ | React 19 |
| ビルドツール | electron-vite(開発時) + electron-builder(配布用パッケージング) |
| ローカルDB | SQLite(better-sqlite3 + Drizzle ORM) |
| 入力バリデーション | Zod |
| データ交換形式 | JSON(スキーマバージョン番号付き) |
| テスト | Vitest + React Testing Library(単体・画面操作テスト)、Playwright(`_electron`。E2Eテスト) |

### 2.2 ディレクトリ構成

```
jimu-hub/
  app/                      … 実装コード(Electronアプリ一式。単一npmパッケージ)
    src/
      main/                   Mainプロセス(DB・Repository・Service・IPCハンドラ・エントリーポイント)
      preload/                contextBridgeで公開するAPI定義
      renderer/               Reactアプリ(components/ layout/ pages/ styles/ types/)
      shared/                 Main/Renderer共通(Zodスキーマ・型・IPCチャンネル名・メッセージ文言)
    e2e/                      Playwright E2Eテスト(fixtures/ tests/)
    package.json, tsconfig*.json, electron.vite.config.ts, electron-builder.yml,
    eslint.config.js, .prettierrc.json, vitest.config.ts, playwright.config.ts
  docs/                     … 各フェーズの成果物(00_overview 〜 10_summary)
```

各層の役割・命名規則・テスト方針等の詳細は `docs/05_develop/コーディング規約.md` を参照してください。

## 3. セットアップ手順

以下はすべて `app/` フォルダ内で実行するコマンドです。実際に実行して動作を確認済みです。

```bash
cd app
npm install          # 依存関係のインストール
```

### 起動(開発モード)

```bash
npm run dev           # electron-vite dev(ホットリロード付きで起動)
```

### ビルド(型チェック+本番ビルド)

```bash
npm run build          # tscによる型チェック → electron-vite build(out/ 配下に出力)
npm run start           # ビルド済みアプリのプレビュー起動(electron-vite preview)
```

### 配布用パッケージ(universal .dmg)の作成

```bash
npm run dist:mac        # electron-vite build → electron-builder --mac --universal
                         # release/事務HUB-<version>-universal.dmg が生成される
```

- Apple Developer Programには登録しておらず、未署名(unsigned)でビルドします(基本設計書7章・8.1章★A)。初回起動時の許可手順は、納品フェーズの操作マニュアルに記載します。
- 実際に `npm run dist:mac` を実行し、x86_64・arm64両対応のuniversal `.dmg`(約240MB)が生成されること、および生成された `.app` を直接起動してデータベースファイルが作成されウィンドウが立ち上がることを確認済みです。

### サンプルデータの投入(開発時の動作確認用、Q4回答: 通常は空の状態で起動)

```bash
npm run seed            # サンプル取引先5件を追加投入する(五十音順の確認用に先頭文字を分散済み)
npm run seed:reset       # 既存の取引先データを削除してからサンプルデータを追加する
npm run seed:clear       # 取引先データを削除するのみ
```

### テストの実行

```bash
npm run typecheck        # tsc --noEmit(Main/Preload/Shared, Renderer/Sharedの2系統)
npm run lint              # ESLint
npm run format:check       # Prettierチェック
npm run test               # Vitest(単体・画面操作テスト)を1回実行
npm run test:watch          # Vitestを監視モードで実行
```

### E2Eテストの実行(Playwright, Electronの実機起動)

```bash
npm run test:e2e          # 通常実行(ウィンドウを表示しない・高速)。ビルドを自動実行してから起動する
npm run test:e2e:headed    # 見るだけ実行(ウィンドウを表示し、操作をゆっくり再生する)
```

- 対象はローカルのみ。テスト専用の一時ディレクトリ(`JIMUHUB_DATA_DIR`)にデータ保存先を切り替えるため、本番のデータベースファイルには一切影響しません。
- OS標準のファイル保存・選択ダイアログはPlaywrightから直接操作できないため、E2Eテスト時のみ環境変数(`JIMUHUB_E2E_EXPORT_PATH`・`JIMUHUB_E2E_IMPORT_PATH`)でダイアログ表示を省略します(本番実行時はこれらの環境変数は設定されないため、通常どおりダイアログが表示されます)。

## 4. 実装状況

機能仕様書・詳細設計書のF-01〜F-08は、すべて実装済みです。

| 機能ID | 機能名 | 実装状況 | 補足 |
|---|---|---|---|
| F-01 | トップ画面(ダッシュボード) | 実装済み | サイドメニュー・取引先登録件数(利用中)表示・データ管理導線 |
| F-02 | データエクスポート | 実装済み | JSON書き出し、保存先パスを含む完了メッセージ表示 |
| F-03 | データ復元 | 実装済み | 全置換方式、復元前の自動退避コピー(直近3世代保持)、失敗時の自動復旧 |
| F-04 | 取引先の登録 | 実装済み | 入力バリデーション(Zod)、登録後は一覧画面へ遷移 |
| F-05 | 取引先の一覧表示 | 実装済み | 検索(部分一致)・並べ替え・状態フィルタ、該当0件時の案内文言 |
| F-06 | 取引先の参照(詳細表示) | 実装済み | 全項目表示、存在しないIDのエラー表示 |
| F-07 | 取引先の更新 | 実装済み | 登録画面と共通フォーム、更新後は詳細画面へ遷移 |
| F-08 | 取引先の削除(利用停止) | 実装済み | 確認ダイアログ、論理削除(状態を`inactive`に変更) |

## 5. テスト実行結果

### 5.1 単体・画面操作テスト(Vitest + React Testing Library)

- 実行コマンド: `npm run test`
- 結果: **19ファイル・114件、すべて成功**(失敗0件)
- 内訳: Main層(DB初期化・Repository・Service・IPCハンドラ・開発用CLIヘルパー)、Shared層(Zodバリデーションスキーマ)、Renderer層(共通部品・各画面・ダイアログ・ルーティング)

### 5.2 E2Eテスト(Playwright, Electron実機起動)

- 実行コマンド: `npm run test:e2e`
- 結果: **2件、すべて成功**(失敗0件)
  - 取引先管理: 新規登録した取引先が一覧・詳細画面に反映され、完了メッセージが表示されることを確認
  - データ管理: エクスポートしたファイルを復元すると、登録済みの取引先(1件)が維持されることを確認
- `npm run test:e2e:headed`(見るからに実行モード)でも同じ2件が成功することを確認済み

### 5.3 静的チェック・ビルド確認

- `npm run typecheck`: エラーなし
- `npm run lint`: エラー・警告なし
- `npm run build`: 型チェック後、Main/Preload/Rendererのビルドが成功
- `npm run dist:mac`: universal(x86_64・arm64)`.dmg`の生成に成功。生成された`.app`を直接起動し、ウィンドウ表示・データベースファイル作成を確認

## 6. 詳細設計書との差異

| No | 内容 | 理由 |
|---|---|---|
| 1 | IPCチャンネルに`app:startup-status`を追加した(詳細設計書7章のAPI一覧表には未記載) | 詳細設計書4.1章手順5・8章(データベース接続失敗時に起動エラー画面を表示する)を実現するために必要な、起動処理結果をRendererへ伝える最小限のチャンネルとして追加した。既存の`clients:*`・`data:*`チャンネルの仕様には影響しない。 |
| 2 | E2Eテスト専用の環境変数(`JIMUHUB_E2E_EXPORT_PATH`・`JIMUHUB_E2E_IMPORT_PATH`)でOS標準ダイアログの表示を省略する分岐を追加した | Playwrightから macOS のネイティブファイルダイアログを直接操作できないための、テスト専用の迂回路。環境変数が未設定の通常実行時(本番動作時)は、詳細設計書4.2章・4.3章のとおりダイアログを表示する。 |
| 3 | アプリのフォルダ構成を、案件フォルダ直下の単一フォルダ`app/`にまとめた(`backend/`・`frontend/`のような分割は行わなかった) | Main(業務ロジック)・Preload・Renderer(画面)は最終的に`electron-builder`で1つの配布物にまとめる必要があり、ビルド設定・依存関係を1つのnpmパッケージに統合した方が管理しやすいため。画面・処理フロー・API仕様自体への影響はない。 |

## 7. 要確認事項・未解決事項

| No | 内容 | 影響 | 確認方法 | 確認先 | 期限目安 |
|---|---|---|---|---|---|
| ★D1 | アプリアイコンの未設定(現状electron-builderの既定アイコンを使用) | 配布物(.app/.dmg)の見た目のみで、機能には影響しない | デザインガイド・支給素材の追加確認、またはデザインなしで進めるかの意思決定 | designer / project-leader | 納品フェーズ(deployer着手)まで |
| ★D2 | Node.jsのバージョン要件について、一部の依存パッケージ(vitest, jsdom)が推奨するバージョン(Node 22.22.2以降・24.15.0以降・26.0.0以降)と、動作確認に使用したバージョン(v25.2.1)が完全には一致しない(`npm install`時に警告が出るが、テスト・ビルドは正常に動作することを確認済み) | 現時点で機能上の問題は確認されていない | 今後のNode.jsバージョンアップ時に再度`npm run test`・`npm run build`で動作確認する | developer(次回着手時) | 次回イテレーション着手時 |

なお、詳細設計書8章・基本設計書8章からの持ち越し事項(要件定義書10.2章★7・★8・★9等)は、本書では参照のみとし、内容の重複記載は行いません。

## 8. 変更履歴

| 版数 | 日付 | 内容 |
|---|---|---|
| v1.0 | 2026-09-26 | 初版作成。イテレーション0(アプリ基盤・取引先管理・データ管理)の実装完了に伴い作成した。F-01〜F-08すべて実装済み、単体・画面操作テスト114件、E2Eテスト2件がすべて成功していることを記録した。 |
