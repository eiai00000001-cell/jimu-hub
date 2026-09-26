import type { ClientInput } from '@shared/schemas/client.schema'

/**
 * 動作確認用のサンプル取引先データ(架空の名称)。
 * `npm run seed` / `npm run seed:reset` でのみ投入され、通常起動時には登録されない(Q4回答반영)。
 * 一覧の五十音順並べ替え・検索絞り込みを確認しやすいよう、名称の先頭文字を意図的に分散させている。
 */
export const SAMPLE_CLIENTS: ClientInput[] = [
  {
    name: 'あおぞらデザイン合同会社',
    honorific: '御中',
    contactPerson: '青山葵',
    postalCode: '150-0001',
    address: '東京都渋谷区神宮前1-1-1',
    phone: '03-1111-2222',
    email: 'aoyama@example.com',
    invoiceRegistrationNumber: 'T1000000000001',
    memo: 'サンプルデータ(seedコマンドで投入)'
  },
  {
    name: 'かがやき工業株式会社',
    honorific: '様',
    contactPerson: '川田一輝',
    postalCode: '541-0041',
    address: '大阪府大阪市中央区北浜1-2-3',
    phone: '06-2222-3333',
    email: 'kawada@example.com',
    invoiceRegistrationNumber: 'T1000000000002',
    memo: 'サンプルデータ(seedコマンドで投入)'
  },
  {
    name: 'さくら商事株式会社',
    honorific: '(なし)',
    contactPerson: '佐々木さくら',
    postalCode: '060-0001',
    address: '北海道札幌市中央区北一条1-1',
    phone: '011-333-4444',
    email: 'sasaki@example.com',
    invoiceRegistrationNumber: '',
    memo: 'サンプルデータ(seedコマンドで投入)'
  },
  {
    name: 'たいよう建築事務所',
    honorific: '御中',
    contactPerson: '田中太陽',
    postalCode: '460-0002',
    address: '愛知県名古屋市中区丸の内1-1-1',
    phone: '052-444-5555',
    email: '',
    invoiceRegistrationNumber: '',
    memo: 'サンプルデータ(seedコマンドで投入・利用停止の表示確認用)'
  },
  {
    name: 'なかよし文具株式会社',
    honorific: '様',
    contactPerson: '中村よし子',
    postalCode: '810-0001',
    address: '福岡県福岡市中央区天神1-1-1',
    phone: '092-555-6666',
    email: 'nakamura@example.com',
    invoiceRegistrationNumber: 'T1000000000005',
    memo: 'サンプルデータ(seedコマンドで投入)'
  }
]
