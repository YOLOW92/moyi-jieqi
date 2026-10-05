# Moyi · Fully Mixed Jieqi

[中文](README.md) | **English**

A 3D ink-wash desktop game of *Jieqi* (揭棋, "reveal chess"), the hidden-piece variant of Chinese chess, for Windows. Rendered with Three.js and packaged with Electron. The two generals start face up in their palaces. The other 30 pieces are shuffled across both colors and placed face down on the standard starting squares. You reveal a piece by moving it. The game also has a roguelike mode, *Ink Path* (墨途闯关).

The game's interface is in Chinese.

![Title screen](docs/screenshots/menu.jpg)

## Screenshots

| vs. computer | Ink Path (roguelike) |
|---|---|
| ![A check against the computer](docs/screenshots/classic.jpg) | ![Ink Path: rocks, ink pools, treasure boxes and the run panel](docs/screenshots/rogue.jpg) |
| **Pick one of three rewards** | **The shop** |
| ![Reward cards](docs/screenshots/reward.jpg) | ![Shop](docs/screenshots/shop.jpg) |

![Rules shown as a vertical hand scroll](docs/screenshots/rules.jpg)

## Download

Get the latest build from [Releases](https://github.com/YOLOW92/moyi-jieqi/releases) (Windows x64 only):

- **Portable**: `moyi-jieqi-<version>-portable.exe`. Double-click to play; no installation needed.
- **Installer**: `moyi-jieqi-<version>-setup.exe`. Lets you choose the install folder.

The executables are not code-signed, so Windows SmartScreen may warn about an "unknown publisher" on first launch. Click **More info → Run anyway**. You can also build from source (see [Development](#development)); the output goes to `release/`.

## Game modes

- **Two players**: hot-seat on one screen. The camera turns to face whoever moves next.
- **vs. computer**: three levels (初学 Beginner, 棋手 Player, 宗师 Master). The AI sees only public information and never peeks at hidden pieces.
- **Ink Path**: the roguelike mode described below.

### Jieqi rules

- A hidden piece's first move follows the piece type of the square it started on (a piece on a chariot square moves as a chariot, and so on). It flips face up as soon as it lands.
- If it turns out to belong to the opponent, the move still stands and the piece now fights for the other side. This is called a *defection* (倒戈).
- Hidden advisors stay inside their palace, and hidden elephants cannot cross the river. Once revealed, advisors may leave the palace and elephants may cross.
- You win by capturing the enemy general, or when the side to move has no legal moves. A position repeated three times is a draw, and so are 60 moves with no capture and no reveal.

### Ink Path (roguelike)

A run is three games, and each game is divided into three acts. You play red against the computer.

- **Acts**: you enter act 2 after capturing 3 pieces or 20 moves, and act 3 after 7 captures or 40 moves. At each new act the AI gets stronger and new terrain appears. Act 2 adds an enemy affix; act 3 brings in the boss. The shop opens after every act change.
- **Ink sticks** (currency): earned by capturing enemy pieces, revealing your own pieces and opening treasure boxes, plus a bonus for winning a game.
- **Pick one of three**: capturing an enemy chariot, horse or cannon lets you pick a tactic, relic or talisman, or take 3 ink sticks instead.
- **Tactics** (5): change how your pieces move, e.g. horses can't be hobbled, cannons may jump over two pieces.
- **Relics** (8): passive effects, e.g. a shield for your general, seeing hidden pieces at the start of each game.
- **Talismans** (7): single-use actives, cast from the side panel: peek, freeze, swap, analyse, undo, splash ink pool, shatter rock.
- **Roster edits** (3): bought in the shop; rewrite the pool of hidden pieces, e.g. turn a soldier into a chariot or convert an enemy piece.
- **Terrain**: rocks block movement and can serve as a cannon's screen; a piece that lands in an ink pool skips its next turn; stepping on a treasure box claims it.
- **Bosses**: the Armored General (shield 2), the Emperor in the Field (the general leaves the palace), and the Ink Wraith (summons a fallen piece back every six moves).
- During a run there is no undo, hint or draw offer, except through talismans. The AI plans with the same modified rules and still never peeks at hidden pieces.

## Controls

Click or drag your own pieces to move; right-click to deselect. Shortcuts:

- `Ctrl+Z` Undo
- `H` Hint
- `F` Flip the view
- `F1` Rules
- `F11` Full screen
- `Esc` Deselect or return to the title screen

Games are saved automatically and can be resumed from the title screen.

## Visual effects

- **Title screen**: the camera circles a landscape; the title lands in heavy ink and splashes, a seal stamps down, and the buttons sweep in with brush strokes.
- **Opening**: the board is painted stroke by stroke and the river text bleeds in. Pieces fall from the sky with ripples, and the generals land last with a burst of ink.
- **Selection**: the piece lifts, sways and glows gold above a spreading ink ring. Ink dots mark legal squares, and capturable pieces get a rotating cinnabar circle.
- **Moves**: pieces fly along an arc, leaning forward and trailing ink to the sound of wind. On landing they squash and rebound, leaving a ripple and an ink stain.
- **Reveals**: a hidden piece spins one and a half turns in the air with golden sparks, a white flash and a guzheng arpeggio. A defection splatters ink and writes "倒戈" in cursive across the screen.
- **Captures**: the captured piece is knocked away, flips in the air and lands in the tray. Ink droplets leave fading stains, with smoke, camera shake and a drum.
- **Check**: a cinnabar glow spreads under the general, the screen edges turn red, and a cursive "将" lands with gong and drums.
- **Turn change**: a seal stamps down and the side to move ripples like a wave.
- **AI thinking**: candidate pieces lift slightly and faint ink arrows flicker before the move is played.
- **Game end**: ink blossoms and falling plum petals while the camera orbits slowly. The scene fades to grey on a loss, and the result unrolls as a scroll.
- **Scenery**: three layers of distant mountains, a red sun, drifting mist, falling plum blossoms and circling cranes. Bamboo shadows sway on the board, and a lotus pond surrounds the table.
- **Interface**: the brush cursor leaves an ink trail and clicks splash ink. Scene changes use an ink wash; the move list is brushed in line by line, and the rules unroll as a vertical scroll.

## Development

Requires Node.js 20.19+ or 22.12+.

```powershell
npm install
npm run dev      # run in the browser (Vite)
npm start        # build, then launch with Electron
npm test         # unit tests for rules, AI and Ink Path (Vitest)
npm run dist     # package the .exe files into release/
```

### Project layout

| Directory | Contents |
|---|---|
| `src/core` | Rules engine `rules.ts` (pure functions, runs in a Worker, includes the Ink Path rule modifiers) and move notation `notation.ts` |
| `src/ai` | Fair AI: resamples hidden pieces from public information only; iterative-deepening alpha-beta with quiescence search, running in a Web Worker |
| `src/rogue` | Ink Path: content definitions, run state, game-flow director |
| `src/scene` | 3D scene: renderer and ink post-processing, painted board, pieces, effects, terrain, landscape, procedural textures |
| `src/ui` | Title screen, game panel, banners, scroll dialogs, Ink Path cards and shop, 2D ink layer |
| `src/audio` | Real-time Web Audio synthesis (wooden pieces, guzheng, drums, gong, wind in the pines) |
| `src/game` | Game controller tying together rules, AI, animation, UI and saves |
| `electron` | Desktop shell |

## License

Released under the [GNU GPL-3.0](LICENSE). You may use, modify and redistribute it freely, but modified versions you distribute must also be licensed under GPL-3.0.

The fonts (Ma Shan Zheng, Liu Jian Mao Cao and Noto Serif SC, included via Fontsource) are licensed under the SIL Open Font License.
