# HIFI iOS: App Review Notes and the review video

For App Store submission e52e2675 (HIFI 1.0, build 2, bundle `com.natesoftware.hifi`).
Apple returned it on 2026-10-31 under Guideline 2.1, Information Needed: a screen
recording from a physical device on the latest iOS showing the app launched and used
normally, including account and paid-feature flows, plus App Review Notes covering
purpose and audience, how to reach each feature, external services, regional
differences and rights documentation.

Nothing in this file has been sent to Apple. Nate replies in App Store Connect.

## The recording

Status on 2026-10-31, 18:25: done. Nate recorded the armed tour on his iPhone with a
Control Center screen recording and has the video he needs (it is on the phone, not in
this repo). The recording run is over: nothing is recording or building on the mini, and
the phone's tour is no longer armed (HIFI's preferences carry no `tourArmed` key), so the
next launch of HIFI behaves normally. Do not record again or resubmit; Nate attaches the
video to the App Store Connect reply himself. The rest of this section is kept for the
next time a device recording is needed.

- `xcrun devicectl device capture screen-record` refused Nate's iPhone 17 Pro Max
  (iOS 26.6.1): over Wi-Fi the phone does not offer the Screen Recording capability
  (CoreDeviceError 1001). Screen capture of the Mac mini's display from an agent session
  is blocked too, so Xcode's device-screen window cannot be recorded from here.
- The tour build is installed on the phone and armed: the next time HIFI is opened it
  runs the two-minute walkthrough once by itself, then behaves normally.
- To record it: on the phone, open Control Center, tap Screen Record, open HIFI, leave it
  alone for two minutes, stop the recording. The video lands in Photos. Attach it to the
  App Store Connect reply (from the phone, or AirDrop it to the Mac). To run the tour
  again, `ios/scripts/record-review.sh <UDID> --reuse --arm` on the mini.
- Or plug the phone into the mini by USB and run `ios/scripts/record-review.sh <UDID>`;
  over USB devicectl may offer screen recording (not verified here). The file goes to
  `ios/Review/hifi-iphone-review-<date>.mp4`.
- Reference: `ios/Review/hifi-simulator-tour-20261031.mp4` is the same tour recorded in
  the iPhone 17 Pro Max simulator on the MacBook Air (131 s, 1320 x 2868, no audio).
  It shows exactly what the phone recording will contain, but it is a simulator, which
  is not what Apple asked for. Do not send it as the device recording.
