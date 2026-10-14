# header-lens

Visual email header analysis dashboard for SOC analysts. Turns raw headers into a phishing verdict with routing maps, authentication results and spam scores. Runs entirely in your browser, with no data stored or sent.

**Live site:** https://amethyst8174.github.io/header-lens/

## Privacy by design

- **Processed on your device.** Parsing and scoring run as JavaScript in the browser tab. There is no backend.
- **Outbound traffic is blocked by the browser.** A Content Security Policy (`connect-src 'none'`, `form-action 'none'`) stops the page from sending data anywhere.
- **Nothing persists.** No cookies, local storage, IndexedDB, service worker or cache. The page wipes itself when you leave or reload.
- **No third parties.** Fonts, scripts and images are served from this repository. No analytics, trackers or CDNs.
- **Checked on every push.** The `Privacy check` workflow fails the build if storage APIs, network calls or third-party resources appear in the code.

Verify it yourself: open DevTools after pasting headers. The Network tab stays empty and Application → Storage is blank.

## Project structure

```
index.html          Input page
css/style.css       Styles
js/config.js        YouTube and blog links (empty links are hidden)
js/app.js           Input handling, in-memory only
assets/fonts/       Self-hosted fonts (SIL Open Font License)
assets/img/         Avatar, favicon, Cyber Insight Signals logo
```

## Publish with GitHub Pages

Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)`.

## Roadmap

- [x] Input page (paste, drop .eml, sample, in-memory parsing)
- [ ] Dashboard: verdict, routing, sender identity, authentication, metadata, geolocation, security, anti-malware, custom headers
- [ ] Collapsible raw header table
- [ ] Bundled geolocation and threat feeds, refreshed by GitHub Actions
- [ ] Optional live DNS-over-HTTPS and RDAP lookups (public IPs and domains only)

---

Built by [Cyber Insight Signals](#) · *Translating Cyber Chaos into Clarity*
