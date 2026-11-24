import ActivityKit
import Foundation

@available(iOS 16.2, *)
struct StatusCardAttributes: ActivityAttributes {
  let cardID: String
  let url: URL

  struct Surface: Codable, Hashable {
    let title: String
    let summary: String
    let expanded: String?
    let accessibilityLabel: String
    let symbol: String
    let accent: String
    let progress: Int?
    let steps: Int?
    let timerFrom: Double?
    let timerUntil: Double?
  }

  struct ContentState: Codable, Hashable {
    let expiresAt: Double
    let staleAt: Double
    let openLabel: String
    let preview: Surface
    var details: Surface?
    let stalePreview: Surface?
    var staleDetails: Surface?

    var expires: Date { Date(timeIntervalSince1970: expiresAt / 1_000) }
    var stale: Date { Date(timeIntervalSince1970: min(staleAt, expiresAt) / 1_000) }
  }
}
