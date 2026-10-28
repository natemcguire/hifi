# 101X Chillville

- `playlist.mjs` reads the whole Spotify playlist with the owner's Spotify connection (it never prints the token and saves the rotated refresh token back): `withkeys node video/chillville/playlist.mjs <playlist-id> tracks.json`.
- `match.py` finds each song's official, embeddable YouTube upload: `python3 -I video/chillville/match.py tracks.json matches.json`. That list becomes `playlists/101x-chillville.json`.
- `yt_playlist.py` builds the public "101X Chillville" playlist on the Nate's Software channel from it, about 195 songs a day (YouTube's quota). It runs on the MacBook Pro as `com.nates-software.yt-chillville` at 4:10 each morning: https://www.youtube.com/playlist?list=PLXrzvZmJH65E
