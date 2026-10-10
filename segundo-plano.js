/* segundo-plano.js — reforça o funcionamento do Everton GPS com a tela apagada / app fechado na tela.
   1) Áudio silencioso em loop + MediaSession: mantém o app como "reproduzindo mídia" (muito difícil o Android encerrar).
   2) Wake Lock: evita a tela/CPU dormirem enquanto o app está aberto.
   3) Pede a isenção da otimização de bateria (plugin nativo EvertonBateria, criado pelo patch-android.py).
   Incluir no index.html depois do planos-acesso.js. */
(function () {
  'use strict';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- 1) áudio silencioso ---------- */
  function criarWavSilencioso() {
    var taxa = 8000, n = taxa * 2, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    function s(o, t) { for (var i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); }
    s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, taxa, true); v.setUint32(28, taxa, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    s(36, 'data'); v.setUint32(40, n, true);
    for (var i = 0; i < n; i++) v.setUint8(44 + i, 128 + (i % 2)); /* silêncio com ruído mínimo, para não ser tratado como vazio */
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  var au = null;
  function garantirAudio() {
    if (au) return au;
    au = document.getElementById('evManterAtivo') || document.createElement('audio');
    if (!au.parentNode) { au.style.display = 'none'; document.body.appendChild(au); }
    try { au.src = criarWavSilencioso(); } catch (e) {}
    au.loop = true; au.volume = 0.02; au.setAttribute('playsinline', '');
    au.addEventListener('pause', function () { setTimeout(tocar, 300); });
    au.addEventListener('ended', function () { tocar(); });
    return au;
  }
  function tocar() {
    try {
      var a = garantirAudio();
      var p = a.play(); if (p && p.catch) p.catch(function () {});
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: 'Everton GPS', artist: 'Rastreio ativo' });
        navigator.mediaSession.playbackState = 'playing';
        ['pause', 'stop'].forEach(function (acao) {
          try { navigator.mediaSession.setActionHandler(acao, function () { setTimeout(tocar, 200); }); } catch (e) {}
        });
      }
    } catch (e) {}
  }
  window.evManterAppAtivo = tocar;
  tocar();
  ['touchstart', 'click'].forEach(function (ev) { document.addEventListener(ev, tocar, { passive: true }); });
  setInterval(function () { if (!au || au.paused) tocar(); }, 15000);

  /* ---------- 2) wake lock ---------- */
  var lock = null;
  function pedirLock() {
    try {
      if (!navigator.wakeLock || document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(function (l) {
        lock = l; l.addEventListener('release', function () { lock = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  pedirLock();

  /* ---------- 3) bateria ---------- */
  function plugin() {
    try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.EvertonBateria; } catch (e) { return null; }
  }
  var faixa = null;
  function esconderFaixa() { if (faixa && faixa.parentNode) faixa.parentNode.removeChild(faixa); faixa = null; }
  function mostrarFaixa() {
    if (faixa) return;
    faixa = document.createElement('div');
    faixa.style.cssText = 'position:fixed;left:10px;right:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);z-index:10050;background:#1a212b;color:#fff;border:1px solid #ffb020;border-radius:12px;padding:12px;font:600 .85em system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.6)';
    faixa.innerHTML = '<div style="margin-bottom:8px">🔋 Para o rastreio não parar com a tela apagada, permita o Everton GPS rodar sem restrição de bateria.</div>' +
      '<div style="display:flex;gap:8px"><button id="evBatOk" style="flex:1;background:#00e0a8;color:#032;border:0;border-radius:8px;padding:10px;font-weight:800">Permitir</button>' +
      '<button id="evBatDepois" style="flex:1;background:#2a3340;color:#fff;border:0;border-radius:8px;padding:10px">Depois</button></div>';
    document.body.appendChild(faixa);
    document.getElementById('evBatOk').addEventListener('click', function () {
      var p = plugin(); if (!p) return;
      p.pedir().catch(function () { try { p.abrirConfig(); } catch (e) {} });
    });
    document.getElementById('evBatDepois').addEventListener('click', esconderFaixa);
  }
  function checarBateria() {
    var p = plugin(); if (!p) return;
    p.status().then(function (r) { if (r && r.ignorando) esconderFaixa(); else mostrarFaixa(); }).catch(function () {});
  }
  setTimeout(checarBateria, 4000);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') { pedirLock(); tocar(); setTimeout(checarBateria, 800); }
  });
})();
