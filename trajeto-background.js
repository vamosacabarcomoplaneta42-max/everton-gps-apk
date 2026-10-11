/* trajeto-background.js — garante que o trajeto chegue ao admin mesmo em segundo plano.
   Problema: o app só gravava pontos no histórico depois de descobrir o endereço pela internet
   (e descartava o ponto se a consulta demorasse mais de 45 s). Em segundo plano a internet
   do WebView costuma falhar, então o trajeto ficava com buracos.
   Solução: a cada ~15 s em movimento (ou ~60 s parado) grava um ponto "trajeto" no histórico
   usando o último endereço conhecido, sem depender de nova consulta de endereço.
   O admin separa viagens quando passam mais de 120 s sem ponto, por isso a frequência importa. */
(function () {
  'use strict';
  var original = window.processarNovaPosicao;
  if (typeof original !== 'function') { console.warn('[trajeto] processarNovaPosicao não encontrada'); return; }

  window.__trajetoAtivo = true;
  var ultimoTs = 0, ultimoLat = null, ultimoLon = null;
  /* Em segundo plano os temporizadores do app ficam congelados, então a busca normal de endereço
     não anda. Aqui o endereço é buscado a cada ~60 m percorridos, disparado pela chegada do GPS. */
  var addr = null, addrPos = null, addrPend = false, addrPendTs = 0;
  function atualizarEndereco(lat, lon) {
    if (typeof buscarEnderecoImediato !== 'function') return;
    var agora = Date.now();
    if (addrPend && (agora - addrPendTs) < 30000) return;
    if (addrPos && dist(addrPos[0], addrPos[1], lat, lon) < 60) return;
    addrPend = true; addrPendTs = agora;
    try {
      buscarEnderecoImediato(lat, lon).then(function (a) {
        if (a && a.rua) { addr = a; addrPos = [lat, lon]; }
      }).catch(function () {}).then(function () { addrPend = false; });
    } catch (e) { addrPend = false; }
  }
  var INTERVALO_MOV_MS = 15000, INTERVALO_PARADO_MS = 60000, DIST_MIN_M = 20;

  function txt(id, padrao) {
    var el = document.getElementById(id);
    var v = el ? String(el.textContent || '').trim() : '';
    return v && v !== '—' ? v : padrao;
  }

  function dist(a, b, c, d) {
    try { return calcularDistanciaMetros(a, b, c, d); } catch (e) { return 0; }
  }

  window.processarNovaPosicao = function (lat, lon, precisaoRaw, velRaw) {
    var r = original.apply(this, arguments);
    try {
      if (typeof appSuspenso !== 'undefined' && appSuspenso) return r;
      if (typeof registrarESincronizarPonto !== 'function' || typeof ultimaLeituraCompleta === 'undefined' || !ultimaLeituraCompleta) return r;
      if (typeof listaVeiculos === 'undefined' || !listaVeiculos.length) return r;
      var lei = ultimaLeituraCompleta;
      var precisao = lei.precisao || (precisaoRaw ? Math.round(precisaoRaw) : null);
      if (typeof PRECISAO_MAXIMA_ACEITAVEL_M !== 'undefined' && precisao && precisao > PRECISAO_MAXIMA_ACEITAVEL_M) return r;

      var agoraTs = Date.now();
      var parado = lei.status === 'PARADO';
      var intervalo = parado ? INTERVALO_PARADO_MS : INTERVALO_MOV_MS;
      var andou = ultimoLat == null ? Infinity : dist(ultimoLat, ultimoLon, lat, lon);
      if ((agoraTs - ultimoTs) < intervalo) return r;
      if (!parado && andou < DIST_MIN_M && (agoraTs - ultimoTs) < intervalo * 2) return r;

      ultimoTs = agoraTs; ultimoLat = lat; ultimoLon = lon;
      var tipoVia = (typeof viaState !== 'undefined' && viaState && viaState.tipo) ? viaState.tipo : 'rua';
      atualizarEndereco(lat, lon);
      var usaAddr = addr && addrPos && dist(addrPos[0], addrPos[1], lat, lon) < 300;
      registrarESincronizarPonto(lat, lon, lei.status || 'EM MOVIMENTO', lei.velocidade || 0, precisao, new Date(), {
        rua: usaAddr ? addr.rua : txt('txtRua', null),
        bairro: usaAddr ? addr.bairro : txt('txtBairro', null),
        cidade: usaAddr ? addr.cidade : txt('txtCidade', null),
        estado: usaAddr ? addr.estado : txt('txtEstado', null),
        tipoVia: usaAddr && addr.tipoVia ? addr.tipoVia : (tipoVia === 'rodovia' ? 'rodovia' : 'rua')
      }, 'trajeto');
    } catch (e) { console.warn('[trajeto]', e); }
    return r;
  };
})();
