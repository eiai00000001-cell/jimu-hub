import { describe, expect, it } from 'vitest'
import { ClientInputSchema } from '@shared/schemas/client.schema'
import { SAMPLE_CLIENTS } from './sample-clients'

describe('SAMPLE_CLIENTS', () => {
  it('すべてのサンプルデータがClientInputSchemaの検証を通過する', () => {
    for (const sample of SAMPLE_CLIENTS) {
      const result = ClientInputSchema.safeParse(sample)
      expect(result.success).toBe(true)
    }
  })

  it('動作確認用に複数件(5件程度)用意されている', () => {
    expect(SAMPLE_CLIENTS.length).toBeGreaterThanOrEqual(5)
  })

  it('五十音順の並び替え確認がしやすいよう、名称の先頭文字が重複しない', () => {
    const firstChars = SAMPLE_CLIENTS.map((c) => c.name.charAt(0))
    expect(new Set(firstChars).size).toBe(firstChars.length)
  })
})
