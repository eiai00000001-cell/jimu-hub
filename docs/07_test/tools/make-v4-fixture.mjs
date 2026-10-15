#!/usr/bin/env node
/**
 * 【tester作成】スキーマ版4(イテレーション2。タグ v0.3.0)の実データ保存先を作る補助ツール。
 *
 * 目的: イテレーション3のデータベース移行(版4→版5。F-33と独立した観点)を、実際に旧版が作った構造で検証するため。
 *   旧版のスキーマは、タグ v0.3.0 の `app/src/main/db/db.ts` を git archive で一時フォルダへ取り出して使う
 *   (現行のコードで旧版のスキーマを推測せず、旧版の定義そのものを用いる)。
 * 使い方: node make-v4-fixture.mjs <リポジトリのルート> <出力先の空フォルダ(データ保存先)>
 *   出力: <出力先>/data.sqlite(スキーマ版4)、<出力先>/documents/(見積書・請求書のPDF、領収書)
 * 作業用の一時フォルダは .e2e-work/tools/ に作り、終了時(失敗時も)に削除する(詳細設計書4.41)。
 *   出力先は、呼び出し側が .e2e-work/ 配下を指定すること。
 * 全データは架空。実データには触れない。
 */
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { symlinkSync, writeFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createWorkDir, removeWorkDir } from '../../../app/test-support/work-dir.mjs'

const [repoRoot, outDirArg] = process.argv.slice(2)
if (!repoRoot || !outDirArg) {
  console.error('usage: make-v4-fixture.mjs <repo-root> <out-dir>')
  process.exit(2)
}
const repo = resolve(repoRoot)
const outDir = resolve(outDirArg)
if (readdirSync(outDir).length > 0) throw new Error('出力先は空のフォルダにしてください')

