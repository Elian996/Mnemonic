import Foundation
import Vision

struct OcrLine: Encodable {
  let text: String
  let confidence: Float
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

guard CommandLine.arguments.count >= 2 else {
  FileHandle.standardError.write("missing image path\n".data(using: .utf8)!)
  exit(2)
}

let imageUrl = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US", "zh-Hans"]
if #available(macOS 13.0, *) {
  request.automaticallyDetectsLanguage = true
}

let handler = VNImageRequestHandler(url: imageUrl, options: [:])
try handler.perform([request])

let lines = (request.results ?? []).compactMap { observation -> OcrLine? in
  guard let candidate = observation.topCandidates(1).first else { return nil }
  let box = observation.boundingBox
  return OcrLine(
    text: candidate.string,
    confidence: candidate.confidence,
    x: box.origin.x,
    y: box.origin.y,
    width: box.size.width,
    height: box.size.height
  )
}

let data = try JSONEncoder().encode(lines)
FileHandle.standardOutput.write(data)
