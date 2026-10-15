#!/usr/bin/env bash
# Every screen at the three widths in both themes, with New York's saved
# weather and the sample wear journal, the sky held still. Run from the repo
# root with the app served:
#   bash .claude/skills/ui-check/gallery.sh [APP] [OUT] [NAME...]
# APP defaults to http://127.0.0.1:5173/, OUT to shots/gallery. NAMEs pick
# screens: now week occasion trip owned wishlist worn insights discover
# bottle shop compare settings (shop: the page of a bottle not in the
# wardrobe). Files are OUT/<theme>-<name>-<W>x<H>.png. dev/shoot.mjs's
# lines about console errors, failed requests or waits that timed out go to
# stderr, and the exit code is 1 when there were any.
set -u
APP=${1:-http://127.0.0.1:5173/}
OUT=${2:-shots/gallery}
shift $(($# < 2 ? $# : 2))
ONLY=" $* "
INIT="$(node dev/offline/init.mjs --journal)" || exit 1
# name, route, what to wait for
SCREENS=(
  'now|#/wear/now|.pick'
  'week|#/wear/week|.wk-list'
  'occasion|#/wear/occasion/formal|.pick'
  'trip|#/wear/trip|.trip-form'
  'owned|#/wardrobe/owned|.row'
  'wishlist|#/wardrobe/wishlist|.wish-reasons, .message'
  'worn|#/wardrobe/worn|.calendar'
  'insights|#/wardrobe/insights|.ins-pick'
  'discover|#/discover?styles=skin,clean,intimate|.bcard-name'
  'bottle|#/bottle/70748|.bp-head'
  'shop|#/bottle/124649|.bc-verdict'
  'compare|#/compare/70748,85097|.cmp-table'
  'settings|#/settings|.set-group'
)
status=0
for theme in default gruvbox; do
  for screen in "${SCREENS[@]}"; do
    IFS='|' read -r name route wait <<< "$screen"
    [[ "$ONLY" != '  ' && "$ONLY" != *" $name "* ]] && continue
    node dev/shoot.mjs --init "$INIT" --reduced-motion \
      --url "${APP}?loc=40.71,-74.01,New%20York&theme=$theme$route" \
      --size 390x844 --size 768x1024 --size 1440x900 \
      --wait "$wait" --wait 600 --out "$OUT/$theme-$name.png" > /dev/null || status=1
  done
done
echo "Shots in $OUT"
exit $status
