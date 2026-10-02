import Foundation
import PDFKit
let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { print("ERR"); exit(1) }
print("PAGES:\(doc.pageCount)")
print(doc.string ?? "")
