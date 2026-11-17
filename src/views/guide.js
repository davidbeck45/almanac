// The guide (#/guide, from the footer's "How Almanac works", Settings ›
// About and Now's welcome to a first visit): what each screen does and how
// to get the most from it, in plain words, with a link to each screen it
// names, then the questions people ask. No state; its one handler jumps to
// a section (the hash is the route, so there are no anchors to link to).
// Styles: src/css/shell.css (.guide-*).
import { icon } from '../ui/components.js';

// A section: its icon, heading, a short name for the contents row, one-line
// summary and the screens it covers (or the questions it answers), each
// { name, href, text }. Text is trusted (written here), so it may hold <b>
// and <i>.
export const GUIDE = [
  {
    id: 'start', glyph: 'sparkle', title: 'Getting started', short: 'Start',
    lead: 'Almanac picks a fragrance from your own bottles for the weather, the time of day and what you’re doing.',
    items: [
      { name: 'Set your place', text: 'Tap the place name by the pin (on Now, or in Settings) and search for your city, or use your device’s location. The forecast for it drives every pick.' },
      { name: 'Bring your bottles', href: '#/wardrobe/owned', text: 'You start on David’s wardrobe. In Wardrobe › Owned, switch to <b>Mine</b>, then tap <b>Add bottles</b> to search for yours or <b>Paste a list</b> of their names. Anything the library doesn’t have you can add yourself, with its accords. Anywhere else, <b>I own it</b> on a bottle adds it too.' },
      { name: 'Wear something', href: '#/wear/now', text: 'Open Now and tap <b>Wear this</b> on the pick, or on any bottle’s page. Logging what you wear lets Almanac rotate your bottles so the same one doesn’t come up every day.' },
    ],
  },
  {
    id: 'wear', glyph: 'wear', title: 'Wear',
    lead: 'What to put on, now and later.',
    items: [
      { name: 'Now', href: '#/wear/now', text: 'The pick for the day or night ahead, why it suits, how much to spray and where, and the bottles that suit it just as well. Below it, the rest of your wardrobe ranked for the window. Switch between Day and Night at the top.' },
      { name: 'Week', href: '#/wear/week', text: 'A plan for every day and night of the next week, taking turns so your bottles share the wear. Tap <b>Plan</b> to mark a day or night for a date, the office, formal wear and so on: that window gets the best bottle for it, and the days before leave it be.' },
      { name: 'Occasion', href: '#/wear/occasion', text: 'Rank your wardrobe for one occasion (office, date night, night out, formal, casual, outdoors, a night in). <b>When and where?</b> ranks it for another date or city, and lets you plan it.' },
      { name: 'Trip', href: '#/wear/trip', text: 'Give a place, dates and any events, and it packs the fewest bottles that cover the trip, with a plan for which to wear when and a packing list to share. While you’re away, Now shows the trip’s day.' },
    ],
  },
  {
    id: 'wardrobe', glyph: 'wardrobe', title: 'Wardrobe',
    lead: 'Your bottles, what you wear and what you want.',
    items: [
      { name: 'Owned', href: '#/wardrobe/owned', text: 'Every bottle you own. Switch one off to leave it out of the picks (it still counts as yours). Sort by brand, by how well each fits now, by when you last wore it, or by your stars.' },
      { name: 'Wishlist', href: '#/wardrobe/wishlist', text: 'Bottles you’ve hearted with <b>Want</b>, each checked against your wardrobe: Strong fit, Good, Covered, Risky or Redundant. Add a note to remember where you smelled it or the price you’re waiting for.' },
      { name: 'Worn', href: '#/wardrobe/worn', text: 'Your wear journal: a calendar (tap a day to log a wear you forgot), your most worn bottles, and the ones gathering dust, with when this week each would suit. Export it to keep a backup.' },
      { name: 'Insights', href: '#/wardrobe/insights', text: 'What your wardrobe covers and where it’s thin, as a map of occasions against the weather, what each bottle is for, the styles you own, and bottles that would fill the gaps. Set <b>How you wear</b> so it weighs the occasions you actually dress for.' },
    ],
  },
  {
    id: 'discover', glyph: 'discover', title: 'Discover',
    lead: 'Find new bottles worth trying, from nearly ten thousand well-voted ones.',
    items: [
      { name: 'Search', href: '#/discover', text: 'Type a name, or notes and accords (“iris leather”, “smoky vanilla”) to find bottles that have them.' },
      { name: 'By style', href: '#/discover', text: 'Pick the styles you like (skin scents, clean, vanilla, oud…) and get more of them that you don’t own. Heart the styles you love on Insights and Discover starts there.' },
      { name: 'By bottle', href: '#/discover', text: 'More like the bottles you choose, starting from your most worn. Filters narrow any list by season, day or night, lean, longevity, projection, value and blind-buy safety.' },
    ],
  },
  {
    id: 'bottle', glyph: 'bottle', title: 'A bottle’s page', short: 'Bottle pages',
    lead: 'Tap any bottle, anywhere, to open it.',
    items: [
      { name: 'Why it ranks here', text: 'How it scores for the window, part by part, and where it stands beside the pick.' },
      { name: 'For your own bottles', text: 'Rate it with stars and say whether it lasts or projects more or less on your skin: picks and spray counts follow. Your wears show when you actually reach for it.' },
      { name: 'For one you don’t own', text: 'The buy check, what it smells like (and cheaper twins), what voters say, pros and cons, and how it would do in today’s weather.' },
      { name: 'Layer and compare', text: '<b>Layer it with</b> suggests partners from your wardrobe. <b>Compare</b> sets up to three bottles side by side.' },
    ],
  },
  {
    id: 'share', glyph: 'share', title: 'Lists and sharing', short: 'Sharing',
    lead: 'Almanac ranks one list at a time.',
    items: [
      { name: 'Your own list', href: '#/settings', text: '<b>Mine</b> holds the bottles you add. Switch between it and David’s wardrobe in Settings (<b>Ranking from</b>).' },
      { name: 'Share it', href: '#/settings', text: '<b>Share</b> in Settings gives a link to your list. Whoever opens it sees picks from your bottles for their own weather, and can save it as theirs.' },
    ],
  },
  {
    id: 'privacy', glyph: 'journal', title: 'Your data',
    lead: 'Everything you add stays on this device.',
    items: [
      { name: 'Back it up', href: '#/settings', text: 'Your bottles, wears, stars, plans and wants live in this browser only. <b>Export</b> in Settings saves them to a file, and <b>Restore from a file</b> brings them back, here or on another device.' },
      { name: 'Ask Claude', href: '#/wardrobe/worn', text: '<b>Copy for Claude</b> (on Worn and in Settings) copies a short code with your recent wears and stars, for picks from Claude that know what you’ve worn.' },
    ],
  },
  {
    id: 'faq', glyph: 'help', title: 'Common questions', short: 'Questions',
    lead: 'What the app is doing when it does something you didn’t expect.',
    items: [
      { name: 'Why did the pick change?', text: 'Each day and each night has its own pick (days run 10 to 5, nights 7 to 11), and picks follow the forecast as it updates. Logging a wear also moves that bottle down for about ten days, so the others get a turn.' },
      { name: 'Why does it suggest a bottle I don’t like?', text: 'It only knows what you tell it. Rate the bottle on its page: one you give 1★ or 2★ is passed over unless nothing else fits. To leave a bottle out altogether, switch it off in Wardrobe › Owned.' },
      { name: 'What does “+2 as good” mean?', text: 'Those bottles suit the window just as well as the pick, so choose whichever you feel like. A word beside each says how it differs: fresher, richer, quieter or louder.' },
      { name: 'Why does a bottle say “Saved for…”?', text: 'You planned an occasion later in the week and it’s the best bottle for it, so the days before leave it alone.' },
      { name: 'What is “Not worn in 34 days”?', text: 'A bottle that hasn’t had a turn in a month, and suits the weather nearly as well as the pick, gets one. Nothing gathers dust.' },
      { name: 'Does it work offline?', text: 'Yes. It opens on the last forecast it saved, for up to five days, and everything you’ve logged is on the device already.' },
      { name: 'Can I put it on my home screen?', text: 'Yes, and it then opens full screen like an app. On an iPhone, open it in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. On Android, open the browser’s menu and tap <b>Install app</b> or <b>Add to Home screen</b>.' },
      { name: 'Where do the numbers come from?', text: 'Seasons, day and night, accords, notes and ratings are Fragrantica members’ votes. How long a bottle lasts and projects, what it’s worn for and what it layers with also draw on Parfumo’s. The forecast is Open-Meteo’s.' },
    ],
  },
];