- What the tour shows, in order: launch to the HIFI menu; Radio with the live song on
  each station; tuning Sonic Universe (HIFI TV behind the song, LIVE bar); the wheel as
  the volume; next station from the wheel; 101X Chillville playing an official video;
  Synth Sounds, Shareware Summer with pause and play; Playlists and the Connect Spotify
  page (the account flow, up to Spotify's own sign-in sheet); Settings, the clicker off
  and on; About; back to Now Playing. About 100 seconds.
- How it works: a Debug build runs `tour()` at the bottom of `ios/Sources/IPod.swift`
  (`#if DEBUG`) when launched with `-tour 1`, or once after `-armTour 1`. It presses the
  click wheel through the same code paths a finger uses, so the video is the real app on
  the real phone, unattended. The App Store build has no tour.
- Not in the video: Spotify's sign-in sheet itself (it needs a Spotify password typed on
  the phone), the heart saving a song (needs a connected Spotify account), lock screen
  controls and Picture in Picture (both happen outside the app's screen). Nate can add
  those to the same Control Center recording by hand after the tour ends.

## App Review Notes (paste into App Store Connect, under 4000 characters)

HIFI is a free internet radio player drawn as a classic click-wheel music player. No account, no purchases, no subscriptions, no ads. Audience: adults and teens who want background music; age rating 12+ only because live radio can carry mild language.

HOW TO USE: drag a finger around the wheel to move the highlight, press the center button to choose, MENU to go back. On Now Playing the wheel is the volume, and the left and right wheel buttons change station.

FEATURES AND WHERE THEY ARE
- Radio (menu > Radio): one list of every station. Ten live stations, then the four Synth Sounds stations of our own instrumental music. Choose one and it plays, with the song that is on now and HIFI TV behind it. Everyone hears the same point in a Synth Sounds rotation, like a broadcast.
- 101X Chillville (menu > Radio, last row): a playlist played from each song's official YouTube upload, in YouTube's own embedded player (youtube-nocookie.com), on screen and only while the app is open. MENU stops it.
- Heart (Now Playing on a live station): saves the song to the listener's Spotify Liked Songs. Without Spotify connected it opens the Connect Spotify page.
- Playlists (menu > Playlists): the Nate's Software HIFI playlist, and the listener's own Spotify playlists once connected. Choosing one opens it in Spotify.
- Settings (menu > Settings): Clicker, Backlight, Spotify connect or disconnect, Mini Shuffle (Picture in Picture) and Shuffle on Home.
- Lock screen and Control Center: play, pause, next and previous station with the song, artist and station shown. Picture in Picture: start a station, then go to the Home Screen.

ACCOUNTS: none required. Spotify is optional and uses the listener's own Spotify account through Spotify's sign-in page (ASWebAuthenticationSession, PKCE, no password reaches us). Spotify's development-mode rule limits sign-in to accounts we list in Spotify's dashboard, so a reviewer's own account will see the "Use your own Spotify app" page instead of connecting. If you want to test hearting, reply with the Spotify account email and we add it the same day. Everything else works without Spotify. No demo account is needed.

EXTERNAL SERVICES: hifi.nates-software.com (station list, now-playing relay, our music and HIFI TV clips); stream.radioparadise.com, ice6.somafm.com and streaming.exclusive.radio (live audio, straight from the stations, never rehosted); api.radioparadise.com and somafm.com/songs (song titles, via our relay); www.youtube-nocookie.com and www.youtube.com (the Chillville player); accounts.spotify.com and api.spotify.com (optional Spotify); nates-software.com/api/hifi-spotify (Spotify client ID and the HIFI playlist). No analytics, no tracking SDKs, no third-party advertising.

REGIONAL DIFFERENCES: none in the app. It is available worldwide in English. A broadcaster or YouTube may geo-restrict a stream or a video; Chillville skips to the next song if a video cannot play. Spotify features need Spotify in the listener's country.

RIGHTS: Synth Sounds are original recordings owned by Nate McGuire (Nate's Software), composed by our own scripts plus four owner-supplied AI-generated seed tracks; provenance is in the open-source repository (github.com/natemcguire/hifi, MIT). HIFI TV clips are original AI-generated video made for HIFI. Live stations are the public streams Radio Paradise, SomaFM and Exclusive Radio publish for any player; HIFI links to them, plays them unaltered, carries no ads, and names the stations with links to support them. Chillville plays only official uploads through the YouTube IFrame Player API under the YouTube API Services Terms; nothing is downloaded or rehosted. Spotify features use the Spotify Web API under the Spotify Developer Terms. Documentation for any of these is available on request.

## Longer answers, for Nate's reply if Apple asks more

### Purpose and audience

HIFI is a radio receiver, not a music library. It plays ten live internet radio stations
(Radio Paradise, seven SomaFM channels including four holiday ones, Pop Girl Radio from
Exclusive Radio, and the 101X Chillville video playlist) and four original instrumental stations, on a screen
styled like a click-wheel iPod. It is free, has no in-app purchases and no ads. It is
for people who want music on while they work, cook or drive; nothing in it is aimed at
children. The age rating was declared with Infrequent/Mild Profanity because live radio
plays unfiltered songs.

### Paid features

There are none. No StoreKit, no subscriptions, no tips, no unlockable content. The
listing is priced Free in every territory.

### Account flows

The app has no accounts of its own. The one sign-in is Spotify, and it is optional:

1. Now Playing on a live station shows a heart next to the song, and Playlists has a
   "Connect Spotify" row. Either opens the Connect Spotify page (white page, red heart,
   green button).
2. "Connect Spotify" opens Spotify's own authorization page in an
   ASWebAuthenticationSession. iOS first shows the system alert "HIFI wants to use
   spotify.com to sign in". HIFI never sees the password; the PKCE flow returns a code
   to `https://nates-software.com/hifi/spotify/callback`, which hands it back to the app
   through `nswhifi://`.
3. The refresh token is stored in the device Keychain only and is sent only to Spotify.
   Scopes: user-library-read, user-library-modify, playlist-read-private,
   playlist-read-collaborative.
4. Settings > Spotify shows Connected and disconnects on press (the token is deleted).
5. Spotify development mode allows only allowlisted accounts on HIFI's shared client
   ID. Other listeners get the "Use your own Spotify app" page, which walks them through
   making a free Spotify app and pasting its Client ID. Reviewers will hit this page too
   unless Nate adds their Spotify email in the Spotify developer dashboard.

### How to reach each feature

| Feature | Path on the click wheel |
|---|---|
| Play a live station | Menu > Radio > a station > center button |
| Song now playing, HIFI TV | automatic on Now Playing |
| Volume | spin the wheel on Now Playing |
| Next or previous station | right or left wheel button, or lock screen |
| 101X Chillville (video) | Menu > Radio > 101X Chillville |
| Synth Sounds | Menu > Synth Sounds > a station |
| Pause and play | play/pause button on the wheel, or the center button on Now Playing |
| Heart a song | heart next to the title on Now Playing (live stations) |
| Playlists | Menu > Playlists |
| Connect or disconnect Spotify | Menu > Settings > Spotify, or the heart, or Playlists > Connect Spotify |
| Clicker, Backlight | Menu > Settings |
| Picture in Picture (Mini Shuffle) | Menu > Settings > Mini Shuffle, or play and go Home with Shuffle on Home set to On |
| About | Menu > About |

### External services the app talks to

| Host | Used for |
|---|---|
| hifi.nates-software.com | `stations.json` (catalog), `/api/now-playing` (relay of station song data), `/tracks/*.mp3` (Synth Sounds), `/tv/*.mp4` (HIFI TV clips), `/video` (the Chillville page) |
| stream.radioparadise.com, ice6.somafm.com, streaming.exclusive.radio | live audio streams, played directly by AVPlayer |
| api.radioparadise.com, somafm.com | song titles, fetched by our Worker relay, not by the phone |
| www.youtube-nocookie.com, www.youtube.com | the Chillville embedded player (IFrame Player API) inside a WKWebView |
| accounts.spotify.com, api.spotify.com | optional Spotify sign-in, Liked Songs, playlists |
| nates-software.com/api/hifi-spotify | HIFI's Spotify client ID and the HIFI playlist ID |

The app has no analytics, crash reporting SDK, advertising or tracking. The privacy
manifest declares no collected data and no tracking domains. Privacy policy:
https://hifi.nates-software.com/privacy

### Regional differences

The app is the same build and the same catalog everywhere and is available in all
territories, English only. Live streams and YouTube videos are served by their owners,
who may geo-restrict; the app shows "Lost the signal. Retuning…" or moves to the next
Chillville video. Spotify features depend on Spotify being available to the listener.

### Rights documentation

- Synth Sounds: original music. Composed by `scripts/compose-instrumentals.py` in the
  public repository, plus four owner-supplied AI-generated seed tracks marked
  `provenance: Owner-supplied AI-generated audio`, `license: owner-approved-commercial`
  in `stations.json`. Artist names are project aliases. MIT licensed (`LICENSE`).
- HIFI TV clips (`tv/*.mp4`): original AI-generated video made for HIFI.
- Live stations: the stations' public stream URLs, played unaltered, with their names
  and support links shown. No rehosting, no ads inserted. Nothing in the repo is a
  written permission from Radio Paradise, SomaFM or Exclusive Radio. If Apple asks for
  a licence letter, Nate must get one from each station (SomaFM asks apps to request
  permission at somafm.com/contact; Radio Paradise lists third-party player terms on
  radioparadise.com).
- 101X Chillville: official uploads only, played in YouTube's own player through the
  IFrame Player API on youtube-nocookie.com, with YouTube's ads and controls intact,
  which is the use the YouTube API Services Terms allow. The track list is
  `playlists/101x-chillville.json`.
- Spotify: Spotify Web API under the Spotify Developer Terms, PKCE client, scopes above.
- Station names are used descriptively. HIFI does not use Apple's iPod name or logos;
  the app is called HIFI and the About page credits Nate's Software.

## Re-recording

```sh
ios/scripts/record-review.sh <iPhone UDID>            # build, install, record (USB)
ios/scripts/record-review.sh <iPhone UDID> --reuse    # last build again
ios/scripts/record-review.sh <iPhone UDID> --reuse --arm  # arm it; record on the phone
```

The phone must be paired with this Mac (`xcrun devicectl list devices`), unlocked and
awake. The tour's steps and timing are in `tour()` at the bottom of
`ios/Sources/IPod.swift`.
