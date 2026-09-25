// =============================================================
// Fera Fit — Camada de dados de demonstração (D032, 2026-09-25)
//
// Tudo aqui vive no localStorage do navegador de quem está testando.
// Nenhuma linha deste arquivo fala com o Supabase para ler ou escrever
// dado de aluno, academia ou personal — só lê imagens públicas do
// bucket "capas-43" (sem necessidade de login).
//
// Isolado numa camada só (pedido explícito da D032, item 1): quando o
// login de verdade e o Supabase entrarem, é este arquivo que muda —
// as telas que o chamam não precisam mudar.
// =============================================================

(function (global) {
  "use strict";

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var BUCKET = "capas-43";
  var CHAVE_LOCALSTORAGE = "ferafit_demo_v1";
  var CATALOGO_URL = "assets/data/catalogo-exercicios.json";

  var catalogoCache = null;
  var catalogoPromise = null;

  function urlDaImagem(arquivo) {
    return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + arquivo;
  }

  function carregarCatalogo() {
    if (catalogoCache) {
      return Promise.resolve(catalogoCache);
    }
    if (!catalogoPromise) {
      catalogoPromise = fetch(CATALOGO_URL)
        .then(function (resp) {
          if (!resp.ok) {
            throw new Error("Não consegui carregar o catálogo de exercícios (HTTP " + resp.status + ").");
          }
          return resp.json();
        })
        .then(function (lista) {
          catalogoCache = lista;
          return lista;
        });
    }
    return catalogoPromise;
  }

  function estadoPadrao() {
    return {
      versao: 1,
      academia: {
        nome: "Academia de Teste",
        // Ids do catálogo que a ACADEMIA NÃO oferece. Por padrão, tudo é
        // oferecido — a academia só precisa desmarcar o que não tem, em
        // vez de marcar 190 exercícios um por um.
        exerciciosNaoOferecidos: [],
        alunos: []
      },
      personal: {
        nome: "Personal de Teste",
        // O personal trabalha com o catálogo inteiro — não existe curadoria
        // de exercício por aparelho do lado dele (D032).
        alunos: []
      }
    };
  }

  function carregarEstado() {
    var bruto;
    try {
      bruto = localStorage.getItem(CHAVE_LOCALSTORAGE);
    } catch (e) {
      // Navegador privado ou storage bloqueado — segue com o padrão em memória.
      return estadoPadrao();
    }
    if (!bruto) {
      return estadoPadrao();
    }
    try {
      var estado = JSON.parse(bruto);
      if (!estado || estado.versao !== 1) {
        return estadoPadrao();
      }
      return estado;
    } catch (e) {
      return estadoPadrao();
    }
  }

  function salvarEstado(estado) {
    try {
      localStorage.setItem(CHAVE_LOCALSTORAGE, JSON.stringify(estado));
    } catch (e) {
      // Sem storage disponível — a sessão de teste atual continua funcionando
      // em memória, só não sobrevive a um recarregamento da página.
    }
  }

  function gerarId(prefixo) {
    return prefixo + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------

  var DadosDemo = {};

  DadosDemo.urlDaImagem = urlDaImagem;

  DadosDemo.listarCatalogo = function () {
    return carregarCatalogo();
  };

  DadosDemo.listarGrupos = function () {
    return carregarCatalogo().then(function (lista) {
      var grupos = [];
      lista.forEach(function (ex) {
        if (grupos.indexOf(ex.grupo) === -1) {
          grupos.push(ex.grupo);
        }
      });
      grupos.sort();
      return grupos;
    });
  };

  // Exercícios que a academia efetivamente oferece hoje (catálogo menos os
  // que ela desmarcou). O personal sempre recebe o catálogo inteiro.
  DadosDemo.listarExerciciosDisponiveis = function (tipoConta) {
    return carregarCatalogo().then(function (lista) {
      if (tipoConta !== "academia") {
        return lista;
      }
      var estado = carregarEstado();
      var excluidos = estado.academia.exerciciosNaoOferecidos || [];
      if (excluidos.length === 0) {
        return lista;
      }
      return lista.filter(function (ex) {
        return excluidos.indexOf(ex.id) === -1;
      });
    });
  };

  DadosDemo.exercicioEstaOferecido = function (idExercicio) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    return excluidos.indexOf(idExercicio) === -1;
  };

  DadosDemo.alternarExercicioOferecido = function (idExercicio) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    var pos = excluidos.indexOf(idExercicio);
    if (pos === -1) {
      excluidos.push(idExercicio);
    } else {
      excluidos.splice(pos, 1);
    }
    estado.academia.exerciciosNaoOferecidos = excluidos;
    salvarEstado(estado);
    return excluidos.indexOf(idExercicio) === -1; // true = está oferecido agora
  };

  DadosDemo.contarOferecidos = function (totalCatalogo) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    return totalCatalogo - excluidos.length;
  };

  // --- Alunos ---

  DadosDemo.listarAlunos = function (tipoConta, termo) {
    var estado = carregarEstado();
    var alunos = estado[tipoConta].alunos || [];
    if (termo) {
      var termoBusca = termo.trim().toLowerCase();
      alunos = alunos.filter(function (a) {
        return a.nome.toLowerCase().indexOf(termoBusca) !== -1;
      });
    }
    // Mais recente primeiro.
    return alunos.slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  DadosDemo.adicionarAluno = function (tipoConta, nome) {
    var nomeLimpo = (nome || "").trim();
    if (!nomeLimpo) {
      throw new Error("Nome do aluno não pode ficar em branco.");
    }
    var estado = carregarEstado();
    var aluno = {
      id: gerarId("aluno"),
      nome: nomeLimpo,
      criadoEm: Date.now(),
      treino: []
    };
    estado[tipoConta].alunos.push(aluno);
    salvarEstado(estado);
    return aluno;
  };

  DadosDemo.removerAluno = function (tipoConta, idAluno) {
    var estado = carregarEstado();
    estado[tipoConta].alunos = estado[tipoConta].alunos.filter(function (a) {
      return a.id !== idAluno;
    });
    salvarEstado(estado);
  };

  DadosDemo.buscarAluno = function (tipoConta, idAluno) {
    var estado = carregarEstado();
    var alunos = estado[tipoConta].alunos || [];
    for (var i = 0; i < alunos.length; i++) {
      if (alunos[i].id === idAluno) {
        return alunos[i];
      }
    }
    return null;
  };

  // --- Treino ---

  DadosDemo.adicionarExercicioAoTreino = function (tipoConta, idAluno, idExercicio) {
    var estado = carregarEstado();
    var aluno = null;
    var alunos = estado[tipoConta].alunos || [];
    for (var i = 0; i < alunos.length; i++) {
      if (alunos[i].id === idAluno) {
        aluno = alunos[i];
        break;
      }
    }
    if (!aluno) {
      return;
    }
    if (aluno.treino.indexOf(idExercicio) === -1) {
      aluno.treino.push(idExercicio);
    }
    salvarEstado(estado);
  };

  DadosDemo.removerExercicioDoTreino = function (tipoConta, idAluno, idExercicio) {
    var estado = carregarEstado();
    var alunos = estado[tipoConta].alunos || [];
    for (var i = 0; i < alunos.length; i++) {
      if (alunos[i].id === idAluno) {
        alunos[i].treino = alunos[i].treino.filter(function (id) {
          return id !== idExercicio;
        });
        break;
      }
    }
    salvarEstado(estado);
  };

  global.DadosDemo = DadosDemo;
})(window);
