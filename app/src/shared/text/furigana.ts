/**
 * フリガナ入力の変換・検証ユーティリティ。
 * 参照元: コーディング規約.md 7.2章(全角カタカナ限定+ひらがな自動変換。詳細設計書v1.3からの追加制約)
 *
 * Renderer(入力中のリアルタイム変換)・shared(Zodスキーマでの最終検証)の双方から参照する。
 */

const HIRAGANA_RANGE = /[ぁ-ゖゝゞ]/g

/** ひらがな1文字を対応する全角カタカナへ変換する(Unicode上、カタカナはひらがなの+0x60) */
function hiraganaCharToKatakana(char: string): string {
  return String.fromCharCode(char.charCodeAt(0) + 0x60)
}

/** 入力文字列中のひらがなを全角カタカナへ変換する(カタカナ・その他の文字はそのまま) */
export function convertHiraganaToKatakana(value: string): string {
  return value.replace(HIRAGANA_RANGE, hiraganaCharToKatakana)
}

/** 全角カタカナ(長音符・繰り返し記号を含む)のみで構成されているかどうか(空文字は許容) */
export const FURIGANA_PATTERN = /^[ァ-ヺーヽヾ]*$/

export function isValidFurigana(value: string): boolean {
  return FURIGANA_PATTERN.test(value)
}
