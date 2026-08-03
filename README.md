# HearnTube

**Learn Japanese from the videos you'd like to watch.**

Paste a YouTube link and HearnTube turns its subtitles into an interactive
transcript. Tap any word to see its reading, dictionary entry then save the ones 
worth keeping, along with the clip and audio they came from, straight into a 
spaced-repetition deck powered by FSRS.

Review them until they stick. Then prove it: in the **Versus arena**, players
pool words from their own decks and race to fill in the blanks.

<p align="center">
  <img src="site/img/player_preview_light.gif#gh-light-mode-only" width="30%">
  <img src="site/img/player_preview_dark.gif#gh-dark-mode-only" width="30%">
  <img src="site/img/card_review_preview_light.gif#gh-light-mode-only" width="30%">
  <img src="site/img/card_review_preview_dark.gif#gh-dark-mode-only" width="30%">
  <img src="site/img/versus_preview_light.gif#gh-light-mode-only" width="30%">
  <img src="site/img/versus_preview_dark.gif#gh-dark-mode-only" width="30%">
</p>

## Dependencies

### Runtime

- **Node.js >= 22.5:**  the app uses the built-in `node:sqlite`.
- **yt-dlp:** must be installed and on. 
Subtitles and card audio are fetched by exec on it (`controllers/ytdlp.js`).

### npm packages

- express
- ws
- helment
- cookie-parser
- argon2
- kuromoji
- ts-fsrd

### Front-End

- chart.js

## Dictionary data (JMdict)

Put the jmdict english common dictionary from [here](https://github.com/scriptin/jmdict-simplified/releases) rename it 
`jmdict-eng-common.json` and move it to `/data`.

> Dictionary content is derived from **JMdict**, the property of the
EDRDG, used under the CC BY-SA 4.0 licence.
The generated dictionary database (`data/dict.db`) is a derivative of JMdict
and is therefore also distributed under CC BY-SA 4.0.
>
> The `jmdict-eng-common.json` source file is the common-entries English build
from [scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified)
(conversion tooling also under CC BY-SA 4.0).