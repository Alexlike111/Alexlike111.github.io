// Entry point. The Playgama Bridge script is injected into <head> by the Vite plugin (runs before this module).
import { bootGame } from './game';
import { t } from './i18n';

bootGame().catch((e: unknown) => {
  console.error('[boot] failed', e);
  const el = document.getElementById('boot');
  if (el) el.textContent = t('boot.failed') + ': ' + (e instanceof Error ? e.message : String(e));
});
