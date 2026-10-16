// 【tester作成】スクリーンショット(PNG)に、ローカルの絶対パス・一時フォルダ・メールアドレスが写っていないかを、
// macOS標準のVisionフレームワーク(文字認識)で調べる補助ツール。SEC-18の再発防止(証跡の確認)に使う。
// 使い方: swiftc -O ocr-scan.swift -o <出力先>/ocr-scan && <出力先>/ocr-scan <PNGファイル...>
// 出力: 検出があったファイルごとに「ファイル名<TAB>種別<TAB>認識した行の一部(伏せ字)」。検出が無ければ何も出さない。
//   最後に「走査: N件、検出: M件」を標準エラーへ出す。検出があれば終了コード1。
import Foundation
import Vision
import AppKit

let patterns: [(String, String)] = [
  ("personal-path", "/(Users|home)/[^\\s/]+"),
  ("temp-path", "(/private)?/var/folders|/private/tmp|(^|\\s)/tmp/"),
  ("work-folder", "\\.e2e-work"),
  ("email", "[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)+")
]
let allowedEmail = try! NSRegularExpression(pattern: "@(([A-Za-z0-9-]+\\.)*example\\.com|users\\.noreply\\.github\\.com)\\b", options: [.caseInsensitive])

var scanned = 0
var hits = 0
for path in CommandLine.arguments.dropFirst() {
  guard let image = NSImage(contentsOfFile: path),
        let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  scanned += 1
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["ja-JP", "en-US"]
  request.usesLanguageCorrection = false
  let handler = VNImageRequestHandler(cgImage: cg, options: [:])
  try? handler.perform([request])
  let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  for line in lines {
    for (kind, pattern) in patterns {
      guard let re = try? NSRegularExpression(pattern: pattern) else { continue }
      let range = NSRange(line.startIndex..., in: line)
      for m in re.matches(in: line, range: range) {
        let text = (line as NSString).substring(with: m.range)
        if kind == "email" {
          let full = NSRange(location: 0, length: (text as NSString).length)
          if allowedEmail.firstMatch(in: text, range: full) != nil { continue }
        }
        hits += 1
        let shown = String(text.prefix(1)) + "***"
        print("\((path as NSString).lastPathComponent)\t\(kind)\t\(shown)")
      }
    }
  }
}
FileHandle.standardError.write("走査: \(scanned)件、検出: \(hits)件\n".data(using: .utf8)!)
exit(hits == 0 ? 0 : 1)
