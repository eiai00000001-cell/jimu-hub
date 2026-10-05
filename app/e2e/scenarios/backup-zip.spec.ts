import { test, expect, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/electron-app'
import { noteEvidence, shot } from './evidence-dir'
import {
  createClientApi,
  dbQuery,
  finalizeQuoteApi,
  listFilesRecursive,
  setupCompany,
  sha256File
} from './helpers'

/**
 * 【tester作成】F-02/F-03 ZIP形式のエクスポート・復元(TC-62〜TC-66)。
 * 参照元: 詳細設計書 4.2章・4.3章・6章・8章
 * 方針: 元データを持つアプリでZIPを作成し、別の空のデータ保存先のアプリへ復元して往復の整合性を確認する。
 * 改ざん・欠落・不正ZIP等は、実際に出力されたZIPを加工して作る。
 */

const TABLE_DUMP_SQL = [
  'SELECT id,name,furigana,honorific,status FROM clients ORDER BY id',
  'SELECT id,name,address,invoice_registration_number,bank_name,account_type,account_number,account_holder FROM company_profile',
  'SELECT id,quote_number,client_id,issue_date,valid_until,remarks,subtotal_10,tax_amount_10,subtotal_8,tax_amount_8,total_amount,invoice_format,status,pdf_path,pdf_hash,pdf_hash_mismatch FROM quotes ORDER BY id',
  'SELECT quote_id,line_no,name,quantity,unit,unit_price,tax_rate,amount FROM quote_line_items ORDER BY quote_id,line_no',
  'SELECT id,invoice_number,client_id,source_quote_id,issue_date,due_date,remarks,subtotal_10,tax_amount_10,subtotal_8,tax_amount_8,total_amount,withholding_tax_amount,billing_amount,invoice_format,status,payment_status,payment_date,pdf_path,pdf_hash,pdf_hash_mismatch FROM invoices ORDER BY id',
  'SELECT invoice_id,line_no,name,quantity,unit,unit_price,tax_rate,amount,withholding_target,withholding_amount FROM invoice_line_items ORDER BY invoice_id,line_no',
  'SELECT doc_type,year,last_number FROM document_number_sequences ORDER BY doc_type,year'
]

function dump(dataDir: string): string {
  return TABLE_DUMP_SQL.map((sql) => dbQuery(dataDir, sql))
    .join('\n--\n')
    .split(dataDir)
    .join('<D>')
}

async function importViaUi(window: Page): Promise<string> {
  await window.getByRole('button', { name: 'ホーム' }).click()
  await window.getByRole('button', { name: 'データを復元' }).click()
  await window.getByRole('button', { name: 'ファイルを選択して復元' }).click()
  await window.getByRole('button', { name: '続行' }).click()
  const message = window.locator('.modal .message-success, .modal .message-error')
  await expect(message).toBeVisible()
  const text = await message.innerText()
  return text
}

async function closeModal(window: Page): Promise<void> {
  await window.getByLabel('閉じる').click()
}

test.describe.serial('F-02/F-03: ZIP形式のエクスポート・復元', () => {
  let workDir: string
  let sourceZip: string
  let sourceDump: string
  let sourceHashes: Record<string, string> // 'documents/...' -> sha256
  let launched: LaunchedApp | undefined

  test.beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'jimuhub-scenario-zip-'))
    sourceZip = join(workDir, 'source.zip')
    // 元データの作成(自社情報・取引先2件・見積書3件〔確定2・下書き1〕・請求書1件〔見積書から変換→確定→入金済み〕)
    const src = await launchApp({ JIMUHUB_E2E_EXPORT_PATH: sourceZip })
    const { window, dataDir } = src
    await setupCompany(window)
    const c1 = await createClientApi(window, 'ZIP往復商事株式会社', {
      furigana: 'ジップオウフクショウジ'
    })
    const c2 = await createClientApi(window, 'ZIP往復第二商会')
    const q1 = await finalizeQuoteApi(
      window,
      c1,
      '2026-10-02',
      [
        { name: '設計業務', quantity: 2, unit: '式', unitPrice: 400000, taxRate: 10 },
        { name: '資料(軽減)', quantity: 1, unit: '部', unitPrice: 5000, taxRate: 8 }
      ],
      '往復確認の備考'
    )
    await finalizeQuoteApi(window, c2, '2026-10-03', [
      { name: '第二の作業', quantity: 1, unitPrice: 30000, taxRate: 10 }
    ])
    await window.evaluate(
      (c) =>
        window.jimuhubApi.saveQuoteDraft({
          clientId: c,
          issueDate: '2026-10-04',
          validUntil: '',
          remarks: '',
          lineItems: [{ name: '下書き明細', quantity: 1, unit: '', unitPrice: 100, taxRate: 10 }]
        }),
      c1
    )
    const conv = await window.evaluate((id) => window.jimuhubApi.convertQuoteToInvoice(id), q1.id)
    await window.evaluate(async (id) => {
      const inv = await window.jimuhubApi.getInvoice(id)
      await window.jimuhubApi.finalizeInvoice({
        id,
        clientId: inv.clientId,
        issueDate: '2026-10-05',
        dueDate: '2026-11-30',
        remarks: inv.remarks ?? '',
        lineItems: inv.lineItems.map((l, i) => ({
          name: l.name,
          quantity: l.quantity,
          unit: l.unit ?? '',
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          withholdingTarget: i === 0
        }))
      })
      await window.jimuhubApi.updateInvoicePaymentStatus(id, {
        paymentStatus: 'paid',
        paymentDate: '2026-10-20'
      })
    }, conv.invoiceId)

    await window.getByRole('button', { name: 'データをエクスポート' }).click()
    await window.getByRole('button', { name: 'エクスポート実行' }).click()
    await expect(window.getByText(/保存しました/)).toBeVisible()
    sourceDump = dump(dataDir)
    sourceHashes = {}
    for (const f of listFilesRecursive(join(dataDir, 'documents'))) {
      sourceHashes[f.slice(dataDir.length + 1)] = sha256File(f)
    }
    await closeApp(src)
  })

  test.afterAll(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test.afterEach(async () => {
    if (launched) await closeApp(launched)
    launched = undefined
  })

  async function launchTarget(zip: string): Promise<LaunchedApp> {
    launched = await launchApp({
      JIMUHUB_E2E_IMPORT_PATH: zip,
      JIMUHUB_E2E_EXPORT_PATH: join(workDir, 'target-export.zip')
    })
    return launched
  }

  test('TC-62: ZIPの構造(data.json+PDF実体・相対パス)と、別の保存先への復元による往復の整合性', async () => {
    // --- エクスポートファイルの構造 ---
    const zip = new AdmZip(sourceZip)
    const names = zip
      .getEntries()
      .map((e) => e.entryName)
      .sort()
    const dataJson = JSON.parse(zip.getEntry('data.json')!.getData().toString('utf-8'))
    expect(dataJson.schemaVersion).toBe(4)
    expect(names).toContain('data.json')
    expect(names.filter((n) => n.startsWith('documents/') && n.endsWith('.pdf'))).toHaveLength(3)
    expect(
      names.some((n) => n.startsWith('documents/quotes/2026/2026-001_ZIP往復商事株式会社'))
    ).toBe(true)
    expect(names.some((n) => n.startsWith('documents/invoices/2026/2026-001_'))).toBe(true)
    for (const q of dataJson.data.quotes as Array<{ status: string; pdfPath: string | null }>) {
      if (q.status === 'finalized')
        expect(q.pdfPath, 'pdfPathはdocuments/始まりの相対パス').toMatch(/^documents\//)
      else expect(q.pdfPath).toBeNull()
    }
    noteEvidence(
      'TC-62',
      'エクスポートZIPのエントリ一覧とdata.jsonの要点',
      `entries:\n${names.join('\n')}\nschemaVersion=${dataJson.schemaVersion}\nquotes=${dataJson.data.quotes.length} invoices=${dataJson.data.invoices.length} clients=${dataJson.data.clients.length}\npdfPath例=${(dataJson.data.quotes[0] as { pdfPath: string }).pdfPath}`
    )

    // --- 空の保存先へ復元 ---
    const { window, dataDir } = await launchTarget(sourceZip)
    const message = await importViaUi(window)
    expect(message).toMatch(/復元が完了しました\(\d+件\)/)
    expect(message).not.toContain('改変')
    // O1修正確認: 復元成功後は警告文と「キャンセル」「続行」ボタンが非表示になる
    await expect(window.getByRole('button', { name: '続行' })).toHaveCount(0)
    await expect(
      window.getByText('現在のデータがエクスポートファイルの内容で置き換わります')
    ).toHaveCount(0)
    await shot(window, 'TC-62', '別の保存先へZIPを復元した結果(完了メッセージ)')
    await closeModal(window)

    // DB内容が元と同一(パスは保存先を正規化して比較)
    expect(dump(dataDir)).toBe(sourceDump)
    // PDF実体が復元され、SHA-256が元と一致し、pdf_pathは復元先のdocuments配下
    const restored = listFilesRecursive(join(dataDir, 'documents')).map((f) =>
      f.slice(dataDir.length + 1)
    )
    expect(restored.sort()).toEqual(Object.keys(sourceHashes).sort())
    for (const rel of restored) expect(sha256File(join(dataDir, rel)), rel).toBe(sourceHashes[rel])
    expect(
      dbQuery(
        dataDir,
        "SELECT COUNT(*) FROM quotes WHERE pdf_path LIKE '" +
          dataDir +
          "/documents/%' AND status='finalized'"
      )
    ).toBe('2')
    expect(dbQuery(dataDir, 'SELECT SUM(pdf_hash_mismatch) FROM quotes')).toBe('0')

    // 画面: 見積書・請求書の詳細に警告バッジがなく、入金状態・元見積書リンクも保持される
    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await expect(window.getByText('PDFファイルの改変が疑われます')).toHaveCount(0)
    await expect(window.getByRole('button', { name: '請求書に変換' })).toBeVisible()
    await shot(window, 'TC-62', '復元後の見積書詳細(警告なし・PDF操作が有効)')
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('cell', { name: '2026-001' }).click()
    await expect(window.getByText('入金日: 2026-10-20')).toBeVisible()
    await expect(window.getByRole('button', { name: '2026-001 を見る' })).toBeVisible()
    await shot(window, 'TC-62', '復元後の請求書詳細(入金済み・元の見積書リンク・源泉徴収)')

    // 採番が復元後も継続する: 見積書は2件発行済みなので次は003、請求書は002
    const clientId = Number(dbQuery(dataDir, 'SELECT MIN(id) FROM clients'))
    const next = await finalizeQuoteApi(window, clientId, '2026-10-10', [
      { name: '復元後の発行', quantity: 1, unitPrice: 1000, taxRate: 10 }
    ])
    expect(next.quoteNumber).toBe('2026-003')
    const nextInv = await window.evaluate(
      (c) =>
        window.jimuhubApi.finalizeInvoice({
          clientId: c,
          issueDate: '2026-10-10',
          dueDate: '',
          remarks: '',
          lineItems: [
            {
              name: 'y',
              quantity: 1,
              unit: '',
              unitPrice: 1,
              taxRate: 10,
              withholdingTarget: false
            }
          ]
        }),
      clientId
    )
    expect(nextInv.invoiceNumber).toBe('2026-002')
    noteEvidence(
      'TC-62',
      '復元後の採番継続',
      `次の見積書=${next.quoteNumber}、次の請求書=${nextInv.invoiceNumber}`
    )
  })

  function makeTamperedZip(): string {
    const out = join(workDir, 'tampered.zip')
    const zip = new AdmZip(sourceZip)
    const q1 = zip
      .getEntries()
      .find((e) => e.entryName.startsWith('documents/quotes/2026/2026-001_'))!
    zip.updateFile(q1, Buffer.concat([q1.getData(), Buffer.from('tampered')])) // 改ざん
    const inv = zip.getEntries().find((e) => e.entryName.startsWith('documents/invoices/2026/'))!
    zip.deleteFile(inv) // 欠落
    zip.writeZip(out)
    return out
  }

  test('TC-63: PDFの改ざん・欠落は復元を中断せず、該当書類のみ pdf_hash_mismatch=1 となり警告バッジが出る', async () => {
    const { window, dataDir } = await launchTarget(makeTamperedZip())
    const message = await importViaUi(window)
    expect(message).toContain('復元が完了しました')
    expect(message).toContain('PDFファイルの改変が疑われる書類が2件あります')
    await shot(window, 'TC-63', '改ざん・欠落を含むZIPの復元結果メッセージ(不一致2件)')
    await closeModal(window)
    expect(
      dbQuery(
        dataDir,
        "SELECT quote_number,pdf_hash_mismatch FROM quotes WHERE status='finalized' ORDER BY id"
      )
    ).toBe('2026-001|1\n2026-002|0')
    expect(dbQuery(dataDir, 'SELECT invoice_number,pdf_hash_mismatch FROM invoices')).toBe(
      '2026-001|1'
    )

    await window.getByRole('button', { name: '見積書・請求書' }).click()
    await window.getByRole('cell', { name: '2026-001' }).click() // 改ざんされた見積書
    await expect(window.getByText('PDFファイルの改変が疑われます')).toBeVisible()
    await shot(window, 'TC-63', '改ざんされた見積書の詳細(警告バッジ)')
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('cell', { name: '2026-002' }).click() // 無傷の見積書
    await expect(window.getByText('PDFファイルの改変が疑われます')).toHaveCount(0)
    await window.getByText('一覧へ戻る').click()
    await window.getByRole('button', { name: '請求書', exact: true }).click()
    await window.getByRole('cell', { name: '2026-001' }).click() // PDFが欠落した請求書
    await expect(window.getByText('PDFファイルの改変が疑われます')).toBeVisible()
    // 欠落したPDFを開こうとすると案内が出る(OSのアプリは起動しない)
    await window.getByRole('button', { name: 'PDFを開く' }).click()
    await expect(
      window.getByText(
        'PDFファイルが見つかりません。データは復元されていますが、PDFファイルは別途お手元のバックアップからご用意ください'
      )
    ).toBeVisible()
    await shot(
      window,
      'TC-63',
      '欠落PDFの請求書: 警告バッジと「PDFファイルが見つかりません」の案内'
    )
  })

  test('TC-64: 旧形式(JSON単体 schemaVersion 1・2)の復元。documentsには手を加えず、PDFなしの書類は案内が出る', async () => {
    const data = JSON.parse(
      new AdmZip(sourceZip).getEntry('data.json')!.getData().toString('utf-8')
    )
    // schemaVersion 2相当: pdfHashMismatchなし・pdfPathは絶対パス(復元先には存在しない)
    const v2 = structuredClone(data)
    v2.schemaVersion = 2
    for (const r of [...v2.data.quotes, ...v2.data.invoices] as Array<Record<string, unknown>>) {
      delete r.pdfHashMismatch
      if (r.pdfPath)
        r.pdfPath = '/Users/someone/Library/Application Support/事務HUB/documents/old.pdf'
    }
    const v2Path = join(workDir, 'legacy-v2.json')
    writeFileSync(v2Path, JSON.stringify(v2))
    // schemaVersion 1相当: 取引先のみ(フリガナ・自社情報・見積書なし)
    const v1 = {
      schemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: new Date().toISOString(),
      data: {
        clients: data.data.clients.map((c: Record<string, unknown>) => {
          const { furigana: _f, ...rest } = c
          void _f
          return rest
        })
      }
    }
    const v1Path = join(workDir, 'legacy-v1.json')
    writeFileSync(v1Path, JSON.stringify(v1))

    // --- v2 ---
    const dataDirMark = mkdtempSync(join(tmpdir(), 'jimuhub-mark-'))
    try {
      const { window, dataDir } = await launchTarget(v2Path)
      mkdirSync(join(dataDir, 'documents'), { recursive: true })
      writeFileSync(join(dataDir, 'documents', 'existing-marker.txt'), 'keep')
      const message = await importViaUi(window)
      expect(message).toMatch(/復元が完了しました\(\d+件\)/)
      await closeModal(window)
      // 旧形式はdocumentsに一切手を加えない
      expect(existsSync(join(dataDir, 'documents', 'existing-marker.txt'))).toBe(true)
      expect(readdirSync(join(dataDir, 'documents'))).toEqual(['existing-marker.txt'])
      // 絶対パスは採用されずNULL。状態は確定済みのまま
      expect(
        dbQuery(
          dataDir,
          'SELECT status,pdf_path IS NULL FROM quotes WHERE quote_number IS NOT NULL ORDER BY id'
        )
      ).toBe('finalized|1\nfinalized|1')
      expect(dbQuery(dataDir, 'SELECT COUNT(*) FROM quotes')).toBe('3')
      await window.getByRole('button', { name: '見積書・請求書' }).click()
      await window.getByRole('cell', { name: '2026-001' }).click()
      await window.getByRole('button', { name: 'PDFを開く' }).click()
      await expect(
        window.getByText(
          'PDFファイルが見つかりません。データは復元されていますが、PDFファイルは別途お手元のバックアップからご用意ください'
        )
      ).toBeVisible()
      await shot(
        window,
        'TC-64',
        '旧形式(v2 JSON)復元後に「PDFを開く」: PDFファイルが見つかりませんの案内'
      )
      await window.getByRole('button', { name: 'Finderで表示' }).click()
      await expect(window.getByText('PDFファイルが見つかりません')).toBeVisible()
    } finally {
      rmSync(dataDirMark, { recursive: true, force: true })
      if (launched) await closeApp(launched)
      launched = undefined
    }

    // --- v1 ---
    const t = await launchTarget(v1Path)
    const message = await importViaUi(t.window)
    expect(message).toMatch(/復元が完了しました\(\d+件\)/)
    await closeModal(t.window)
    expect(dbQuery(t.dataDir, 'SELECT COUNT(*) FROM clients')).toBe('2')
    expect(dbQuery(t.dataDir, 'SELECT COUNT(*) FROM quotes')).toBe('0')
    expect(
      dbQuery(
        t.dataDir,
        "SELECT COUNT(*) FROM clients WHERE furigana IS NOT NULL AND furigana <> ''"
      )
    ).toBe('0')
    await shot(t.window, 'TC-64', '旧形式(v1 JSON)の復元結果(取引先のみ)')
    await t.window.getByRole('button', { name: '取引先管理' }).click()
    await expect(t.window.locator('tbody tr')).toHaveCount(2)
  })

  test('TC-65: 不正なZIP・データ加工(壊れたZIP・data.json欠落・ZIPスリップ・絶対/親ディレクトリのpdfPath)は安全に扱われる', async () => {
    // (a) 壊れたZIP(先頭がPKだが中身が不正)
    const broken = join(workDir, 'broken.zip')
    writeFileSync(
      broken,
      Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.from('not a real zip body')])
    )
    // (b) data.jsonを含まないZIP
    const noData = join(workDir, 'no-data.zip')
    const z1 = new AdmZip()
    z1.addFile('readme.txt', Buffer.from('x'))
    z1.writeZip(noData)
    // (c) data.jsonがJSONではない
    const badJson = join(workDir, 'bad-json.zip')
    const z2 = new AdmZip()
    z2.addFile('data.json', Buffer.from('{ not json'))
    z2.writeZip(badJson)

    const expectedParseError =
      '選択されたファイルを読み込めませんでした。正しいエクスポートファイルかご確認ください'
    const { window, dataDir } = await launchTarget(broken)
    await createClientApi(window, '不正ZIP前の取引先')
    const before = dump(dataDir)
    expect(await importViaUi(window)).toContain(expectedParseError)
    await shot(window, 'TC-65', '壊れたZIPの復元: 読み込めませんでした')
    await closeModal(window)
    expect(dump(dataDir)).toBe(before)
    await closeApp(launched!)
    launched = undefined

    for (const [label, path] of [
      ['data.json欠落', noData],
      ['JSON不正', badJson]
    ] as const) {
      const t = await launchTarget(path)
      await createClientApi(t.window, '不正ZIP前の取引先')
      expect(await importViaUi(t.window), label).toContain(expectedParseError)
      expect(dbQuery(t.dataDir, 'SELECT COUNT(*) FROM clients'), label).toBe('1')
      await closeApp(launched!)
      launched = undefined
    }

    // (d) ZIPスリップ・pdfPath改ざん: 実際のZIPを加工する
    const evil = join(workDir, 'evil.zip')
    const z3 = new AdmZip(sourceZip)
    const entry = z3
      .getEntries()
      .find((e) => e.entryName.startsWith('documents/quotes/2026/2026-001_'))!
    const data = JSON.parse(z3.getEntry('data.json')!.getData().toString('utf-8'))
    data.data.quotes[0].pdfPath = '/etc/hosts' // 絶対パス
    data.data.quotes[1].pdfPath = 'documents/../../escape.pdf' // 親ディレクトリ参照
    data.data.invoices[0].pdfPath = '../outside.pdf'
    z3.updateFile('data.json', Buffer.from(JSON.stringify(data)))
    // adm-zipはaddFile時にエントリ名の「../」を除去してしまうため、同じ長さのダミー名で作成し、
    // ZIPのバイト列(ローカルヘッダ・セントラルディレクトリ)のエントリ名を書き換えて、不正な名前のエントリを作る
    z3.addFile('documents/aa/bb/zipslip.txt', Buffer.from('evil'))
    z3.addFile('documents/quotes/2026/cc/dd/ee/zipslip2.txt', Buffer.from('evil'))
    z3.addFile('documents/Xtmp/jimuhub-abs-zipslip.txt', Buffer.from('evil'))
    void entry
    let raw = z3.toBuffer()
    const patch = (from: string, to: string): void => {
      expect(from.length).toBe(to.length)
      const a = Buffer.from(from)
      const b = Buffer.from(to)
      let count = 0
      for (let i = raw.indexOf(a); i >= 0; i = raw.indexOf(a, i + a.length)) {
        b.copy(raw, i)
        count++
      }
      expect(count, `${from}が2か所(ローカルヘッダ・セントラルディレクトリ)に存在`).toBe(2)
    }
    raw = Buffer.from(raw)
    patch('documents/aa/bb/zipslip.txt', 'documents/../../zipslip.txt')
    patch(
      'documents/quotes/2026/cc/dd/ee/zipslip2.txt',
      'documents/quotes/2026/../../../zipslip2.txt'
    )
    patch('documents/Xtmp/jimuhub-abs-zipslip.txt', 'documents//tmp/jimuhub-abs-zipslip.txt')
    writeFileSync(evil, raw)
    const patched = new AdmZip(evil).getEntries().map((e) => e.entryName)
    expect(
      patched.some((n) => n.includes('../')),
      '不正なエントリ名(../)がZIP内に存在する'
    ).toBe(true)

    const t2 = await launchTarget(evil)
    const message = await importViaUi(t2.window)
    expect(message).toContain('復元が完了しました')
    // 書き出しは保存先のdocuments配下に限られ、親ディレクトリ等には何も作られない
    const parent = join(t2.dataDir, '..')
    expect(existsSync(join(parent, 'zipslip.txt'))).toBe(false)
    expect(existsSync(join(t2.dataDir, 'zipslip.txt'))).toBe(false)
    expect(existsSync(join(t2.dataDir, 'zipslip2.txt'))).toBe(false)
    expect(existsSync('/tmp/jimuhub-abs-zipslip.txt')).toBe(false)
    expect(existsSync(join(parent, 'escape.pdf'))).toBe(false)
    // 不正なpdfPathはNULLとなり採用されない(任意パスのファイルを開かせない)
    expect(
      dbQuery(
        t2.dataDir,
        "SELECT id,IFNULL(pdf_path,'NULL') FROM quotes WHERE id IN (1,2) ORDER BY id"
      )
    ).toBe('1|NULL\n2|NULL')
    expect(dbQuery(t2.dataDir, "SELECT IFNULL(pdf_path,'NULL') FROM invoices")).toBe('NULL')
    noteEvidence(
      'TC-65',
      'ZIPスリップ・pdfPath改ざんZIPの復元結果',
      `完了メッセージ: ${message}\n絶対パス/親ディレクトリのpdfPath→DBではNULL、親ディレクトリ・/tmpへのファイル書き出しなし(確認済み)\ndocuments配下: ${listFilesRecursive(
        join(t2.dataDir, 'documents')
      )
        .map((f) => f.slice(t2.dataDir.length + 1))
        .join(', ')}`
    )
    await shot(t2.window, 'TC-65', 'ZIPスリップ・pdfPath改ざんZIPの復元結果')
  })

  test('TC-66: 全置換(孤立PDFの削除)・退避コピー3世代(DB+documents)・失敗時のロールバックでDBとPDFが復元前に戻る', async () => {
    const { window, dataDir } = await launchTarget(sourceZip)
    await createClientApi(window, '復元前から存在する取引先')
    mkdirSync(join(dataDir, 'documents', 'quotes', '2026'), { recursive: true })
    writeFileSync(join(dataDir, 'documents', 'quotes', '2026', 'orphan.pdf'), 'orphan')

    // 1回目: 全置換(孤立PDFが消え、退避コピーに残る)
    expect(await importViaUi(window)).toMatch(/復元が完了しました/)
    await closeModal(window)
    expect(existsSync(join(dataDir, 'documents', 'quotes', '2026', 'orphan.pdf'))).toBe(false)
    expect(
      dbQuery(dataDir, "SELECT COUNT(*) FROM clients WHERE name='復元前から存在する取引先'")
    ).toBe('0')
    const backups1 = readdirSync(join(dataDir, 'backups'))
    const docBackups1 = backups1.filter((n) => !n.endsWith('.sqlite') && !n.includes('.sqlite'))
    expect(
      docBackups1.length,
      `documentsの退避コピーが作成される: ${backups1.join(', ')}`
    ).toBeGreaterThanOrEqual(1)
    const orphanInBackup = listFilesRecursive(join(dataDir, 'backups')).some((f) =>
      f.endsWith('orphan.pdf')
    )
    expect(orphanInBackup, '退避したdocumentsに復元前の孤立PDFが残る').toBe(true)

    // 4回連続の復元で、退避は直近3世代のみ
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1100)) // 退避名はタイムスタンプ(秒)のため間隔を空ける
      await importViaUi(window)
      await closeModal(window)
    }
    const names = readdirSync(join(dataDir, 'backups'))
    const dbCopies = names.filter((n) => n.startsWith('data_') || /\.sqlite$/.test(n))
    const docCopies = names.filter((n) => !dbCopies.includes(n))
    noteEvidence(
      'TC-66',
      '4回復元後のbackups/の内訳',
      `全体:\n${names.join('\n')}\nDB退避=${dbCopies.length}件 documents退避=${docCopies.length}件`
    )
    expect(dbCopies).toHaveLength(3)
    expect(docCopies).toHaveLength(3)

    // 失敗時のロールバック: data.jsonのtaxRateがCHECK制約違反(5)になる細工ZIP
    const bad = join(workDir, 'rollback.zip')
    const z = new AdmZip(sourceZip)
    const data = JSON.parse(z.getEntry('data.json')!.getData().toString('utf-8'))
    data.data.quoteLineItems[0].taxRate = 5
    z.updateFile('data.json', Buffer.from(JSON.stringify(data)))
    z.writeZip(bad)
    await closeApp(launched!)
    launched = undefined
    const t = await launchTarget(bad)
    await createClientApi(t.window, 'ロールバック確認用取引先')
    mkdirSync(join(t.dataDir, 'documents'), { recursive: true })
    writeFileSync(join(t.dataDir, 'documents', 'keep-me.txt'), 'must survive')
    const before = dump(t.dataDir)
    const message = await importViaUi(t.window)
    expect(message).toContain('復元に失敗しました。データは復元前の状態に戻しました')
    await shot(t.window, 'TC-66', 'DB制約違反で復元に失敗: 復元前の状態に戻した旨のメッセージ')
    await closeModal(t.window)
    expect(dump(t.dataDir)).toBe(before)
    expect(readFileSync(join(t.dataDir, 'documents', 'keep-me.txt'), 'utf-8')).toBe('must survive')
    expect(listFilesRecursive(join(t.dataDir, 'documents')).length).toBe(1)
    // 失敗後もそのまま操作を継続できる
    await t.window.getByRole('button', { name: '取引先管理' }).click()
    await expect(t.window.getByRole('cell', { name: 'ロールバック確認用取引先' })).toBeVisible()
  })
})
