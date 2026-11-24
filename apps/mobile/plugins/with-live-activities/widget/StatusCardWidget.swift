import ActivityKit
import SwiftUI
import WidgetKit

@main
struct StatusCardWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StatusCardAttributes.self) { context in
      CardBody(state: context.state, stale: context.isStale, link: nil)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .activityBackgroundTint(Color(red: 0.075, green: 0.102, blue: 0.086))
        .activitySystemActionForegroundColor(.white)
        .widgetURL(context.attributes.url)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.center) {
          CardBody(state: context.state, stale: context.isStale, link: context.attributes.url)
        }
      } compactLeading: {
        IslandPart(state: context.state, stale: context.isStale, clock: false)
      } compactTrailing: {
        IslandPart(state: context.state, stale: context.isStale, clock: true)
      } minimal: {
        IslandPart(state: context.state, stale: context.isStale, clock: false)
      }
      .widgetURL(context.attributes.url)
    }
  }
}

private typealias Content = StatusCardAttributes.ContentState
private typealias Surface = StatusCardAttributes.Surface

private extension Surface {
  var tint: Color {
    switch accent {
    case "lime": return Color(red: 0.78, green: 0.96, blue: 0.37)
    case "amber": return Color(red: 1, green: 0.74, blue: 0.29)
    default: return .white.opacity(0.76)
    }
  }
}

private extension Content {
  func presentation(privatePreview: Bool, stale isStale: Bool) -> (surface: Surface, details: Bool) {
    if Date() >= expires {
      let title = preview.title
      return (.init(title: title, summary: openLabel, expanded: nil, accessibilityLabel: "\(title), \(openLabel)",
                    symbol: "circle.hexagongrid.fill", accent: "quiet", progress: nil, steps: nil, timerFrom: nil, timerUntil: nil), false)
    }
    if isStale {
      if !privatePreview, let staleDetails { return (staleDetails, true) }
      return (stalePreview ?? preview, false)
    }
    if !privatePreview, let details { return (details, true) }
    return (preview, false)
  }
}

private struct CardBody: View {
  @Environment(\.redactionReasons) private var redactions
  let state: Content
  let stale: Bool
  let link: URL?

  var body: some View {
    let (surface, detailed) = state.presentation(privatePreview: redactions.contains(.privacy), stale: stale)
    VStack(alignment: .leading, spacing: 7) {
      VStack(alignment: .leading, spacing: 7) {
        HStack(alignment: .firstTextBaseline) {
          Image(systemName: surface.symbol).foregroundStyle(surface.tint).accessibilityHidden(true)
          Text(verbatim: surface.title).font(.headline).fixedSize(horizontal: false, vertical: true)
          Spacer(minLength: 6)
          CardClock(surface: surface, expires: state.expires)
        }
        if let count = surface.steps, count > 0, let progress = surface.progress {
          HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { index in
              Capsule().fill(index < progress ? surface.tint : .white.opacity(0.22)).frame(height: 3)
            }
          }.accessibilityHidden(true)
        }
        Text(verbatim: surface.summary).font(.subheadline)
        if let expanded = surface.expanded {
          Text(verbatim: expanded).font(.caption).foregroundStyle(.white.opacity(0.8))
        }
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(Text(verbatim: surface.accessibilityLabel))
      .privacySensitive(detailed)
      if let link {
        Link(destination: link) { Text(verbatim: state.openLabel).font(.caption.bold()) }
      }
    }
    .foregroundStyle(.white)
  }
}

private struct IslandPart: View {
  @Environment(\.redactionReasons) private var redactions
  let state: Content
  let stale: Bool
  let clock: Bool

  var body: some View {
    let (surface, detailed) = state.presentation(privatePreview: redactions.contains(.privacy), stale: stale)
    Group {
      if clock, surface.timerFrom != nil || surface.timerUntil != nil {
        CardClock(surface: surface, expires: state.expires)
      } else if clock {
        Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.white.opacity(0.7))
          .accessibilityLabel(Text(verbatim: state.openLabel))
      } else {
        Image(systemName: surface.symbol).foregroundStyle(surface.tint)
          .accessibilityLabel(Text(verbatim: detailed ? surface.title : "\(surface.title), \(surface.summary)"))
      }
    }
    .privacySensitive(detailed)
  }
}

private struct CardClock: View {
  let surface: Surface
  let expires: Date

  var body: some View {
    Group {
      if let from = surface.timerFrom {
        let start = Date(timeIntervalSince1970: from / 1_000)
        if start < expires {
          Text(timerInterval: start...expires, countsDown: false, showsHours: true)
        }
      } else if let until = surface.timerUntil {
        let now = Date()
        let deadline = min(expires, Date(timeIntervalSince1970: until / 1_000))
        if now < deadline {
          Text(timerInterval: now...deadline, countsDown: true, showsHours: false)
        }
      }
    }
    .font(.caption.monospacedDigit().bold())
    .foregroundStyle(surface.tint)
    .fixedSize()
    .accessibilityHidden(true)
  }
}
