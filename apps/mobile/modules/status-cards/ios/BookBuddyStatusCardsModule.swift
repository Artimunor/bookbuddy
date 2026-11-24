import ActivityKit
import ExpoModulesCore
import Foundation
import UIKit

public final class BookBuddyStatusCardsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BookBuddyStatusCards")

    AsyncFunction("start") { (id: String, json: String) async throws -> Bool in
      try await MainActor.run {
        guard #available(iOS 16.2, *), UIApplication.shared.applicationState == .active,
              ActivityAuthorizationInfo().areActivitiesEnabled, currentActivities().isEmpty,
              let url = cardURL(json) else { return false }
        let content = try JSONDecoder().decode(StatusCardAttributes.ContentState.self, from: Data(json.utf8))
        guard content.expires > Date() else { return false }
        _ = try Activity.request(attributes: StatusCardAttributes(cardID: id, url: url),
                                 content: ActivityContent(state: content, staleDate: content.stale), pushType: nil)
        return true
      }
    }

    AsyncFunction("update") { (id: String, json: String) async throws -> Bool in
      guard #available(iOS 16.2, *), await MainActor.run(body: { UIApplication.shared.applicationState == .active }),
            let activity = currentActivities().first(where: { $0.attributes.cardID == id }) else { return false }
      let content = try JSONDecoder().decode(StatusCardAttributes.ContentState.self, from: Data(json.utf8))
      if content.expires <= Date() {
        await activity.end(nil, dismissalPolicy: .immediate)
        return false
      }
      await activity.update(ActivityContent(state: content, staleDate: content.stale))
      return true
    }

    AsyncFunction("redact") { (id: String) async -> Bool in
      guard #available(iOS 16.2, *), let activity = currentActivities().first(where: { $0.attributes.cardID == id }) else { return false }
      var content = activity.content.state
      if content.details == nil && content.staleDetails == nil { return true }
      content.details = nil
      content.staleDetails = nil
      await activity.update(ActivityContent(state: content, staleDate: content.stale))
      return true
    }

    AsyncFunction("stop") { (id: String) async in
      if #available(iOS 16.2, *) {
        for activity in Activity<StatusCardAttributes>.activities where activity.attributes.cardID == id {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
    }

    AsyncFunction("clear") { (keeping: String?) async -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
      var found = false
      for activity in Activity<StatusCardAttributes>.activities {
        if enabled, activity.attributes.cardID == keeping, activity.activityState == .active || activity.activityState == .stale {
          found = true
        } else {
          await activity.end(nil, dismissalPolicy: .immediate)
        }
      }
      return found
    }
  }
}

private struct CardLink: Decodable { let url: URL }

private func cardURL(_ json: String) -> URL? {
  guard let url = try? JSONDecoder().decode(CardLink.self, from: Data(json.utf8)).url,
        url.scheme == "bookbuddy", url.host == nil || url.host == "",
        url.path.hasPrefix("/c/jobs/") || url.path.hasPrefix("/w/shifts/") || url.path.hasPrefix("/f/cover/") else { return nil }
  return url
}

@available(iOS 16.2, *)
private func currentActivities() -> [Activity<StatusCardAttributes>] {
  Activity<StatusCardAttributes>.activities.filter { $0.activityState == .active || $0.activityState == .stale }
}
