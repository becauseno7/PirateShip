import '@fontsource/bangers/latin-400.css';
import '@fontsource/pirata-one/latin-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-900.css';
import './style.css';
import { Game, exposeDebug } from './game/Game';

const game = new Game();
exposeDebug(game);
Promise.all([document.fonts.load('40px Bangers'), document.fonts.load('20px "Pirata One"'), document.fonts.load('700 16px Nunito')]).catch(() => {}).then(() => game.init()).catch((e) => {
  console.error(e);
  const el = document.querySelector('.load-label');
  if (el) el.textContent = 'Something went wrong while loading: ' + (e?.message ?? e);
});
