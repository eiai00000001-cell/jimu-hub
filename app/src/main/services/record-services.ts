import type { Database } from '../db/db'
import { AccountRepository } from '../repositories/account.repository'
import { CashRecordHistoryRepository } from '../repositories/cash-record-history.repository'
import { CashRecordRepository } from '../repositories/cash-record.repository'
import { ClientRepository } from '../repositories/client.repository'
import { ReceiptRepository } from '../repositories/receipt.repository'
import { CashRecordService } from './cash-record.service'
import { IntegrityService } from './integrity/integrity.service'
import { RecordHistoryService } from './record-history.service'

/** 入出金・経費まわりのService群を組み立てる(index.tsの依存組み立て用) */
export function createRecordServices(database: Database): {
  cashRecordService: CashRecordService
  historyService: RecordHistoryService
} {
  const repository = new CashRecordRepository(database)
  const receiptRepository = new ReceiptRepository(database)
  const historyRepository = new CashRecordHistoryRepository(database)
  const historyService = new RecordHistoryService(historyRepository)
  const cashRecordService = new CashRecordService({
    database,
    repository,
    receiptRepository,
    accountRepository: new AccountRepository(database),
    clientRepository: new ClientRepository(database),
    historyService,
    integrityService: new IntegrityService(repository, receiptRepository, historyRepository)
  })
  return { cashRecordService, historyService }
}
