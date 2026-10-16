// pre-commit の独自ルール定義(詳細設計書 4.40)。
// 行単位のルールは findInLine(line)、ファイル単位のルールは findInFile(path) で検出結果の配列を返す。
// 検出結果: { text: 検出した文字列(許可リストの照合用)、shown: 表示用(一部を伏せたもの) }

export const RULE_IDS = ['personal-path', 'temp-path', 'email', 'docs-zip']

const isPlaceholder = (name) => /^[<$~{]/.test(name)

/** ユーザー名の先頭1文字のみ表示し、残りを伏せる */
const maskName = (name) => `${name.slice(0, 1)}***`

// macOS・Linux: /Users/<名前>/ または /home/<名前>/(直前は英数字・ドット・ハイフン以外)
const POSIX_HOME = /(?<![A-Za-z0-9_.-])\/(Users|home)\/([^/\s'"`<>()[\]{}$~|;,]+)(?=\/)/g
// Windows: C:\Users\<名前>(JSON内の \\ や / 区切りも含む)
const WIN_HOME = /[A-Za-z]:[\\/]+Users[\\/]+([^\\/\s'"`<>()[\]{}$~|;,]+)/g

function findPersonalPath(line) {
  const found = []
  const rePosix = new RegExp(POSIX_HOME.source, 'g')
  const reWin = new RegExp(WIN_HOME.source, 'g')
  for (const m of line.matchAll(rePosix)) {
    const name = m[2]
    if (isPlaceholder(name)) continue
    found.push({ text: m[0], shown: `/${m[1]}/${maskName(name)}` })
  }
  for (const m of line.matchAll(reWin)) {
    const name = m[1]
    if (isPlaceholder(name)) continue
    found.push({ text: m[0], shown: m[0].replace(name, maskName(name)) })
  }
  return found
}

// macOSの一時フォルダ(/var/folders/、/private/var/folders/、/private/tmp/)
const MAC_TEMP = /\/(?:private\/)?var\/folders\/|\/private\/tmp\//g
// ルート直下の tmp(直前が行頭・空白・引用符・括弧の場合のみ)
const ROOT_TMP = /(?<=^|[\s'"`([{])\/tmp\//g

function findTempPath(line) {
  const found = []
  for (const re of [MAC_TEMP, ROOT_TMP]) {
    for (const m of line.matchAll(new RegExp(re.source, 'g'))) {
      found.push({ text: m[0], shown: m[0] })
    }
  }
  return found
}

const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g
const FILE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'icns', 'bmp', 'avif',
  'css', 'scss', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'map', 'html', 'md',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'txt', 'yml', 'yaml'
]) // prettier-ignore

function isAllowedDomain(domain) {
  const d = domain.toLowerCase()
  return d === 'example.com' || d.endsWith('.example.com') || d === 'users.noreply.github.com'
}

function findEmail(line) {
  const found = []
  for (const m of line.matchAll(new RegExp(EMAIL.source, 'g'))) {
    const [full, local, domain] = m
    const tld = domain.slice(domain.lastIndexOf('.') + 1)
    // バージョン付きの名前(pkg@1.2.3)などは、末尾が英字2文字以上でないため対象外
    if (!/^[A-Za-z]{2,}$/.test(tld)) continue
    if (FILE_EXTENSIONS.has(tld.toLowerCase())) continue
    if (isAllowedDomain(domain)) continue
    // SSHの接続先(git@github.com:owner/repo)
    const next = line[m.index + full.length]
    if (local === 'git' && (next === ':' || next === '/')) continue
    found.push({ text: full, shown: `${local.slice(0, 1)}***@${domain}` })
  }
  return found
}

function findDocsZip(path) {
  return /^docs\/.+\.zip$/i.test(path) ? [{ text: path, shown: path }] : []
}

export const RULES = [
  {
    id: 'personal-path',
    description: '個人の絶対パス(ホームフォルダ配下)が含まれています',
    findInLine: findPersonalPath
  },
  {
    id: 'temp-path',
    description: 'OSの一時フォルダのパスが含まれています',
    findInLine: findTempPath
  },
  {
    id: 'email',
    description: '許可されたドメイン以外のメールアドレスが含まれています',
    findInLine: findEmail
  },
  {
    id: 'docs-zip',
    description: 'docs/ 配下にZIPファイルが追加されています',
    findInFile: findDocsZip
  }
]
