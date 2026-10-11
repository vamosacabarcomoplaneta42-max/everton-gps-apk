/* diagnostico.js — painel 🩺 para descobrir por que o rastreio para em segundo plano.
   Toque no botão 🩺 (canto inferior esquerdo). Mostra, desde que o app abriu:
   - se o JavaScript do app continuou rodando com a tela apagada (batimentos),
   - se o GPS continuou chegando em segundo plano,
   - se os envios ao Firebase deram certo ou falharam em segundo plano,
   - se os plugins nativos existem neste APK. */
(function () {
  'use strict';
  var KEY = 'ev_diag_v1';
  var D;
  try { D = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { D = null; }
  var agora = Date.now();
  // nova sessão do app: guarda a anterior em "anterior" e zera
  var anterior = D && D.atual ? D.atual : null;
  var S = { inicio: agora, hb: 0, hbOculto: 0, ultHb: agora, maiorGapOculto: 0, gps: 0, gpsOculto: 0, ultGps: null, ultGpsOculto: null,
            envOk: 0, envOkOculto: 0, envErro: 0, envErroOculto: 0, ultErro: '', ultEnvOk: null, ocultoDesde: null, tempoOculto: 0 };

  function salvar() { try { localStorage.setItem(KEY, JSON.stringify({ atual: S, anterior: anterior })); } catch (e) {} }
  function oculto() { return document.visibilityState !== 'visible'; }
  function hora(t) { if (!t) return '—'; var d = new Date(t); return d.toLocaleTimeString('pt-BR'); }
  function dur(ms) { var s = Math.round(ms / 1000); return Math.floor(s / 60) + 'min ' + (s % 60) + 's'; }

  document.addEventListener('visibilitychange', function () {
    if (oculto()) S.ocultoDesde = Date.now();
    else if (S.ocultoDesde) { S.tempoOculto += Date.now() - S.ocultoDesde; S.ocultoDesde = null; }
    salvar();
  });

  setInterval(function () {
    var t = Date.now(), gap = t - S.ultHb;
    S.hb++; if (oculto()) { S.hbOculto++; if (gap > S.maiorGapOculto) S.maiorGapOculto = gap; }
    S.ultHb = t; salvar();
  }, 5000);

  // GPS chegando
  var orig = window.processarNovaPosicao;
  if (typeof orig === 'function') {
    window.processarNovaPosicao = function () {
      S.gps++; S.ultGps = Date.now();
      if (oculto()) { S.gpsOculto++; S.ultGpsOculto = Date.now(); }
      return orig.apply(this, arguments);
    };
  }

  // envios ao Firebase
  var envOrig = window.enviarAtualizacoesFirebase;
  if (typeof envOrig === 'function') {
    window.enviarAtualizacoesFirebase = function () {
      var p;
      try { p = envOrig.apply(this, arguments); } catch (e) { S.envErro++; if (oculto()) S.envErroOculto++; S.ultErro = String(e && e.message || e); return Promise.reject(e); }
      if (p && p.then) {
        p.then(function () { S.envOk++; S.ultEnvOk = Date.now(); if (oculto()) S.envOkOculto++; },
               function (e) { S.envErro++; if (oculto()) S.envErroOculto++; S.ultErro = String(e && e.message || e); });
      }
      return p;
    };
  }

  // botão + painel
  var btn = document.createElement('button');
  btn.textContent = '🩺';
  btn.style.cssText = 'position:fixed;left:10px;bottom:calc(env(safe-area-inset-bottom,0px) + 10px);z-index:10060;width:44px;height:44px;border-radius:50%;border:2px solid #fff;background:#1a212b;color:#fff;font-size:20px;opacity:.85';
  var pan = document.createElement('pre');
  pan.style.cssText = 'display:none;position:fixed;left:8px;right:8px;top:8px;bottom:64px;z-index:10059;margin:0;padding:12px;overflow:auto;background:#0a0d12;color:#e6edf3;border:1px solid #2dd4ff;border-radius:12px;font:12px/1.45 monospace;white-space:pre-wrap';

  function bloco(titulo, s) {
    if (!s) return titulo + ': (sem dados)\n';
    var oc = s.tempoOculto + (s.ocultoDesde ? Date.now() - s.ocultoDesde : 0);
    return titulo + '  (aberto às ' + hora(s.inicio) + ')\n' +
      '  tempo com tela apagada/app em 2º plano: ' + dur(oc) + '\n' +
      '  batimentos do app em 2º plano: ' + s.hbOculto + '  (maior pausa: ' + dur(s.maiorGapOculto) + ')\n' +
      '  GPS recebido: ' + s.gps + ' no total, ' + s.gpsOculto + ' em 2º plano (último em 2º plano: ' + hora(s.ultGpsOculto) + ')\n' +
      '  envios ao banco OK: ' + s.envOk + ' (' + s.envOkOculto + ' em 2º plano)  último OK: ' + hora(s.ultEnvOk) + '\n' +
      '  envios com ERRO: ' + s.envErro + ' (' + s.envErroOculto + ' em 2º plano)  último erro: ' + (s.ultErro || '—') + '\n';
  }
  function pl(n) { try { return !!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[n]); } catch (e) { return false; } }

  function desenhar() {
    var txt = '🩺 DIAGNÓSTICO — ' + new Date().toLocaleString('pt-BR') + '\n\n';
    txt += 'Plugin GPS segundo plano: ' + (pl('BackgroundGeolocation') ? 'SIM' : 'NÃO') + '\n';
    txt += 'Plugin bateria: ' + (pl('EvertonBateria') ? 'SIM' : 'NÃO') + '\n';
    txt += 'Rodando como app Android: ' + ((window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) ? 'SIM' : 'NÃO') + '\n';
    try { txt += 'Pontos na fila para enviar: ' + (typeof filaPendentes !== 'undefined' ? filaPendentes.length : '?') + '\n'; } catch (e) {}
    txt += 'Scripts: modo-familia ' + (typeof aplicarTipoConta !== 'undefined' ? 'ok' : '?') + ', trajeto ' + (window.processarNovaPosicao && String(window.processarNovaPosicao).indexOf('trajeto') >= 0 ? 'ok' : 'verificar') + '\n\n';
    txt += bloco('SESSÃO ATUAL', S) + '\n' + bloco('SESSÃO ANTERIOR', anterior) + '\n';
    txt += 'Como ler: se "batimentos em 2º plano" for 0 ou a maior pausa for grande, o Android congelou o app.\n' +
           'Se o GPS em 2º plano for 0, o serviço de localização foi encerrado.\n' +
           'Se houver erros de envio em 2º plano, o app roda mas a internet/banco falha.';
    pan.textContent = txt;
  }
  btn.addEventListener('click', function () {
    if (pan.style.display === 'none') { desenhar(); pan.style.display = 'block'; } else pan.style.display = 'none';
  });
  pan.addEventListener('click', function () { desenhar(); });
  document.body.appendChild(pan); document.body.appendChild(btn);
  salvar();
})();
