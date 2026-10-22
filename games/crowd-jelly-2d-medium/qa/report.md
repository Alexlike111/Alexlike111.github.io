# Check report

✅ 10 languages, changelog, version
✅ ads: interstitial only via kit/ads.ts
✅ ads: afterResult only called from the result screen (main.ts)
✅ Bridge used only in kit/bridge.ts
✅ no localStorage (saves go through Bridge storage)
✅ no own network requests in src
✅ sounds and music only in code (no audio files)
✅ no other ad / portal SDKs in src
✅ dist size 0.56 MB
✅ dist/index.html at the root
✅ playgama-bridge-config.json in dist
⚠️ Bridge publicToken is a placeholder (template self-test only)
✅ dist has no audio / video files
✅ index.html: no external files
✅ layout 360x640, 915x412, 2560x1440: result panel fits, close button, no scroll
✅ desktop: canvas is painted
✅ desktop: game_open has device_class mouse
✅ desktop: first-launch controls hint
✅ desktop: mouse move to the top lane picks lane 0
✅ desktop: mouse move to the bottom lane picks lane 2
✅ desktop: ArrowUp moves one lane up
✅ desktop: S moves one lane down
✅ desktop: key 1 picks lane 0
✅ desktop: P opens the pause panel and stops the game
✅ desktop: Esc resumes
✅ desktop: toast <= 35% width, <= 12% height
✅ desktop: toast sits at the edge, not over the field centre
✅ desktop: result screen with Next / Try again
✅ desktop: no interstitial on the result itself
✅ desktop: no interstitial in the first 3 minutes
✅ desktop: interstitial after 3 min, on the Next tap
✅ desktop: no second interstitial within 90 s
✅ desktop: interstitial again after 90 s
✅ desktop: rewarded button gives +25% jellies
✅ desktop: all analytics events carry device_class and build_version
✅ desktop: event game_open sent
✅ desktop: event run_start sent
✅ desktop: event run_end sent
✅ desktop: settings: feedback button present
✅ desktop: feedback form opens
✅ desktop: What's new shows version and date
✅ desktop: 10 languages fit (menu, settings, language list)
✅ desktop: no console / page errors
✅ desktop: no requests outside the game
✅ phone: canvas is painted
✅ phone: game_open has device_class touch
✅ phone: first-launch controls hint
✅ phone: tap on the top lane picks lane 0
✅ phone: tap on the bottom lane picks lane 2
✅ phone: pause button stops the game
✅ phone: toast <= 35% width, <= 12% height
✅ phone: toast sits at the edge, not over the field centre
✅ phone: result screen with Next / Try again
✅ phone: no interstitial on the result itself
✅ phone: no interstitial in the first 3 minutes
✅ phone: interstitial after 3 min, on the Next tap
✅ phone: no second interstitial within 90 s
✅ phone: interstitial again after 90 s
✅ phone: rewarded button gives +25% jellies
✅ phone: all analytics events carry device_class and build_version
✅ phone: event game_open sent
✅ phone: event run_start sent
✅ phone: event run_end sent
✅ phone: settings: feedback button present
✅ phone: feedback form opens
✅ phone: What's new shows version and date
✅ phone: 10 languages fit (menu, settings, language list)
✅ phone: no console / page errors
✅ phone: no requests outside the game

✅ all 69 checks passed
