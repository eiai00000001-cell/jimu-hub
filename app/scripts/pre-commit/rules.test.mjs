import { describe, expect, it } from 'vitest'
import { RULES } from './rules.mjs'

// 検出対象の文字列は連結して組み立てる(このファイル自身が検出されないようにする)
const U = 'Us' + 'ers'
const H = 'ho' + 'me'
const find = (id, line) => RULES.find((r) => r.id === id).findInLine(line)

describe('personal-path', () => {
  it('macOSのホームフォルダ配下を検出し、ユーザー名を伏せて表示する', () => {
    const hits = find('personal-path', `cd /${U}/alice/Projects/x`)
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe(`/${U}/alice`)
    expect(hits[0].shown).toBe(`/${U}/a***`)
  })

  it('Linuxのホームフォルダ配下とWindowsのユーザーフォルダ配下を検出する', () => {
    expect(find('personal-path', `path=/${H}/bob/app`)).toHaveLength(1)
    expect(find('personal-path', 'C:' + '\\' + U + '\\carol\\Desktop')).toHaveLength(1)
    expect(find('personal-path', 'C:' + '\\\\' + U + '\\\\carol\\\\x')).toHaveLength(1)
  })

  it('プレースホルダ(<…>・$…・{…}・~)は対象外', () => {
    for (const name of ['<user>', '$USER', '{user}', '~']) {
      expect(find('personal-path', `/${U}/${name}/Projects`)).toEqual([])
    }
    expect(find('personal-path', 'C:' + '\\' + U + '\\<name>\\x')).toEqual([])
  })

  it('ホームフォルダを含まない文言・パスは対象外', () => {
    expect(find('personal-path', 'ユーザーのホームフォルダ')).toEqual([])
    expect(find('personal-path', `src/${U}/list.ts`)).toEqual([])
    expect(find('personal-path', `/${U}/`)).toEqual([])
  })
})

describe('temp-path', () => {
  it('macOSの一時フォルダとルート直下のtmpを検出する', () => {
    expect(find('temp-path', '/var' + '/folders/ab/cd/T/x')).toHaveLength(1)
    expect(find('temp-path', '/private' + '/var/folders/ab/T/')).toHaveLength(1)
    expect(find('temp-path', '/private' + '/tmp/claude/x')).toHaveLength(1)
    expect(find('temp-path', 'cd "/tm' + 'p/work"')).toHaveLength(1)
    expect(find('temp-path', '/tm' + 'p/x')).toHaveLength(1)
  })

  it('文言・アプリの一時フォルダ名・データフォルダ配下のtmpは対象外', () => {
    expect(find('temp-path', 'OSの一時フォルダに作成する')).toEqual([])
    expect(find('temp-path', 'jimuhub-pdf-tmp を使う')).toEqual([])
    expect(find('temp-path', '<userData>/tm' + 'p/')).toEqual([])
    expect(find('temp-path', '事務HUB/tm' + 'p/')).toEqual([])
    expect(find('temp-path', 'a/tm' + 'p/')).toEqual([])
    expect(find('temp-path', '/tm' + 'p')).toEqual([]) // 末尾が / で区切られていない
  })
})

describe('email', () => {
  it('許可外のドメインを検出し、ローカル部の先頭1文字のみ表示する', () => {
    const hits = find('email', 'contact: taro.yamada' + '@mail-sample.jp')
    expect(hits).toHaveLength(1)
    expect(hits[0].shown).toBe('t***' + '@mail-sample.jp')
  })

  it('example.com(サブドメインを含む)とusers.noreply.github.comは対象外', () => {
    expect(find('email', 'a' + '@example.com')).toEqual([])
    expect(find('email', 'a' + '@mail.example.com')).toEqual([])
    expect(find('email', '123+name' + '@users.noreply.github.com')).toEqual([])
  })

  it('画像・ソース等の拡張子、バージョン付きの名前、SSH接続先は対象外', () => {
    expect(find('email', 'icon' + '@2x.png')).toEqual([])
    expect(find('email', 'import x from "a' + '@b.ts"')).toEqual([])
    expect(find('email', 'lodash' + '@4.17.21')).toEqual([])
    expect(find('email', 'git' + '@github.com:owner/repo.git')).toEqual([])
  })

  it('example.comに似た別ドメインは検出する', () => {
    expect(find('email', 'a' + '@notexample.com')).toHaveLength(1)
    expect(find('email', 'a' + '@example.com.evil.jp')).toHaveLength(1)
  })
})

describe('docs-zip', () => {
  const rule = RULES.find((r) => r.id === 'docs-zip')
  it('docs/配下の.zip(大文字小文字を問わない)を検出する', () => {
    expect(rule.findInFile('docs/09_deploy/a.zip')).toHaveLength(1)
    expect(rule.findInFile('docs/07_test/evidence/B.ZIP')).toHaveLength(1)
  })
  it('docs/以外のzip、docs/配下の他の拡張子は対象外', () => {
    expect(rule.findInFile('app/resources/a.zip')).toEqual([])
    expect(rule.findInFile('docs/a.md')).toEqual([])
    expect(rule.findInFile('docs/zip.txt')).toEqual([])
  })
})
