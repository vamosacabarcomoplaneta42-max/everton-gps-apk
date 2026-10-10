/* planos-acesso.js — controla o que cada cliente pode usar no Everton GPS.
   Regras:
   - TESTE GRÁTIS (vigente): libera tudo (frota + família + 2 mapas).
   - ATIVO: libera só o que foi contratado (tipo + mapas).
       combo   -> frota + família + 2 mapas
       frota   -> só frota,   mapas conforme escolha (ruas / satelite / ambos)
       familia -> só família, mapas conforme escolha (ruas / satelite / ambos)
   - Vencido/suspenso: nada liberado (o app já mostra a tela de suspenso).
   Incluir no index.html DEPOIS do modo-familia.js:
   <script src="planos-acesso.js"></script>
*/
(function () {
  var db = firebase.database();
  var auth = firebase.auth();
  var CACHE_KEY = 'everton_acesso_cache';
  var estado = {};
  var empresaOuvida = null;
  var refs = [];

  function san(v) { return String(v).replace(/[.#$\[\]\/]/g, '_'); }
  function empresaAtual() { return (localStorage.getItem('empresa_id') || '').trim().toLowerCase(); }

  function normalizarMapas(v) {
    var s = String(v || '').toLowerCase().trim();
    if (s === 'ambos') return 'ambos';
    if (s.indexOf('satel') >= 0) return 'satelite';
    if (s === 'ruas' || s === 'rua') return 'ruas';
    return null;
  }

  function calcular() {
    var agora = Date.now();
    var st = estado.status;
    var trialOk = st === 'trial' && (!estado.trialExpiraEm || new Date(estado.trialExpiraEm).getTime() > agora);
    var ativoOk = st === 'ativo' && (!estado.assinaturaExpiraEm || new Date(estado.assinaturaExpiraEm).getTime() > agora);

    if (st === undefined) { // ainda não carregou: usa último valor conhecido
      try { var c = JSON.parse(localStorage.getItem(CACHE_KEY)); if (c) return c; } catch (e) {}
      return { modo: 'carregando', frota: true, familia: true, mapas: 'ruas', tipo: null };
    }
    if (trialOk) return { modo: 'trial', frota: true, familia: true, mapas: 'ambos', tipo: 'combo' };
    if (ativoOk) {
      // a página de aprovação grava tipo = "familia_ruas", "frota_ambos", "combo_ambos"...
      function limpa(v){ return String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
      var tipoBruto = limpa(estado.tipo);
      var tipo = limpa(estado.planoContratado || estado.plano).split('_')[0];
      if (['combo', 'familia', 'frota'].indexOf(tipo) === -1) tipo = tipoBruto.split('_')[0];
      var mapas = normalizarMapas(estado.mapasContratados || estado.mapas || estado.mapa || estado.mapaPermitido || estado.tipoMapa)
        || normalizarMapas(tipoBruto.split('_')[1]) || 'ruas';
      if (tipo === 'combo') return { modo: 'ativo', frota: true, familia: true, mapas: 'ambos', tipo: 'combo' };
      if (tipo === 'familia') return { modo: 'ativo', frota: false, familia: true, mapas: mapas, tipo: 'familia' };
      if (tipo === 'frota') return { modo: 'ativo', frota: true, familia: false, mapas: mapas, tipo: 'frota' };
      // ativo sem tipo definido: não libera nada até o admin definir
      return { modo: 'ativo', frota: false, familia: false, mapas: mapas, tipo: null };
    }
    return { modo: 'bloqueado', frota: false, familia: false, mapas: 'ruas', tipo: null };
  }

  function aplicar() {
    var a = calcular();
    window.EVERTON_ACESSO = a;
    if (a.modo !== 'carregando') { try { localStorage.setItem(CACHE_KEY, JSON.stringify(a)); } catch (e) {} }

    // mapas
    window.mapasPermitidosCliente = a.mapas;
    try { localStorage.setItem('empresa_mapa_escolhido', a.mapas); } catch (e) {}
    try { aplicarBloqueioMapasCliente(); } catch (e) {}

    // qualquer elemento com data-plano="frota" ou "familia" some se não liberado
    document.querySelectorAll('[data-plano]').forEach(function (el) {
      var p = el.getAttribute('data-plano');
      el.style.display = (p === 'frota' && !a.frota) || (p === 'familia' && !a.familia) ? 'none' : '';
    });

    // avisa outros scripts (ex.: modo-familia.js)
    try { window.dispatchEvent(new CustomEvent('everton-acesso', { detail: a })); } catch (e) {}
  }

  function ouvir() {
    var emp = empresaAtual();
    if (!emp || !auth.currentUser || emp === empresaOuvida) return;
    refs.forEach(function (r) { r.off(); });
    refs = []; estado = {}; empresaOuvida = emp;
    ['status', 'trialExpiraEm', 'assinaturaExpiraEm', 'tipo', 'planoContratado', 'mapasContratados', 'mapas', 'mapa'].forEach(function (campo) {
      var r = db.ref('empresas/' + san(emp) + '/' + campo);
      r.on('value', function (s) {
        estado[campo] = s.val();
        if (campo === 'status' && s.val() === null) estado.status = null; // empresa sem status
        aplicar();
      });
      refs.push(r);
    });
  }

  setInterval(ouvir, 2000);
  setInterval(aplicar, 30000); // reavalia vencimento
  auth.onAuthStateChanged(function () { setTimeout(ouvir, 300); });

  // Neutraliza o observador antigo (ele aplicava o valor cru do banco, ignorando teste grátis)
  window.observarMapasPermitidosCliente = function () {};

  // Pedido de assinatura: NÃO libera nada. Só registra o pedido e abre o WhatsApp.
  // Quem libera é você, na página de aprovação, depois de confirmar o pagamento.
  window.pedirAssinatura = function (plano, quantidade, valorTotal, mapaId) {
    var emp = empresaAtual();
    if (!emp) { alert('Configure e salve o ID da empresa antes.'); return; }
    if (plano.id === 'combo') mapaId = 'ambos';
    var email = auth.currentUser ? auth.currentUser.email : '(não logado)';
    var mapaInfo = (plano.mapas || []).filter(function (m) { return m.id === mapaId; })[0] || { label: mapaId };
    var linha = (quantidade != null && valorTotal != null)
      ? 'Qtd de ' + plano.unidadeLabel + 's: ' + quantidade + '\nMapa escolhido: ' + mapaInfo.label + '\nValor mensal: ' + formatarPrecoReais(valorTotal)
      : 'Valor: ' + plano.descPreco + '\nMapa: ' + mapaInfo.label;
    var texto = 'Quero assinar o Everton GPS\n\nPlano escolhido: ' + plano.nome + '\n' + linha + '\nID empresa: ' + emp + '\nE-mail: ' + email;
    window.open('https://wa.me/' + WHATSAPP_SUPORTE + '?text=' + encodeURIComponent(texto), '_blank');
    var conf = document.getElementById('assinarConfirmado');
    if (conf) conf.style.display = 'block';
    try {
      var up = {};
      up['empresas/' + san(emp) + '/pedidoPlano'] = {
        plano: plano.id, mapa: mapaId, quantidade: quantidade || 1, valor: valorTotal || 0,
        dataPedido: new Date().toISOString(), situacao: 'aguardando_pagamento'
      };
      enviarAtualizacoesFirebase(up).catch(function () {});
    } catch (e) {}
  };

  aplicar();
})();
