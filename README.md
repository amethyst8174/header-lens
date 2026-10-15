# header-lens

Visual email header analysis dashboard for SOC analysts. Turns raw headers into a phishing verdict with routing maps, authentication results and spam scores. Runs entirely in your browser, with no data stored or sent.

**Live site:** https://amethyst8174.github.io/header-lens/

## Privacy by design

- **Processed on your device.** Parsing and scoring run as JavaScript in the browser tab. There is no backend.
- **Outbound traffic is blocked by the browser.** A Content Security Policy (`connect-src 'none'`, `form-action 'none'`) stops the page from sending data anywhere.
- **Nothing persists.** No cookies, local storage, IndexedDB, service worker or cache. The page wipes itself when you leave or reload.
- **No third parties.** Fonts, scripts and images are served from this repository. No analytics, trackers or CDNs.
- **Checked on every push.** The `Privacy check` workflow fails the build if storage APIs, network calls or third-party resources appear in the code.

Verify it yourself: open DevTools after pasting headers. The Network tab shows only this site's own files (page, scripts and the offline data below), and Application → Storage is blank.

## What the dashboard shows

| # | Panel | Headers used | Visual |
|---|---|---|---|
| — | Verdict | All findings, weighted | Risk score ring (0–100), top reasons |
| 1 | Routing path | `Received`, `Return-Path`, `Delivered-To`, `X-Originating-IP` | Hop flow with delays, suspicious relays flagged |
| 2 | Sender identity | `From`, `Reply-To`, `Sender`, `Return-Path`, `X-Sender-IP` | Domain match checks, lookalike detection |
| 3 | Authentication | `Authentication-Results`, `Received-SPF`, `DKIM-Signature`, `ARC-Seal` | Pass/fail donut, alignment |
| 4 | Message metadata | `Message-ID`, `Subject`, `Date`, `MIME-Version`, `Content-*` | Sent → received → delivered timeline |
| 5 | IP geolocation | IPs from `Received`, `X-Originating-IP`, connecting IP | World map pins, ASN, threat-list reputation |
| 6 | Security | TLS in `Received`, `X-MS-Exchange-CrossTenant-AuthAs/AuthSource` | Encrypted vs unencrypted hop bars |
| 7 | Anti-malware / anti-spam | `X-MS-Exchange-Organization-SCL/PCL`, `X-Forefront-Antispam-Report`, `X-Microsoft-Antispam`, Proofpoint, Mimecast, SpamAssassin | SCL, PCL, BCL gauges, decoded verdicts |
| 8 | Custom headers | `X-Mailer`, `X-Originating-Email`, Network-Message-Id, CrossTenant-Id | Outdated mailer and malformed ID checks |

Every finding links to its source header in the collapsible raw header pane. Reports can be copied as text or exported as CSV; both are generated in the browser.

The verdict is a weighted score: **55+ likely phishing**, **25–54 suspicious**, **below 25 likely genuine**. It is decision support, not a replacement for analyst judgement.

## Offline data

All lookups run locally against files in `data/`, loaded from this site on first use.

| File | Contents | Source | License |
|---|---|---|---|
| `data/geo.js` | IP → country, IP → ASN (IPv4 and IPv6) | [sapics/ip-location-db](https://github.com/sapics/ip-location-db) `server-country`, `iptoasn-asn` | PDDL 1.0 |
| `data/threat.js` | Known-bad IP ranges | [FireHOL level 1](https://iplists.firehol.org/), [Tor exit list](https://check.torproject.org/torbulkexitlist) | As published by each project |
| `data/world.js` | World map paths | [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth) | Public domain |

The `Refresh offline data` workflow rebuilds threat lists weekly and IP data monthly (`tools/build-data.mjs`). To rebuild by hand:

```
npm ci --prefix tools
node tools/build-data.mjs <folder with the source files>
```

## Project structure

```
index.html          Input page and dashboard view
css/style.css       Styles
js/config.js        YouTube and blog links (empty links are hidden)
js/app.js           Input handling, view switching, in-memory only
js/analyze.js       Header parsing, checks and scoring (no DOM, no network)
js/geodb.js         Offline IP lookups against data/
js/dashboard.js     Dashboard rendering (DOM methods only, no innerHTML)
data/               Offline lookup data (generated)
tools/              Data build script
test/               Sample headers for testing
assets/fonts/       Self-hosted fonts (SIL Open Font License)
assets/img/         Avatar, favicon, Cyber Insight Signals logo
```

## Publish with GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`.

## Roadmap

- [x] Input page (paste, drop .eml, sample, in-memory parsing)
- [x] Dashboard: verdict, routing, sender identity, authentication, metadata, geolocation, security, anti-malware, custom headers
- [x] Collapsible raw header table linked from findings
- [x] Bundled geolocation and threat feeds, refreshed by GitHub Actions
- [ ] Optional live DNS-over-HTTPS and RDAP lookups (reverse DNS, domain age; public IPs and domains only)

---

Built by [Cyber Insight Signals](#) · *Translating Cyber Chaos into Clarity*
