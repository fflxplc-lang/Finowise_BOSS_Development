/* RIA AI'S "ACTIVE CLIENT" IS ONLY A CLIENT GENUINELY IN PLAY (27-11-2026).

   On the CMS list the welcome screen said "Active client: Shubham Seth"
   (Profile | KYC | Portfolio) with no client open, and again after Clear:
   the drawer kept the context it had when it was opened, so a client page
   seen with the drawer open stayed "active" on the list, and Clear on a
   client page left the pill though the conversation had dropped that
   client.

   The pill now shows only when a client's page is open on screen now, or
   a client was asked about in this conversation; never on the CMS list,
   never right after Clear.

   Steps:
     1. the CMS list, fresh: no pill.
     2. a client opened with the drawer open: the pill names them; back to
        the list with the drawer still open: gone.
     3. Clear on a client's page: gone, and still gone on the list; the
        client opened again: back.
     4. a client named in the chat: the pill names them on the list (this
        conversation's client); Clear: gone.

   Synthetic clients only. */
const {suite} = require('../lib/harness');

suite(async t => {
  await t.home();
  let id = null;
  const pill = () => t.eval(() => { const el = document.querySelector('.ai-panel .ria-ctx-pill .ria-ctx-btns') && document.querySelector('.ai-panel .ria-ctx-btns').closest('div.ria-ctx-pill');
    return el ? el.innerText.split('\n')[0].trim() : ''; });
  const go = (cid) => t.eval(async (cid) => { if(cid) navigate('cms', cid); else navigate('cms'); await new Promise(r => setTimeout(r, 250)); }, cid || null);
  const reopen = () => t.eval(async () => { aiCloseP(); aiTogglePanel(); await new Promise(r => setTimeout(r, 300)); });

  await t.step('setup: a synthetic client', async () => {
    id = await t.eval(async () => { const c = {id: uid('CMS'), cmsName: 'ZZ Shubham Seth', rmName: '', branch: 'Pune', mobile: '9800000777', createdAt: new Date().toISOString()};
      initState('CMS', c); DB.clients.push(c); await save('clients'); return c.id; });
    return id;
  });

  await t.step('1. the CMS list, fresh: no Active client', async () => {
    await go(null); await reopen(); await t.eval(() => aiClearTurns());
    const p = await pill();
    if(p) throw new Error('pill on the list: ' + p);
    return 'none';
  });

  await t.step('2. a client opened with the drawer open shows; back to the list with the drawer open: gone', async () => {
    await go(id); const a = await pill();
    await go(null); const b = await pill();
    if(!/Active client: ZZ Shubham Seth/.test(a) || b) throw new Error(JSON.stringify({open: a, list: b}));
    return 'open: "' + a + '" → list: none';
  });

  await t.step('3. Clear on a client page hides it (and on the list); the client opened again brings it back', async () => {
    await go(id); await reopen(); const a = await pill();
    await t.eval(() => aiClearTurns()); const b = await pill();
    await go(null); const c = await pill();
    await go(id); const d = await pill();
    if(!/ZZ Shubham Seth/.test(a) || b || c || !/ZZ Shubham Seth/.test(d)) throw new Error(JSON.stringify({before: a, afterClear: b, list: c, reopened: d}));
    return 'before Clear: shown → after Clear: none → list: none → reopened: shown';
  });

  await t.step('4. a client named in the chat is this conversation\'s client on the list; Clear forgets them', async () => {
    await go(null); await t.eval(() => aiClearTurns());
    await t.eval(async () => { const el = document.getElementById('aiInput'); if(el){ el.disabled = false; el.value = 'ZZ Shubham Seth ka mobile number batao'; } ai.draft = 'ZZ Shubham Seth ka mobile number batao'; await aiSend();
      ai.homeCat = null; ai.turns = ai.turns.filter(x => !(x.ui && x.ui.kind === 'menu')); riaShowMenu(); await new Promise(r => setTimeout(r, 200)); });
    const a = await pill();
    await t.eval(() => aiClearTurns()); const b = await pill();
    if(!/ZZ Shubham Seth/.test(a) || b) throw new Error(JSON.stringify({asked: a, afterClear: b, active: await t.eval(() => ai.activeClient)}));
    return 'asked about in chat: "' + a + '" on the list → after Clear: none';
  });
});
