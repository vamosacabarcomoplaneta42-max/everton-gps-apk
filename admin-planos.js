/* admin-planos.js — no painel admin, durante o teste grátis vigente mostra tudo liberado
   (2 mapas, plano Combo). Incluir no admin.html antes de </body>:
   <script src="admin-planos.js"></script>
*/
(function () {
  var original = window.renderizarPainelAssinatura;
  if (typeof original !== 'function') return;
  window.renderizarPainelAssinatura = function (dados) {
    try {
      var d = Object.assign({}, dados);
      var trialVigente = d.status === 'trial' && d.trialExpiraEm && new Date(d.trialExpiraEm).getTime() > Date.now();
      if (trialVigente) { d.mapasContratados = 'ambos'; d.tipo = 'combo'; }
      return original(d);
    } catch (e) {
      return original(dados);
    }
  };
})();