const itemHTML = ({ name, href, text }) => `<li class="guide-item">
      <h3>${href ? `<a class="set-link" href="${href}">${name}</a>` : name}</h3>
      <p>${text}</p>
    </li>`;

// Each heading takes focus when the contents row jumps to it.
const sectionHTML = s => `<section class="guide-section" aria-labelledby="guide-${s.id}">
    <header class="guide-head">${icon[s.glyph] ?? ''}<div><h2 id="guide-${s.id}" tabindex="-1">${s.title}</h2><p>${s.lead}</p></div></header>
    <ul class="guide-items">${s.items.map(itemHTML).join('')}</ul>
  </section>`;

const tocHTML = sections => `<nav class="guide-toc" aria-label="In this guide">
    ${sections.map(s => `<button class="btn tertiary compact" data-action="guide-jump" data-value="${s.id}">${s.short ?? s.title}</button>`).join('')}
  </nav>`;

export const guideHTML = (sections = GUIDE) => `<div class="guide">
    <p class="guide-intro">A quick tour of Almanac: what each screen does and how to get the most from it. Tap a screen’s name to go there.</p>
    ${tocHTML(sections)}
    ${sections.map(sectionHTML).join('')}
  </div>`;

export const actions = {
  // To a section's heading, which takes focus so a screen reader reads on from there.
  'guide-jump'(el) {
    const heading = document.getElementById(`guide-${el.dataset.value}`);
    if (!heading) return;
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    heading.closest('.guide-section').scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    heading.focus({ preventScroll: true });
  },
};

export const guide = {
  id: 'guide',
  label: 'Guide',
  icon: 'journal',
  title: () => 'How Almanac works',
  heading: () => 'How Almanac works',
  render: () => guideHTML(),
};

// The footer's way in: drawn above the credits on every page but the guide.
export const guideLinkHTML = () => `<div class="foot-guide"><a class="btn secondary compact" href="#/guide">${icon.journal}How Almanac works</a></div>`;
