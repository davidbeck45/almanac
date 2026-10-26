import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Scentcast popup: what to wear now, why, and the week ahead. The picks come
// from widget.mjs, which runs the site's engine in Node.
Panel {
  id: root
  moduleName: "doeszen.scentcast"
  ipcTarget: "doeszen.scentcast"
  manageIpc: false

  property var anchorItem: null
  property bool openedFromHotkey: false

  // The bar tracks BarWidget.qml, not this nested panel, so the popout
  // coordinator has to see that widget as the owner.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.4)
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // ---- Data. The last good report stays up while a refresh runs or fails.
  property var report: null
  property string error: ""
  property real fetchedAt: 0
  property bool rerun: false

  readonly property var pick: report ? report.now : null
  readonly property var days: report ? report.days : []
  readonly property var place: report ? report.place : null
  readonly property string tooltip: pick ? pick.label + ": " + pick.name + " · " + pick.brand : (error || "Scentcast")

  readonly property string siteUrl: "https://davidbeck45.github.io/scentcast/"
  readonly property string scriptPath: decodeURIComponent(String(Qt.resolvedUrl("widget.mjs")).replace(/^file:\/\//, ""))
  readonly property int refreshMinutes: Math.max(5, parseInt(setting("refreshMinutes", 30), 10) || 30)

  // No `hidden` setting means the site's defaults, like a device that never
  // opened Manage; an empty one hides nothing. `journal` is the app's Copy
  // for Claude or a journal file, so the plan skips what was just worn.
  readonly property var args: {
    var out = [root.scriptPath]
    var location = String(setting("location", "")).trim()
    if (location) out.push("--location", location)
    var hidden = setting("hidden", null)
    if (hidden !== null) out.push("--hidden", Array.isArray(hidden) ? hidden.join(",") : String(hidden))
    var journal = String(setting("journal", "")).trim()
    if (journal) out.push("--journal", journal)
    return out
  }
  readonly property string argsKey: JSON.stringify(args)
  onArgsKeyChanged: refresh()

  // Engine temperatures are °F; only display converts.
  readonly property bool fahrenheit: {
    var unit = String(setting("units", "auto")).toUpperCase()
    if (unit === "F" || unit === "C") return unit === "F"
    var country = place && place.country ? String(place.country).toUpperCase() : ""
    if (country) return country === "US" || country === "LR" || country === "MM"
    return /^en[_-]US/.test(Qt.locale().name)
  }

  function temp(f) {
    return Math.round(fahrenheit ? f : (f - 32) * 5 / 9) + "°"
  }

  function weatherGlyph(category, night) {
    switch (category) {
      case "clear": return night ? "" : ""
      case "partly": return night ? "" : ""
      case "fog": return night ? "" : ""
      case "drizzle": return night ? "" : ""
      case "rain": return ""
      case "snow": return ""
      case "storm": return ""
      default: return ""
    }
  }

  function conditionLine(p) {
    var parts = [p.condition, "feels " + temp(p.feelsF), p.humidity + "% humidity"]
    if (p.rainChance >= 30) parts.push(p.rainChance + "% rain")
    return parts.join(" · ")
  }

  function statusLine() {
    if (!report) return proc.running ? "Updating…" : ""
    var where = place ? place.name : ""
    if (proc.running) return where + " · updating…"
    if (error) return where + " · " + error
    var line = where + " · " + Qt.formatTime(new Date(report.updated), "HH:mm")
    return report.journalNote ? line + " · " + report.journalNote : line
  }

  function refresh() {
    if (proc.running) {
      rerun = true
      return
    }
    proc.command = ["bash", "-c",
      "command -v node >/dev/null || { echo 'Scentcast needs Node.js (mise use -g node)' >&2; exit 127; }; exec node \"$@\"",
      "scentcast"].concat(args)
    proc.running = true
  }

  function refreshIfStale() {
    if (Date.now() - fetchedAt > 10 * 60 * 1000) refresh()
  }

  function openSite(view) {
    var url = siteUrl + "?view=" + view
    if (place) url += "&loc=" + encodeURIComponent(place.lat + "," + place.lon + "," + place.name)
    Quickshell.execDetached(["omarchy-launch-webapp", url])
    close()
  }

  // ---- Popout lifecycle, as in the built-in weather panel.
  function open() {
    openedFromHotkey = false
    setCenterHoverRevealSuppressed(false)
    root.controller.show()
    refreshIfStale()
  }

  function openFromHotkey() {
    openedFromHotkey = true
    root.controller.show()
    refreshIfStale()
    // After showing: the handoff closes the previous panel, which clears the flag.
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.openFromHotkey()
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
  }

  Process {
    id: proc
    workingDirectory: root.scriptPath.replace(/\/[^\/]*$/, "")
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "").trim()
        if (!raw) return
        try {
          root.report = JSON.parse(raw)
          root.error = ""
          root.fetchedAt = Date.now()
        } catch (e) {
          root.error = "Couldn’t read the picks"
        }
      }
    }
    stderr: StdioCollector {
      id: stderrCollector
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) {
        var lines = String(stderrCollector.text || "").trim().split("\n")
        root.error = lines[lines.length - 1] || "Couldn’t get picks"
      }
      if (root.rerun) {
        root.rerun = false
        Qt.callLater(root.refresh)
      }
    }
  }

  Timer {
    interval: root.refreshMinutes * 60 * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  // Follow Omarchy's weather location when the widget has none of its own.
  FileView {
    path: Quickshell.env("HOME") + "/.local/state/omarchy/settings/weather.json"
    watchChanges: true
    printErrors: false
    onFileChanged: {
      reload()
      if (!String(root.setting("location", "")).trim()) root.refresh()
    }
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void { root.openFromHotkey() }
    function close(): void { root.close() }
    function show(): void { root.openFromHotkey() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): void { root.refresh() }
  }

  component TierChip: Rectangle {
    property string tier: ""
    property color tint: Color.foreground
    property string fontFamily: Style.font.family

    implicitWidth: Math.max(implicitHeight, tierText.implicitWidth + Style.space(8))
    implicitHeight: tierText.implicitHeight + Style.space(2)
    radius: Style.cornerRadius
    color: "transparent"
    border.width: 1
    border.color: tint

    Text {
      id: tierText
      textFormat: Text.PlainText
      anchors.centerIn: parent
      text: parent.tier
      color: parent.tint
      font.family: parent.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(content.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onReturnRequested: root.openSite("today")
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "r") root.refresh()
        else if (t === "w") root.openSite("week")
      }

      Flickable {
        id: scroll
        anchors.fill: parent
        contentWidth: width
        contentHeight: content.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: content
          width: scroll.width
          spacing: Style.space(12)

          Text {
            visible: !root.pick
            width: parent.width
            textFormat: Text.PlainText
            wrapMode: Text.WordWrap
            text: root.error || "Picking from the wardrobe…"
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            font.italic: true
          }

          // ---- Hero: the bottle to wear now.
          Item {
            visible: !!root.pick
            width: parent.width
            height: Math.max(bottle.height, heroText.implicitHeight)

            Item {
              id: bottle
              width: Style.space(60)
              height: Style.space(68)
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter

              Image {
                id: thumb
                anchors.fill: parent
                source: root.pick && root.pick.thumb ? root.pick.thumb : ""
                fillMode: Image.PreserveAspectFit
                asynchronous: true
                smooth: true
                mipmap: true
              }

              Text {
                anchors.centerIn: parent
                visible: thumb.status !== Image.Ready
                textFormat: Text.PlainText
                text: "󱥘"  // nf-md-scent
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.displayLarge
              }
            }

            Column {
              id: heroText
              anchors.left: bottle.right
              anchors.leftMargin: Style.space(14)
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(3)

              Row {
                spacing: Style.space(8)

                TierChip {
                  anchors.verticalCenter: parent.verticalCenter
                  tier: root.pick ? root.pick.tier : ""
                  tint: tier === "S" ? Color.accent : root.dim
                  fontFamily: root.fontFamily
                }

                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  textFormat: Text.PlainText
                  text: root.pick ? (root.pick.label + " · " + root.pick.match + "% match").toUpperCase() : ""
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                  font.letterSpacing: 1.2
                }
              }

              Text {
                width: parent.width
                textFormat: Text.PlainText
                text: root.pick ? root.pick.name : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
                font.bold: true
                wrapMode: Text.WordWrap
                maximumLineCount: 2
                elide: Text.ElideRight
              }

              Text {
                width: parent.width
                textFormat: Text.PlainText
                text: root.pick ? root.pick.brand : ""
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }
            }

            TapHandler {
              onTapped: root.openSite("today")
            }
            HoverHandler {
              cursorShape: Qt.PointingHandCursor
            }
          }

          Row {
            visible: !!root.pick
            spacing: Style.space(8)

            Text {
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: root.pick ? root.weatherGlyph(root.pick.category, root.pick.slot === "night") : ""
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: root.pick ? root.conditionLine(root.pick) : ""
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }

          Flow {
            visible: !!root.pick
            width: parent.width
            spacing: Style.space(6)

            Repeater {
              model: root.pick ? root.pick.accords : []

              Rectangle {
                required property var modelData
                property color tint: modelData.color

                implicitWidth: accordText.implicitWidth + Style.space(14)
                implicitHeight: accordText.implicitHeight + Style.space(4)
                radius: Style.cornerRadius
                color: Qt.rgba(tint.r, tint.g, tint.b, 0.16)
                border.width: 1
                border.color: tint

                Text {
                  id: accordText
                  anchors.centerIn: parent
                  textFormat: Text.PlainText
                  text: modelData.name
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                }
              }
            }
          }

          Column {
            visible: !!root.pick
            width: parent.width
            spacing: Style.space(3)

            Repeater {
              model: root.pick ? root.pick.reasons : []

              Row {
                required property var modelData
                width: parent.width
                spacing: Style.space(8)

                Text {
                  id: toneMark
                  textFormat: Text.PlainText
                  text: modelData.tone === "good" ? "+" : "−"
                  color: modelData.tone === "good" ? Color.accent : root.urgent
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.bold: true
                }

                Text {
                  width: parent.width - toneMark.width - parent.spacing
                  textFormat: Text.PlainText
                  text: modelData.text
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  wrapMode: Text.WordWrap
                }
              }
            }
          }

          Text {
            visible: !!(root.pick && root.pick.runnerUp)
            width: parent.width
            textFormat: Text.PlainText
            text: root.pick && root.pick.runnerUp ? "Runner-up: " + root.pick.runnerUp.name + " · " + root.pick.runnerUp.brand : ""
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            elide: Text.ElideRight
          }

          PanelSeparator {
            visible: root.days.length > 0
            foreground: root.foreground
          }

          PanelSectionHeader {
            visible: root.days.length > 0
            text: "THE WEEK"
            foreground: root.foreground
            fontFamily: root.fontFamily
          }

          // ---- One row per day: weather on the left, day and night picks on the right.
          Column {
            visible: root.days.length > 0
            width: parent.width
            spacing: Style.space(10)

            Repeater {
              model: root.days

              Item {
                id: dayRow
                required property var modelData
                width: parent.width
                height: Math.max(dayInfo.implicitHeight, dayPicks.implicitHeight)

                Row {
                  id: dayInfo
                  width: Style.space(128)
                  spacing: Style.space(8)

                  Text {
                    width: Style.space(18)
                    textFormat: Text.PlainText
                    text: root.weatherGlyph(dayRow.modelData.category, false)
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.title
                  }

                  Column {
                    spacing: Style.space(1)

                    Text {
                      textFormat: Text.PlainText
                      text: dayRow.modelData.name
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: dayRow.modelData.name === "Today"
                    }

                    Text {
                      textFormat: Text.PlainText
                      text: root.temp(dayRow.modelData.hiF) + " / " + root.temp(dayRow.modelData.loF)
                        + (dayRow.modelData.rainChance >= 30 ? " · " + dayRow.modelData.rainChance + "%" : "")
                      color: root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                    }
                  }
                }

                Column {
                  id: dayPicks
                  anchors.left: dayInfo.right
                  anchors.right: parent.right
                  spacing: Style.space(2)

                  Repeater {
                    model: [dayRow.modelData.day, dayRow.modelData.night].filter(Boolean)

                    Row {
                      required property var modelData
                      width: dayPicks.width
                      spacing: Style.space(6)

                      Text {
                        id: slotMark
                        width: Style.space(14)
                        anchors.verticalCenter: parent.verticalCenter
                        textFormat: Text.PlainText
                        text: modelData.slot === "day" ? "" : ""
                        color: root.dim
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.bodySmall
                      }

                      Text {
                        width: parent.width - slotMark.width - chip.width - parent.spacing * 2
                        anchors.verticalCenter: parent.verticalCenter
                        textFormat: Text.PlainText
                        text: modelData.name
                        color: root.foreground
                        font.family: root.fontFamily
                        font.pixelSize: Style.font.body
                        elide: Text.ElideRight
                      }

                      TierChip {
                        id: chip
                        anchors.verticalCenter: parent.verticalCenter
                        tier: modelData.tier
                        tint: tier === "S" ? Color.accent : root.dim
                        fontFamily: root.fontFamily
                      }
                    }
                  }
                }

                TapHandler {
                  onTapped: root.openSite("week")
                }
                HoverHandler {
                  cursorShape: Qt.PointingHandCursor
                }
              }
            }
          }

          PanelSeparator {
            foreground: root.foreground
          }

          Item {
            width: parent.width
            height: Math.max(statusText.implicitHeight, footerButtons.implicitHeight)

            Text {
              id: statusText
              anchors.left: parent.left
              anchors.right: footerButtons.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              textFormat: Text.PlainText
              text: root.statusLine()
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
              elide: Text.ElideRight
            }

            Row {
              id: footerButtons
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(4)

              PanelActionButton {
                iconText: "󰑐"  // nf-md-refresh
                tooltipText: "Refresh (r)"
                enabled: !proc.running
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.refresh()
              }

              PanelActionButton {
                iconText: "󰏌"  // nf-md-open_in_new
                tooltipText: "Open Scentcast (Enter)"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.openSite("today")
              }
            }
          }
        }
      }
    }
  }
}