const scratch = createWorkDir('tools', 'jimuhub-v030')
try {
execFileSync('sh', ['-c', `git -C "${repo}" archive v0.3.0 app/src/main/db app/src/shared | tar -x -C "${scratch}"`])
symlinkSync(join(repo, 'app', 'node_modules'), join(scratch, 'app', 'node_modules'))
writeFileSync(
  join(scratch, 'app', 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022', baseUrl: '.', paths: { '@shared/*': ['src/shared/*'] } }
  })
)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const runner = `
import { Database } from './src/main/db/db'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const out = ${JSON.stringify(outDir)}
const sha = (b) => createHash('sha256').update(b).digest('hex')
const db = new Database(join(out, 'data.sqlite'))
db.initialize()
const s = db.sqlite
const hashRecord = (r, receipts) => sha(JSON.stringify([1, r.id, r.record_date, r.kind, r.amount, r.withholding_tax_amount, r.account_id, r.description, r.client_id, r.payment_method, r.tax_category, r.tax_amount, r.invoice_id, r.status, r.is_deleted ? 1 : 0, receipts.map((x) => [x.id, x.sha256, x.removed_at ? 1 : 0])]))
s.prepare("INSERT INTO company_profile (id,name,address,invoice_registration_number,bank_name,bank_branch,account_type,account_number,account_holder) VALUES (1,'旧版確認用事務所','東京都千代田区試験1-2-3(架空)','T1234567890123','架空銀行','試験支店','普通','1234567','シケンジムショ')").run()
s.prepare("INSERT INTO clients (name,furigana,honorific,status) VALUES ('旧版確認商事株式会社','キュウバンカクニンショウジ','御中','active')").run()
s.prepare("INSERT INTO clients (name,furigana,honorific,status) VALUES ('旧版第二商会',NULL,'様','inactive')").run()
mkdirSync(join(out, 'documents', 'quotes', '2026'), { recursive: true })
mkdirSync(join(out, 'documents', 'invoices', '2026'), { recursive: true })
mkdirSync(join(out, 'documents', 'receipts', '2026'), { recursive: true })
const qPdf = Buffer.from('%PDF-1.4\\n% fixture quote\\n')
const qPath = join(out, 'documents', 'quotes', '2026', '2026-001_旧版確認商事株式会社.pdf')
writeFileSync(qPath, qPdf)
s.prepare("INSERT INTO quotes (quote_number,client_id,issue_date,remarks,subtotal_10,tax_amount_10,total_amount,invoice_format,status,pdf_path,pdf_hash) VALUES ('2026-001',1,'2026-09-20','旧版の見積',50000,5000,55000,'qualified','finalized',?,?)").run(qPath, sha(qPdf))
s.prepare("INSERT INTO quote_line_items (quote_id,line_no,name,quantity,unit,unit_price,tax_rate,amount) VALUES (1,1,'旧版の設計',1,'式',50000,10,50000)").run()
s.prepare("INSERT INTO quotes (client_id,issue_date,subtotal_10,tax_amount_10,total_amount,status) VALUES (1,'2026-09-25',1000,100,1100,'draft')").run()
s.prepare("INSERT INTO quote_line_items (quote_id,line_no,name,quantity,unit,unit_price,tax_rate,amount) VALUES (2,1,'旧版の下書き',1,'',1000,10,1000)").run()
const iPdf = Buffer.from('%PDF-1.4\\n% fixture invoice\\n')
const iPath = join(out, 'documents', 'invoices', '2026', '2026-001_旧版確認商事株式会社.pdf')
writeFileSync(iPath, iPdf)
s.prepare("INSERT INTO invoices (invoice_number,client_id,source_quote_id,issue_date,due_date,subtotal_10,tax_amount_10,total_amount,withholding_tax_amount,billing_amount,invoice_format,status,payment_status,payment_date,pdf_path,pdf_hash) VALUES ('2026-001',1,1,'2026-09-30','2026-10-31',50000,5000,55000,5105,49895,'qualified','finalized','paid','2026-10-05',?,?)").run(iPath, sha(iPdf))
s.prepare("INSERT INTO invoice_line_items (invoice_id,line_no,name,quantity,unit,unit_price,tax_rate,amount,withholding_target,withholding_amount) VALUES (1,1,'旧版の設計',1,'式',50000,10,50000,1,5105)").run()
s.prepare("INSERT INTO document_number_sequences (year,doc_type,last_number) VALUES (2026,'quote',1),(2026,'invoice',1)").run()
const acc = (name) => s.prepare('SELECT id FROM accounts WHERE name = ?').get(name).id
const addRecord = (r, receipts) => {
  const info = s.prepare("INSERT INTO cash_records (record_date,kind,amount,withholding_tax_amount,account_id,description,client_id,payment_method,tax_category,tax_amount,invoice_id,status,is_deleted,record_hash) VALUES (@record_date,@kind,@amount,@withholding_tax_amount,@account_id,@description,@client_id,@payment_method,@tax_category,@tax_amount,@invoice_id,@status,0,'')").run(r)
  const id = Number(info.lastInsertRowid)
  const row = { ...r, id, is_deleted: 0 }
  const rs = []
  for (const f of receipts) {
    const bytes = Buffer.from(f.body)
    // DBの file_path は documents/ からの相対パス(receipts/<西暦年>/<UUID>.pdf)
    const rel = 'receipts/2026/' + f.uuid + '.pdf'
    writeFileSync(join(out, 'documents', rel), bytes)
    const ri = s.prepare("INSERT INTO receipts (record_id,original_name,file_path,mime_type,file_size,sha256) VALUES (?,?,?,?,?,?)").run(id, f.name, rel, 'application/pdf', bytes.length, sha(bytes))
    rs.push({ id: Number(ri.lastInsertRowid), sha256: sha(bytes), removed_at: null })
  }
  const h = hashRecord(row, rs)
  s.prepare('UPDATE cash_records SET record_hash=? WHERE id=?').run(h, id)
  // 履歴のスナップショットは、旧版(v0.3.0)のRecordSnapshotと同じ構造(キャメルケース)で記録する
  const accountName = s.prepare('SELECT name FROM accounts WHERE id = ?').get(r.account_id).name
  const clientName = r.client_id ? s.prepare('SELECT name FROM clients WHERE id = ?').get(r.client_id).name : null
  const snapshot = {
    recordDate: r.record_date, kind: r.kind, amount: r.amount, withholdingTaxAmount: r.withholding_tax_amount,
    accountId: r.account_id, accountName, description: r.description, clientId: r.client_id, clientName,
    paymentMethod: r.payment_method, taxCategory: r.tax_category, taxAmount: r.tax_amount,
    invoiceId: r.invoice_id, invoiceNumber: r.invoice_id ? '2026-001' : null, status: r.status, isDeleted: false,
    receipts: rs.map((x, i) => ({ id: x.id, originalName: receipts[i].name, sha256: x.sha256, removed: false }))
  }
  s.prepare("INSERT INTO cash_record_history (record_id,operation,reason,snapshot_before,snapshot_after,record_hash_after) VALUES (?,?,?,?,?,?)").run(id, 'create', null, null, JSON.stringify(snapshot), h)
}
addRecord({ record_date: '2026-10-05', kind: 'income', amount: 49895, withholding_tax_amount: 5105, account_id: acc('売上高'), description: '請求書 2026-001 の入金', client_id: 1, payment_method: null, tax_category: null, tax_amount: 0, invoice_id: 1, status: 'active' }, [])
addRecord({ record_date: '2026-10-02', kind: 'expense', amount: 5500, withholding_tax_amount: 0, account_id: acc('通信費'), description: '旧版の通信費(領収書あり)', client_id: null, payment_method: 'cash', tax_category: 'standard_10', tax_amount: 500, invoice_id: null, status: 'active' }, [{ name: 'receipt_fixture.pdf', uuid: '${randomUUID()}', body: '%PDF-1.4\\n% fixture receipt\\n' }])
addRecord({ record_date: '2026-10-03', kind: 'expense', amount: 1100, withholding_tax_amount: 0, account_id: acc('消耗品費'), description: '旧版の消耗品費', client_id: null, payment_method: null, tax_category: 'standard_10', tax_amount: 100, invoice_id: null, status: 'active' }, [])
// 付属ファイル(-wal・-shm)を残さないため、ジャーナルモードを戻してから閉じる(次回の起動時にアプリがWALへ切り替える)
db.sqlite.pragma('wal_checkpoint(TRUNCATE)')
db.sqlite.pragma('journal_mode = DELETE')
const version = db.sqlite.prepare("SELECT value FROM app_meta WHERE key='schema_version'").get().value
db.close()
console.log('schema_version=' + version)
`
writeFileSync(join(scratch, 'app', 'run-fixture.ts'), runner)
execFileSync(join(repo, 'app', 'node_modules', '.bin', 'tsx'), ['--tsconfig', join(scratch, 'app', 'tsconfig.json'), join(scratch, 'app', 'run-fixture.ts')], {
  cwd: join(scratch, 'app'),
  stdio: 'inherit'
})
void sha
void randomUUID
} finally {
  removeWorkDir(scratch)
}
