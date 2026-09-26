import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from '../db/db'
import { ClientRepository } from '../repositories/client.repository'
import { ClientService } from '../services/client.service'
import { resolveUserDataDir } from './data-dir'
import { SAMPLE_CLIENTS } from './sample-clients'

/**
 * 動作確認用のサンプルデータ投入CLI(Q4回答: 普段は空の状態で起動し、必要な時だけコマンドで追加する)。
 *
 *   npm run seed        … サンプルデータを追加する(既存データは残す)
 *   npm run seed:reset   … 既存の取引先データを削除してからサンプルデータを追加する
 *   npm run seed:clear    … 既存の取引先データを削除するのみ(E2Eテストの後片付け等に使用)
 *
 * 本番の利用者データには影響しない。対象は常にアプリの通常の保存先(またはJIMUHUB_DATA_DIR指定先)であり、
 * アプリ自身のRepository/Service層を経由してのみデータを作成・削除する(DBファイルを直接編集しない)。
 */
function main(): void {
  const shouldReset = process.argv.includes('--reset')
  const clearOnly = process.argv.includes('--clear')

  const dataDir = resolveUserDataDir()
  mkdirSync(dataDir, { recursive: true })
  const dbFilePath = join(dataDir, 'data.sqlite')

  const database = new Database(dbFilePath)
  database.initialize()
  const repository = new ClientRepository(database)
  const service = new ClientService(repository)

  try {
    if (clearOnly) {
      repository.deleteAll()
      console.log(`取引先データを削除しました(保存先: ${dbFilePath})`)
      return
    }

    if (shouldReset) {
      repository.deleteAll()
    }

    for (const input of SAMPLE_CLIENTS) {
      service.createClient(input)
    }

    console.log(`サンプルデータを${SAMPLE_CLIENTS.length}件登録しました(保存先: ${dbFilePath})`)
  } finally {
    database.close()
  }
}

main()
