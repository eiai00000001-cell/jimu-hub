// 【tester作成】スクリーンショット(PNG)に写ったローカルのパス(個人の絶対パス・.e2e-work)の行を、黒く塗りつぶす補助ツール(SEC-18の再発防止)。
// 文字認識(Vision)で該当行と、その直下の折り返し行(「/」「.zip」「.e2e」を含む行)の範囲を塗る。元のファイルを上書きする。
// 使い方: swiftc -O ocr-redact.swift -o <出力先>/ocr-redact && <出力先>/ocr-redact <PNGファイル...>
import Foundation
import Vision
import AppKit

let pattern = try! NSRegularExpression(pattern: "/(Users|home)/|\\.e2e-work|/var/folders|/private/tmp|jimuhub-[A-Za-z0-9-]+")
for path in CommandLine.arguments.dropFirst() {
  guard let image = NSImage(contentsOfFile: path),
        let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["ja-JP", "en-US"]
  request.usesLanguageCorrection = false
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
  let obs = (request.results ?? []).compactMap { o -> (String, CGRect)? in
    guard let s = o.topCandidates(1).first?.string else { return nil }
    return (s, o.boundingBox)
  }
  var marked = Set<Int>()
  for (i, o) in obs.enumerated() {
    let r = NSRange(o.0.startIndex..., in: o.0)
    if pattern.firstMatch(in: o.0, range: r) != nil {
      marked.insert(i)
      // 直下の折り返し行
      for (j, p) in obs.enumerated() where j != i {
        let below = p.1.maxY <= o.1.minY + 0.005 && o.1.minY - p.1.maxY < 0.03 && abs(p.1.minX - o.1.minX) < 0.15
        if below && (p.0.contains("/") || p.0.contains(".zip") || p.0.contains(".e2e")) { marked.insert(j) }
      }
    }
  }
  if marked.isEmpty { continue }
  let w = cg.width, h = cg.height
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
  ctx.setFillColor(CGColor(gray: 0.1, alpha: 1))
  for i in marked {
    let b = obs[i].1
    let rect = CGRect(x: b.minX * CGFloat(w) - 6, y: b.minY * CGFloat(h) - 6, width: b.width * CGFloat(w) + 12, height: b.height * CGFloat(h) + 12)
    ctx.fill(rect)
  }
  let rep = NSBitmapImageRep(cgImage: ctx.makeImage()!)
  try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: path))
  print("塗りつぶし: \((path as NSString).lastPathComponent) \(marked.count)行")
}
