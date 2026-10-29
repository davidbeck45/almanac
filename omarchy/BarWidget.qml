import QtQuick
import qs.Commons
import qs.Ui

// Bar icon for Almanac. The panel (Panel.qml) owns the data; this is the
// slot the bar tracks, so it forwards the popout contract to it.
BarWidget {
  id: root
  moduleName: "doeszen.almanac"

  readonly property var panel: panelLoader.item

  function injectPanel() {
    if (!panel) return
    if ("bar" in panel) panel.bar = root.bar
    if ("settings" in panel) panel.settings = root.settings
    if ("anchorItem" in panel) panel.anchorItem = button
    if ("hostWidget" in panel) panel.hostWidget = root
  }

  function refresh() {
    if (panel) panel.refresh()
  }

  function togglePanel() {
    if (panel) panel.toggle()
  }

  // Shape contract for shell.summon/hide/toggle routing.
  readonly property bool opened: panel ? panel.opened === true : false
  readonly property bool popoutSwitchClosing: panel ? panel.popoutSwitchClosing === true : false

  function open() {
    if (panel) panel.openFromHotkey()
  }

  function close() {
    if (panel) panel.close()
  }

  function closeForPopoutSwitch() {
    if (panel) panel.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "󱥘"  // nf-md-scent
    slotSize: Style.bar.statusSlot
    dimmed: !root.panel || !root.panel.pick
    tooltipText: root.panel && !root.opened ? root.panel.tooltip : ""

    onPressed: function(b) {
      if (!root.panel) return
      if (b === Qt.RightButton) root.panel.openSite("today")
      else if (b === Qt.MiddleButton) root.refresh()
      else root.togglePanel()
    }
  }
}
