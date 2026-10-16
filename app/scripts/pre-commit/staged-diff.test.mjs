import { describe, expect, it } from 'vitest'
import { parseStagedDiff } from './staged-diff.mjs'

const diff = (parts) => parts.join('\n') + '\n'

describe('parseStagedDiff', () => {
  it('追加された行を、行番号付きでファイルごとに取り出す', () => {
    const text = diff([
      'diff --git a/a.txt b/a.txt',
      'index 111..222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -3,0 +4,2 @@ context',
      '+one',
      '+two',
      '@@ -10 +12 @@',
      '-old',
      '+new'
    ])
    expect(parseStagedDiff(text)).toEqual([
      {
        path: 'a.txt',
        lines: [
          { no: 4, text: 'one' },
          { no: 5, text: 'two' },
          { no: 12, text: 'new' }
        ]
      }
    ])
  })

  it('削除のみのファイル・新規ファイルの扱い', () => {
    const text = diff([
      'diff --git a/del.txt b/del.txt',
      '--- a/del.txt',
      '+++ b/del.txt',
      '@@ -1,2 +0,0 @@',
      '-x',
      '-y',
      'diff --git a/new.txt b/new.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.txt',
      '@@ -0,0 +1 @@',
      '+hello'
    ])
    expect(parseStagedDiff(text)).toEqual([{ path: 'new.txt', lines: [{ no: 1, text: 'hello' }] }])
  })

  it('バイナリファイルは対象外', () => {
    const text = diff([
      'diff --git a/i.png b/i.png',
      'index 1..2 100644',
      'Binary files a/i.png and b/i.png differ',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -0,0 +1 @@',
      '+ok'
    ])
    expect(parseStagedDiff(text).map((f) => f.path)).toEqual(['b.txt'])
  })

  it('追加行の内容が +++ や @@ で始まっても、ファイル見出し・ハンクと誤認しない', () => {
    const text = diff([
      'diff --git a/m.md b/m.md',
      '--- a/m.md',
      '+++ b/m.md',
      '@@ -0,0 +1,2 @@',
      '+++ b/fake.txt',
      '+@@ -1 +1 @@'
    ])
    const files = parseStagedDiff(text)
    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('m.md')
    expect(files[0].lines).toEqual([
      { no: 1, text: '++ b/fake.txt' },
      { no: 2, text: '@@ -1 +1 @@' }
    ])
  })

  it('日本語・空白を含むパスと、引用符付きのパス', () => {
    const text = diff([
      'diff --git a/docs/見積 書.md b/docs/見積 書.md',
      '--- a/docs/見積 書.md',
      '+++ b/docs/見積 書.md\t',
      '@@ -0,0 +1 @@',
      '+x',
      'diff --git "a/q\\"t.md" "b/q\\"t.md"',
      '--- "a/q\\"t.md"',
      '+++ "b/q\\"t.md"',
      '@@ -0,0 +1 @@',
      '+y'
    ])
    expect(parseStagedDiff(text).map((f) => f.path)).toEqual(['docs/見積 書.md', 'q"t.md'])
  })

  it('空の出力は空配列', () => {
    expect(parseStagedDiff('')).toEqual([])
  })
})
