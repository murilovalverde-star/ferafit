// =============================================================
// Fera Fit — Camada de dados de demonstração
//
// Tudo aqui vive no localStorage do navegador de quem está testando.
// Nenhuma linha deste arquivo fala com o Supabase para ler ou escrever
// dado de aluno, academia ou personal — só lê imagens públicas do
// bucket "capas-43" (sem necessidade de login).
//
// Isolado numa camada só (pedido explícito da D032, item 1): quando o
// login de verdade e o Supabase entrarem, é este arquivo que muda —
// as telas que o chamam não precisam mudar.
//
// D032 (2026-09-25): catálogo, alunos (nome só) e treino simples.
// 2026-09-29 (pedido direto de Murilo, sem número de demanda): cadastro
// completo de aluno (22 campos Academia / 30 campos Personal, conforme
// `Modelo_Cadastro_Academia_e_Personal.xlsx`), ID único gerado pelo
// sistema (confirmado por Murilo — não é campo de formulário, e vale
// pros dois tipos de conta), medições com histórico, treinos-base
// (até 20 por profissional), sugestão de exercício, e o motor de
// pré-preenchimento por tipo de treino/tempo/série/descanso — baseado
// em `RESUMO_TREINOS_PARA_SITE.md` (Lógica e Testes, 2026-09-29).
//
// IMPORTANTE sobre o pré-preenchimento: o documento de referência lista
// os exercícios EXATOS que o motor do app escolhe, mas ~63% deles (24 de
// 38 nomes únicos conferidos) não existem no catálogo de 190 exercícios
// deste site (`catalogo-exercicios.json`) — são nomes em inglês de um
// catálogo do app que não foi sincronizado com o do site. Não dá pra
// prometer "exatamente os mesmos exercícios" com o catálogo que o site
// tem hoje. Por isso o motor abaixo replica fielmente GRUPO e SUBGRUPO
// (e a ordem de prioridade) de cada dia/tipo/sexo, mas escolhe o
// exercício de dentro do catálogo do PRÓPRIO site — o resultado é do
// mesmo padrão do app (mesmos grupos, mesma ordem, mesma ênfase por
// sexo), mas pode divergir na escolha fina do exercício. Como o
// professor sempre pode excluir/alterar/incluir depois (pedido de
// Murilo), isso fica como ponto de partida, não como promessa de
// paridade perfeita — ver STATUS.md para o registro completo do achado.
//
// 2026-09-29 (rodada 2 de feedback, P24 do STATUS.md): validação de
// CPF (dígito verificador), formatação de telefone/telefone de
// emergência (+55 (DD) 9XXXX-XXXX) e campo `observacao` (privado,
// visível só a quem cadastrou o aluno — ver nota no esqueleto abaixo).
// `consultarCEP` chama o ViaCEP (viacep.com.br) para autofill de
// endereço — é um serviço público de terceiros (não é dos Correios,
// que cobram por contrato comercial; verificado antes de implementar),
// SEM relação com Supabase — a regra do parágrafo acima (nenhuma linha
// fala com o Supabase para dado de aluno/academia/personal) continua
// valendo à risca.
// =============================================================

(function (global) {
  "use strict";

  var SUPABASE_URL = "https://jgzbxouzqtwfjapnfooj.supabase.co";
  var BUCKET = "capas-43";
  var CHAVE_LOCALSTORAGE = "ferafit_demo_v2";
  var CHAVE_LOCALSTORAGE_V1 = "ferafit_demo_v1";
  var CATALOGO_URL = "assets/data/catalogo-exercicios.json";
  var MAX_TREINOS_BASE = 20;

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
      versao: 2,
      // Contador global do "ID único do aluno" (confirmado por Murilo,
      // 2026-09-29: gerado pelo sistema, não é campo de formulário,
      // compartilhado entre alunos cadastrados por Academia OU Personal).
      proximoIdAluno: 1,
      academia: {
        nome: "Academia de Teste",
        exerciciosNaoOferecidos: [],
        alunos: [],
        treinosBase: [],
        sugestoesExercicio: []
      },
      personal: {
        nome: "Personal de Teste",
        alunos: [],
        treinosBase: [],
        sugestoesExercicio: []
      },
      portfolio: {
        personais: []
      }
    };
  }

  function migrarDeV1() {
    var brutoV1;
    try {
      brutoV1 = localStorage.getItem(CHAVE_LOCALSTORAGE_V1);
    } catch (e) {
      return null;
    }
    if (!brutoV1) {
      return null;
    }
    try {
      var v1 = JSON.parse(brutoV1);
      if (!v1 || v1.versao !== 1) {
        return null;
      }
      var novo = estadoPadrao();
      novo.academia.nome = v1.academia.nome || novo.academia.nome;
      novo.academia.exerciciosNaoOferecidos = v1.academia.exerciciosNaoOferecidos || [];
      novo.personal.nome = v1.personal.nome || novo.personal.nome;
      novo.portfolio = v1.portfolio || novo.portfolio;
      // Alunos antigos (só nome + treino simples) viram alunos "incompletos" —
      // continuam aparecendo, só sem os campos novos preenchidos ainda.
      ["academia", "personal"].forEach(function (tipoConta) {
        var alunosAntigos = (v1[tipoConta] && v1[tipoConta].alunos) || [];
        alunosAntigos.forEach(function (a) {
          var alunoNovo = criarEsqueletoAluno(novo, tipoConta, a.nome || "Aluno sem nome");
          alunoNovo.criadoEm = a.criadoEm || Date.now();
          alunoNovo.treino.exercicios = a.treino || [];
          novo[tipoConta].alunos.push(alunoNovo);
        });
      });
      return novo;
    } catch (e) {
      return null;
    }
  }

  function carregarEstado() {
    var bruto;
    try {
      bruto = localStorage.getItem(CHAVE_LOCALSTORAGE);
    } catch (e) {
      return estadoPadrao();
    }
    if (!bruto) {
      var migrado = migrarDeV1();
      if (migrado) {
        salvarEstado(migrado);
        return migrado;
      }
      return estadoPadrao();
    }
    try {
      var estado = JSON.parse(bruto);
      if (!estado || estado.versao !== 2) {
        return estadoPadrao();
      }
      if (!estado.portfolio) {
        estado.portfolio = { personais: [] };
      }
      ["academia", "personal"].forEach(function (tipoConta) {
        if (!estado[tipoConta].treinosBase) estado[tipoConta].treinosBase = [];
        if (!estado[tipoConta].sugestoesExercicio) estado[tipoConta].sugestoesExercicio = [];
      });
      if (!estado.proximoIdAluno) estado.proximoIdAluno = 1;
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

  function gerarIdAlunoLegivel(estado) {
    var n = estado.proximoIdAluno || 1;
    estado.proximoIdAluno = n + 1;
    return "FF" + String(n).padStart(5, "0");
  }

  function hojeISO() {
    var d = new Date();
    return d.toISOString().slice(0, 10);
  }

  function encontrarAluno(estado, tipoConta, idAluno) {
    var alunos = estado[tipoConta].alunos || [];
    for (var i = 0; i < alunos.length; i++) {
      if (alunos[i].id === idAluno) {
        return alunos[i];
      }
    }
    return null;
  }

  function criarEsqueletoAluno(estado, tipoConta, nome) {
    return {
      id: gerarIdAlunoLegivel(estado),
      tipoContaOrigem: tipoConta,
      criadoEm: Date.now(),
      atualizadoEm: Date.now(),
      // Identificação
      nome: (nome || "").trim(),
      dataNascimento: "",
      cpf: "",
      rg: "",
      sexo: "",
      email: "",
      telefone: "",
      endereco: { cep: "", rua: "", numero: "", bairro: "", cidade: "" },
      contatoEmergenciaNome: "",
      contatoEmergenciaTelefone: "",
      // Observação livre — acesso exclusivo de quem cadastrou o aluno.
      // Hoje a "conta" é só Academia OU Personal (login ainda cosmético,
      // sem usuário individual — ver P24/A8 do STATUS.md), então a
      // exclusividade é aplicada no nível de tipoContaOrigem: só o
      // painel do mesmo tipo que cadastrou o aluno mostra/edita este
      // campo. Quando entrar autenticação real, isso pode ficar restrito
      // à pessoa exata que cadastrou, não só ao tipo de conta.
      observacao: "",
      // Contrato / financeiro
      contrato: {
        plano: "",
        formaPagamento: "",
        dataInicio: "",
        termoResponsabilidade: false,
        atestadoMedico: false // só relevante pro Personal
      },
      // Anamnese (campos usados variam por tipoContaOrigem — ver formulário)
      anamnese: {
        objetivo: "",
        nivelExperiencia: "",
        frequenciaSemanalDesejada: "",
        historicoAtividade: "",
        doencas: "",
        lesoes: "",
        medicamentos: "",
        restricoesMedicas: "",
        gestacaoPosParto: "",
        habitos: ""
      },
      // Avaliação física
      avaliacaoFisica: {
        medicoes: [], // { data, altura, peso, percentualGordura, abdomen, quadril, peito, braco, coxa }
        testesFisicos: "",
        temFoto: false
      },
      // Contato complementar (Personal, opcional)
      profissao: "",
      redesSociais: "",
      preferenciaHorario: "",
      // Dias de treino
      diasTreino: {
        comAcademia: [], // dias da semana treinando na academia (tipoContaOrigem academia)
        presencialComPersonal: [], // dias presenciais com o personal
        soApp: [] // dias sem presença, só com o app
      },
      // Treino
      treino: {
        modo: "nenhum", // 'nenhum' | 'base' | 'personalizado'
        baseId: null,
        exercicios: [],
        config: { tipoDivisao: "", tempoMinutos: 60, series: 3, descanso: 60 },
        atualizadoEm: null
      }
    };
  }

  // ---------------------------------------------------------------
  // Motor de pré-preenchimento — grupos/subgrupos por tipo/dia/sexo,
  // fielmente transcritos da seção 6 de RESUMO_TREINOS_PARA_SITE.md
  // (fase ouro, treino nº1 — única fase que o site mostra, decisão de
  // Murilo). Cada slot é [grupo, subgrupo-preferido-ou-null].
  // ---------------------------------------------------------------

  var SLOTS_TREINO = {
    full_body: {
      nome: "Full Body",
      dias: [
        {
          codigo: "unico", nome: "Dia único",
          slots: {
            masculino: [["Costas", "Remada"], ["Quadríceps", null], ["Peito", "Superior"], ["Posteriores de coxa", null], ["Bíceps", "Cabeça longa"], ["Abdômen", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Panturrilha", null], ["Ombros", "Posterior"]],
            feminino: [["Quadríceps", null], ["Costas", "Remada"], ["Glúteos", "Glúteo máximo"], ["Posteriores de coxa", null], ["Peito", "Superior"], ["Abdômen", "Superior"], ["Panturrilha", null], ["Ombros", "Posterior"], ["Adutores", null]]
          }
        }
      ]
    },
    upper_lower: {
      nome: "AB (Superior/Inferior)",
      dias: [
        {
          codigo: "A", nome: "Dia A (Superior)",
          slots: {
            masculino: [["Costas", "Remada"], ["Peito", "Superior"], ["Bíceps", "Cabeça longa"], ["Tríceps", "Pulley — empurrando para baixo"], ["Ombros", "Posterior"], ["Costas", "Puxada"], ["Peito", "Média"], ["Trapézio", null], ["Antebraço", null]],
            feminino: [["Costas", "Remada"], ["Peito", "Superior"], ["Bíceps", "Cabeça longa"], ["Tríceps", "Pulley — empurrando para baixo"], ["Ombros", "Posterior"], ["Costas", "Puxada"], ["Peito", "Média"], ["Trapézio", null], ["Antebraço", null]]
          }
        },
        {
          codigo: "B", nome: "Dia B (Inferior)",
          slots: {
            masculino: [["Quadríceps", null], ["Abdômen", "Médio"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Oblíquos", null], ["Adutores", null], ["Glúteos", "Glúteo médio e mínimo"], ["Lombar", null], ["Quadríceps", null]],
            feminino: [["Quadríceps", null], ["Abdômen", "Médio"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Oblíquos", null], ["Adutores", null], ["Glúteos", "Glúteo médio e mínimo"], ["Lombar", null], ["Quadríceps", null]]
          }
        }
      ]
    },
    abc: {
      nome: "ABC (Push/Pull/Legs)",
      dias: [
        {
          codigo: "A", nome: "Dia A (Push)",
          slots: {
            masculino: [["Peito", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Ombros", "Posterior"], ["Peito", "Média"], ["Tríceps", "Testa — empurrando para frente"], ["Ombros", "Lateral"], ["Peito", "Inferior"], ["Tríceps", "Francês — empurrando para cima"], ["Ombros", "Superior"]],
            feminino: [["Peito", "Superior"], ["Ombros", "Posterior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Peito", "Média"], ["Ombros", "Lateral"], ["Tríceps", "Testa — empurrando para frente"], ["Peito", "Inferior"], ["Ombros", "Superior"], ["Tríceps", "Francês — empurrando para cima"]]
          }
        },
        {
          codigo: "B", nome: "Dia B (Pull)",
          slots: {
            masculino: [["Costas", "Puxada"], ["Bíceps", "Braquial"], ["Costas", "Remada"], ["Lombar", null], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Bíceps", "Cabeça longa"], ["Trapézio", null], ["Antebraço", null]],
            feminino: [["Costas", "Puxada"], ["Bíceps", "Braquial"], ["Costas", "Remada"], ["Lombar", null], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Bíceps", "Cabeça longa"], ["Trapézio", null], ["Antebraço", null]]
          }
        },
        {
          codigo: "C", nome: "Dia C (Pernas + Core)",
          slots: {
            masculino: [["Quadríceps", null], ["Posteriores de coxa", null], ["Abdômen", "Inferior"], ["Panturrilha", null], ["Adutores", null], ["Glúteos", "Glúteo máximo"], ["Oblíquos", null], ["Quadríceps", null], ["Posteriores de coxa", null]],
            feminino: [["Quadríceps", null], ["Glúteos", "Glúteo máximo"], ["Abdômen", "Inferior"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null], ["Oblíquos", null], ["Quadríceps", null], ["Glúteos", "Glúteo médio e mínimo"]]
          }
        }
      ]
    },
    abcde: {
      nome: "ABCDE",
      dias: [
        {
          codigo: "A", nome: "Dia A (Peito+Tríceps)",
          slots: {
            masculino: [["Peito", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Peito", "Média"], ["Tríceps", "Testa — empurrando para frente"], ["Peito", "Inferior"], ["Tríceps", "Francês — empurrando para cima"], ["Peito", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Peito", "Média"]],
            feminino: [["Peito", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Peito", "Média"], ["Tríceps", "Testa — empurrando para frente"], ["Peito", "Inferior"], ["Tríceps", "Francês — empurrando para cima"], ["Peito", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Peito", "Média"]]
          }
        },
        {
          codigo: "B", nome: "Dia B (Costas+Bíceps)",
          slots: {
            masculino: [["Costas", "Puxada"], ["Bíceps", "Braquial"], ["Costas", "Remada"], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Bíceps", "Cabeça longa"], ["Costas", "Remada"], ["Bíceps", "Braquial"], ["Antebraço", null]],
            feminino: [["Costas", "Puxada"], ["Bíceps", "Braquial"], ["Costas", "Remada"], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Bíceps", "Cabeça longa"], ["Costas", "Remada"], ["Bíceps", "Braquial"], ["Antebraço", null]]
          }
        },
        {
          codigo: "C", nome: "Dia C (Pernas completas)",
          slots: {
            masculino: [["Quadríceps", null], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null], ["Glúteos", "Glúteo máximo"], ["Quadríceps", null], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null]],
            feminino: [["Quadríceps", null], ["Glúteos", "Glúteo máximo"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null], ["Quadríceps", null], ["Glúteos", "Glúteo médio e mínimo"], ["Posteriores de coxa", null], ["Panturrilha", null]]
          }
        },
        {
          codigo: "D", nome: "Dia D (Ombros+Trapézio+Core)",
          slots: {
            masculino: [["Abdômen", "Superior"], ["Ombros", "Posterior"], ["Lombar", null], ["Ombros", "Lateral"], ["Oblíquos", null], ["Abdômen", "Médio"], ["Ombros", "Superior"], ["Lombar", null], ["Trapézio", null]],
            feminino: [["Abdômen", "Superior"], ["Ombros", "Posterior"], ["Lombar", null], ["Ombros", "Lateral"], ["Oblíquos", null], ["Abdômen", "Médio"], ["Ombros", "Superior"], ["Lombar", null], ["Trapézio", null]]
          }
        },
        {
          codigo: "E", nome: "Dia E (Especialização por sexo)",
          slots: {
            masculino: [["Costas", "Puxada"], ["Peito", "Média"], ["Bíceps", "Braquial"], ["Tríceps", "Testa — empurrando para frente"], ["Ombros", "Lateral"], ["Costas", "Remada"], ["Peito", "Inferior"], ["Trapézio", null], ["Antebraço", null]],
            feminino: [["Quadríceps", null], ["Glúteos", "Glúteo médio e mínimo"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null], ["Quadríceps", null], ["Glúteos", "Glúteo máximo"], ["Posteriores de coxa", null], ["Panturrilha", null]]
          }
        }
      ]
    },
    pplul: {
      nome: "ABC P SI (Push/Pull/Legs + Superior/Inferior)",
      dias: [
        {
          codigo: "A", nome: "Dia A (Push - Seg)",
          slots: {
            masculino: [["Peito", "Superior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Ombros", "Posterior"], ["Peito", "Média"], ["Tríceps", "Testa — empurrando para frente"], ["Ombros", "Lateral"], ["Peito", "Inferior"], ["Tríceps", "Francês — empurrando para cima"], ["Ombros", "Superior"]],
            feminino: [["Peito", "Superior"], ["Ombros", "Posterior"], ["Tríceps", "Pulley — empurrando para baixo"], ["Peito", "Média"], ["Ombros", "Lateral"], ["Tríceps", "Testa — empurrando para frente"], ["Peito", "Inferior"], ["Ombros", "Superior"], ["Tríceps", "Francês — empurrando para cima"]]
          }
        },
        {
          codigo: "B", nome: "Dia B (Pull - Ter)",
          slots: {
            masculino: [["Costas", "Puxada"], ["Bíceps", "Braquial"], ["Costas", "Remada"], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Bíceps", "Cabeça longa"], ["Costas", "Remada"], ["Trapézio", null], ["Antebraço", null]],
            feminino: [["Costas", "Puxada"], ["Bíceps", "Braquial"], ["Costas", "Remada"], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Bíceps", "Cabeça longa"], ["Costas", "Remada"], ["Trapézio", null], ["Antebraço", null]]
          }
        },
        {
          codigo: "C", nome: "Dia C (Legs - Qua)",
          slots: {
            masculino: [["Quadríceps", null], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null], ["Glúteos", "Glúteo máximo"], ["Quadríceps", null], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null]],
            feminino: [["Quadríceps", null], ["Glúteos", "Glúteo máximo"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Adutores", null], ["Quadríceps", null], ["Glúteos", "Glúteo médio e mínimo"], ["Posteriores de coxa", null], ["Panturrilha", null]]
          }
        },
        {
          codigo: "S", nome: "Dia S (Superior - Sex)",
          slots: {
            masculino: [["Costas", "Remada"], ["Peito", "Inferior"], ["Bíceps", "Cabeça curta"], ["Tríceps", "Francês — empurrando para cima"], ["Ombros", "Superior"], ["Costas", "Puxada"], ["Peito", "Superior"], ["Trapézio", null], ["Antebraço", null]],
            feminino: [["Costas", "Remada"], ["Peito", "Inferior"], ["Ombros", "Superior"], ["Tríceps", "Francês — empurrando para cima"], ["Bíceps", "Cabeça curta"], ["Costas", "Puxada"], ["Peito", "Superior"], ["Trapézio", null], ["Antebraço", null]]
          }
        },
        {
          codigo: "I", nome: "Dia I (Inferior - Sáb)",
          slots: {
            masculino: [["Quadríceps", null], ["Abdômen", "Médio"], ["Posteriores de coxa", null], ["Panturrilha", null], ["Oblíquos", null], ["Adutores", null], ["Glúteos", "Glúteo médio e mínimo"], ["Lombar", null], ["Quadríceps", null]],
            feminino: [["Quadríceps", null], ["Abdômen", "Médio"], ["Glúteos", "Glúteo médio e mínimo"], ["Posteriores de coxa", null], ["Oblíquos", null], ["Panturrilha", null], ["Adutores", null], ["Lombar", null], ["Quadríceps", null]]
          }
        }
      ]
    }
  };

  // Valores aceitos (seção 1 de RESUMO_TREINOS_PARA_SITE.md) — usar
  // exatamente esta lista no site, não inventar outra.
  var TEMPOS_MINUTOS = [30, 40, 50, 60, 70, 80, 90, 105, 120, 150, 180];
  var SERIES_OPCOES = [2, 3, 4, 5];
  var DESCANSO_OPCOES = [30, 45, 60, 90, 180, 240, 300];
  var SERIES_PADRAO = 3;
  var DESCANSO_PADRAO = 60;

  function calcularQuantidadeExercicios(tempoMinutos, series, descanso) {
    var tempoPorExercicio = series * (70 + descanso);
    var qtd = Math.floor((tempoMinutos * 60) / tempoPorExercicio);
    return Math.max(1, qtd);
  }

  // Escolhe, dentro do catálogo disponível, um exercício do grupo (e
  // subgrupo, se houver e existir) ainda não usado neste treino.
  function escolherExercicio(catalogoDisponivel, usados, grupo, subgrupo) {
    var candidatos = catalogoDisponivel.filter(function (ex) {
      return ex.grupo === grupo && usados.indexOf(ex.id) === -1;
    });
    if (subgrupo) {
      var comSubgrupo = candidatos.filter(function (ex) {
        return ex.subgrupo === subgrupo;
      });
      if (comSubgrupo.length > 0) {
        candidatos = comSubgrupo;
      }
    }
    return candidatos.length > 0 ? candidatos[0] : null;
  }

  // ---------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------

  var DadosDemo = {};

  DadosDemo.urlDaImagem = urlDaImagem;
  DadosDemo.TEMPOS_MINUTOS = TEMPOS_MINUTOS;
  DadosDemo.SERIES_OPCOES = SERIES_OPCOES;
  DadosDemo.DESCANSO_OPCOES = DESCANSO_OPCOES;
  DadosDemo.SERIES_PADRAO = SERIES_PADRAO;
  DadosDemo.DESCANSO_PADRAO = DESCANSO_PADRAO;
  DadosDemo.MAX_TREINOS_BASE = MAX_TREINOS_BASE;

  DadosDemo.listarTiposTreino = function () {
    return Object.keys(SLOTS_TREINO).map(function (chave) {
      return { chave: chave, nome: SLOTS_TREINO[chave].nome };
    });
  };

  DadosDemo.listarDiasDoTipo = function (tipoDivisao) {
    var tipo = SLOTS_TREINO[tipoDivisao];
    if (!tipo) return [];
    return tipo.dias.map(function (d) {
      return { codigo: d.codigo, nome: d.nome };
    });
  };

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
    return excluidos.indexOf(idExercicio) === -1;
  };

  DadosDemo.contarOferecidos = function (totalCatalogo) {
    var estado = carregarEstado();
    var excluidos = estado.academia.exerciciosNaoOferecidos || [];
    return totalCatalogo - excluidos.length;
  };

  // --- Alunos (cadastro completo, 2026-09-29) ---

  DadosDemo.listarAlunos = function (tipoConta, termo) {
    var estado = carregarEstado();
    var alunos = estado[tipoConta].alunos || [];
    if (termo) {
      var t = termo.trim().toLowerCase();
      var tDigitos = t.replace(/\D/g, "");
      alunos = alunos.filter(function (a) {
        if (a.nome.toLowerCase().indexOf(t) !== -1) return true;
        if (a.id.toLowerCase().indexOf(t) !== -1) return true;
        if (tDigitos && (a.cpf || "").replace(/\D/g, "").indexOf(tDigitos) !== -1) return true;
        if (tDigitos && (a.telefone || "").replace(/\D/g, "").indexOf(tDigitos) !== -1) return true;
        return false;
      });
    }
    return alunos.slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  // dados = objeto com todos os campos do formulário (ver parceiro.html).
  // Campos não enviados ficam com o valor padrão do esqueleto.
  DadosDemo.cadastrarAluno = function (tipoConta, dados) {
    var nomeLimpo = ((dados && dados.nome) || "").trim();
    if (!nomeLimpo) {
      throw new Error("Nome do aluno não pode ficar em branco.");
    }
    var estado = carregarEstado();
    var aluno = criarEsqueletoAluno(estado, tipoConta, nomeLimpo);
    aplicarCamposAluno(aluno, dados);
    estado[tipoConta].alunos.push(aluno);
    salvarEstado(estado);
    return aluno;
  };

  DadosDemo.atualizarAluno = function (tipoConta, idAluno, dados) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) {
      throw new Error("Aluno não encontrado.");
    }
    aplicarCamposAluno(aluno, dados);
    aluno.atualizadoEm = Date.now();
    salvarEstado(estado);
    return aluno;
  };

  function aplicarCamposAluno(aluno, dados) {
    if (!dados) return;
    var camposDiretos = ["nome", "dataNascimento", "cpf", "rg", "sexo", "email", "telefone",
      "contatoEmergenciaNome", "contatoEmergenciaTelefone", "profissao", "redesSociais", "preferenciaHorario",
      "observacao"];
    camposDiretos.forEach(function (campo) {
      if (dados[campo] !== undefined) {
        aluno[campo] = (dados[campo] || "").toString().trim();
      }
    });
    if (dados.endereco) {
      Object.keys(aluno.endereco).forEach(function (k) {
        if (dados.endereco[k] !== undefined) aluno.endereco[k] = (dados.endereco[k] || "").trim();
      });
    }
    if (dados.contrato) {
      Object.keys(aluno.contrato).forEach(function (k) {
        if (dados.contrato[k] !== undefined) aluno.contrato[k] = dados.contrato[k];
      });
    }
    if (dados.anamnese) {
      Object.keys(aluno.anamnese).forEach(function (k) {
        if (dados.anamnese[k] !== undefined) aluno.anamnese[k] = (dados.anamnese[k] || "").toString().trim();
      });
    }
    if (dados.avaliacaoFisica) {
      if (dados.avaliacaoFisica.testesFisicos !== undefined) {
        aluno.avaliacaoFisica.testesFisicos = dados.avaliacaoFisica.testesFisicos;
      }
      if (dados.avaliacaoFisica.temFoto !== undefined) {
        aluno.avaliacaoFisica.temFoto = !!dados.avaliacaoFisica.temFoto;
      }
    }
    if (dados.diasTreino) {
      Object.keys(aluno.diasTreino).forEach(function (k) {
        if (dados.diasTreino[k] !== undefined) aluno.diasTreino[k] = dados.diasTreino[k];
      });
    }
  }

  DadosDemo.adicionarMedicao = function (tipoConta, idAluno, medicao) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) {
      throw new Error("Aluno não encontrado.");
    }
    var registro = {
      data: (medicao && medicao.data) || hojeISO(),
      altura: (medicao && medicao.altura) || "",
      peso: (medicao && medicao.peso) || "",
      percentualGordura: (medicao && medicao.percentualGordura) || "",
      abdomen: (medicao && medicao.abdomen) || "",
      quadril: (medicao && medicao.quadril) || "",
      peito: (medicao && medicao.peito) || "",
      braco: (medicao && medicao.braco) || "",
      coxa: (medicao && medicao.coxa) || ""
    };
    aluno.avaliacaoFisica.medicoes.push(registro);
    aluno.atualizadoEm = Date.now();
    salvarEstado(estado);
    return registro;
  };

  // Peso inicial/atual — usados pelo cartão de Montar Treino.
  DadosDemo.pesoInicialEAtual = function (aluno) {
    var medicoes = (aluno.avaliacaoFisica && aluno.avaliacaoFisica.medicoes) || [];
    if (medicoes.length === 0) {
      return { inicial: null, atual: null };
    }
    var ordenadas = medicoes.slice().sort(function (a, b) {
      return a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
    });
    return {
      inicial: ordenadas[0].peso || null,
      atual: ordenadas[ordenadas.length - 1].peso || null
    };
  };

  DadosDemo.calcularIdade = function (dataNascimentoISO) {
    if (!dataNascimentoISO) return null;
    var nasc = new Date(dataNascimentoISO);
    if (isNaN(nasc.getTime())) return null;
    var hoje = new Date();
    var idade = hoje.getFullYear() - nasc.getFullYear();
    var m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) {
      idade--;
    }
    return idade;
  };

  // Algoritmo padrão de dígito verificador do CPF — client-side, sem
  // depender de nenhuma API. Retorna true só se os 11 dígitos batem
  // com as duas checagens (não aceita sequências tipo "111.111.111-11").
  DadosDemo.validarCPF = function (cpf) {
    var digitos = String(cpf || "").replace(/\D/g, "");
    if (digitos.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(digitos)) return false;
    function digitoVerificador(base, pesoInicial) {
      var soma = 0;
      for (var i = 0; i < base.length; i++) {
        soma += parseInt(base.charAt(i), 10) * (pesoInicial - i);
      }
      var resto = (soma * 10) % 11;
      return resto === 10 ? 0 : resto;
    }
    var d1 = digitoVerificador(digitos.substring(0, 9), 10);
    if (d1 !== parseInt(digitos.charAt(9), 10)) return false;
    var d2 = digitoVerificador(digitos.substring(0, 10), 11);
    if (d2 !== parseInt(digitos.charAt(10), 10)) return false;
    return true;
  };

  // Máscara progressiva "000.000.000-00", usada enquanto o usuário digita.
  DadosDemo.formatarCPF = function (valor) {
    var d = String(valor || "").replace(/\D/g, "").slice(0, 11);
    var saida = d.slice(0, 3);
    if (d.length > 3) saida += "." + d.slice(3, 6);
    if (d.length > 6) saida += "." + d.slice(6, 9);
    if (d.length > 9) saida += "-" + d.slice(9, 11);
    return saida;
  };

  // Máscara progressiva "+55 (DD) 9XXXX-XXXX", usada enquanto o
  // usuário digita telefone ou telefone de emergência.
  DadosDemo.formatarTelefoneBR = function (valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.indexOf("55") === 0 && d.length > 11) d = d.slice(2);
    d = d.slice(0, 11);
    var ddd = d.slice(0, 2);
    var numero = d.slice(2);
    var saida = "+55";
    if (ddd.length > 0) saida += " (" + ddd + (ddd.length === 2 ? ")" : "");
    if (numero.length > 0) saida += " " + numero.slice(0, 5);
    if (numero.length > 5) saida += "-" + numero.slice(5, 9);
    return saida;
  };

  // true só quando DDD (2 dígitos) + número (9 dígitos) estão completos.
  DadosDemo.telefoneEstaCompleto = function (valor) {
    var d = String(valor || "").replace(/\D/g, "");
    if (d.indexOf("55") === 0 && d.length > 11) d = d.slice(2);
    return d.length === 11;
  };

  // Autofill de endereço a partir do CEP — usa o ViaCEP (viacep.com.br),
  // serviço público de terceiros, gratuito, sem chave/cadastro (a API
  // oficial dos Correios exige contrato comercial pago — verificado em
  // 2026-09-29, não é uma opção viável aqui). Nunca lança erro: se o CEP
  // não existir ou a rede falhar, resolve com null e o formulário
  // continua 100% preenchível à mão — autofill é sempre um "a mais",
  // nunca um bloqueio.
  DadosDemo.consultarCEP = function (cep) {
    var digitos = String(cep || "").replace(/\D/g, "");
    if (digitos.length !== 8) {
      return Promise.resolve(null);
    }
    return fetch("https://viacep.com.br/ws/" + digitos + "/json/")
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (dados) {
        if (!dados || dados.erro) return null;
        return {
          rua: dados.logradouro || "",
          bairro: dados.bairro || "",
          cidade: dados.localidade || ""
        };
      })
      .catch(function () {
        return null;
      });
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
    return encontrarAluno(estado, tipoConta, idAluno);
  };

  // --- Treino ---

  DadosDemo.adicionarExercicioAoTreino = function (tipoConta, idAluno, idExercicio) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) return;
    if (aluno.treino.exercicios.indexOf(idExercicio) === -1) {
      aluno.treino.exercicios.push(idExercicio);
    }
    // Editar depois de aplicar uma base transforma em personalizado —
    // a base salva na biblioteca do profissional não é tocada (pedido
    // literal de Murilo: "alterar o base não muda, apenas vira personalizado").
    if (aluno.treino.modo === "base") {
      aluno.treino.modo = "personalizado";
    } else if (aluno.treino.modo === "nenhum") {
      aluno.treino.modo = "personalizado";
    }
    aluno.treino.atualizadoEm = Date.now();
    salvarEstado(estado);
  };

  DadosDemo.removerExercicioDoTreino = function (tipoConta, idAluno, idExercicio) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    if (!aluno) return;
    aluno.treino.exercicios = aluno.treino.exercicios.filter(function (id) {
      return id !== idExercicio;
    });
    if (aluno.treino.modo === "base") {
      aluno.treino.modo = "personalizado";
    }
    aluno.treino.atualizadoEm = Date.now();
    salvarEstado(estado);
  };

  // Gera o treino pré-definido (tipo de divisão + dia + tempo/série/descanso)
  // a partir do catálogo do PRÓPRIO site — ver aviso no topo do arquivo
  // sobre a diferença em relação ao catálogo do app.
  DadosDemo.gerarTreinoPreDefinido = function (tipoConta, idAluno, opcoes) {
    return DadosDemo.listarExerciciosDisponiveis(tipoConta).then(function (catalogo) {
      var tipo = SLOTS_TREINO[opcoes.tipoDivisao];
      if (!tipo) {
        throw new Error("Tipo de treino desconhecido: " + opcoes.tipoDivisao);
      }
      var dia = tipo.dias.filter(function (d) { return d.codigo === opcoes.diaCodigo; })[0];
      if (!dia) {
        throw new Error("Dia \"" + opcoes.diaCodigo + "\" não existe no tipo \"" + opcoes.tipoDivisao + "\". Use DadosDemo.listarDiasDoTipo() para pegar os códigos válidos.");
      }
      var sexo = opcoes.sexo === "feminino" ? "feminino" : "masculino";
      var slotsBase = dia.slots[sexo];
      var series = opcoes.series || SERIES_PADRAO;
      var descanso = opcoes.descanso || DESCANSO_PADRAO;
      var tempoMinutos = opcoes.tempoMinutos || 60;
      var qtd = calcularQuantidadeExercicios(tempoMinutos, series, descanso);

      // Monta a lista de slots-alvo: até 9 vem direto da referência
      // (já ordenada por prioridade); além de 9, repete a mesma ordem de
      // prioridade numa 2ª volta, pulando grupos travados em 1 (Trapézio,
      // Antebraço, e os de core: Abdômen/Oblíquos/Lombar).
      var GRUPOS_TRAVADOS_EM_1 = ["Trapézio", "Antebraço", "Abdômen", "Oblíquos", "Lombar"];
      var slotsAlvo = slotsBase.slice(0, Math.min(qtd, slotsBase.length));
      if (qtd > slotsBase.length) {
        var faltam = qtd - slotsBase.length;
        var segundaVolta = slotsBase.filter(function (s) {
          return GRUPOS_TRAVADOS_EM_1.indexOf(s[0]) === -1;
        });
        for (var v = 0; v < faltam && segundaVolta.length > 0; v++) {
          slotsAlvo.push(segundaVolta[v % segundaVolta.length]);
        }
      }

      var usados = [];
      var exerciciosEscolhidos = [];
      var gruposNaoEncontrados = [];
      slotsAlvo.forEach(function (slot) {
        var ex = escolherExercicio(catalogo, usados, slot[0], slot[1]);
        if (!ex) {
          // catálogo da academia pode ter excluído tudo daquele grupo —
          // tenta de novo sem exigir o subgrupo específico.
          ex = escolherExercicio(catalogo, usados, slot[0], null);
        }
        if (ex) {
          usados.push(ex.id);
          exerciciosEscolhidos.push(ex.id);
        } else {
          gruposNaoEncontrados.push(slot[0]);
        }
      });

      var estado = carregarEstado();
      var aluno = encontrarAluno(estado, tipoConta, idAluno);
      if (!aluno) {
        throw new Error("Aluno não encontrado.");
      }
      aluno.treino.modo = "personalizado";
      aluno.treino.baseId = null;
      aluno.treino.exercicios = exerciciosEscolhidos;
      aluno.treino.config = { tipoDivisao: opcoes.tipoDivisao, diaCodigo: dia.codigo, tempoMinutos: tempoMinutos, series: series, descanso: descanso };
      aluno.treino.atualizadoEm = Date.now();
      salvarEstado(estado);

      return { aluno: aluno, quantidadeAlvo: qtd, gruposNaoEncontrados: gruposNaoEncontrados };
    });
  };

  // --- Treinos-base (biblioteca do profissional, até 20) ---

  DadosDemo.listarTreinosBase = function (tipoConta) {
    var estado = carregarEstado();
    return (estado[tipoConta].treinosBase || []).slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  DadosDemo.salvarTreinoBase = function (tipoConta, nome, exercicios) {
    var nomeLimpo = (nome || "").trim();
    if (!nomeLimpo) {
      throw new Error("Dê um nome para o treino-base (ex: \"Base iniciante\").");
    }
    var estado = carregarEstado();
    var lista = estado[tipoConta].treinosBase || [];
    if (lista.length >= MAX_TREINOS_BASE) {
      throw new Error("Limite de " + MAX_TREINOS_BASE + " treinos-base atingido. Apague algum antes de salvar um novo.");
    }
    var base = {
      id: gerarId("base"),
      nome: nomeLimpo,
      exercicios: (exercicios || []).slice(),
      criadoEm: Date.now()
    };
    lista.push(base);
    estado[tipoConta].treinosBase = lista;
    salvarEstado(estado);
    return base;
  };

  DadosDemo.removerTreinoBase = function (tipoConta, idBase) {
    var estado = carregarEstado();
    estado[tipoConta].treinosBase = (estado[tipoConta].treinosBase || []).filter(function (b) {
      return b.id !== idBase;
    });
    salvarEstado(estado);
  };

  // Aplica uma base ao aluno. Fica marcado modo:'base' até a primeira
  // edição (adicionar/remover exercício), quando vira 'personalizado' —
  // a base em si, na biblioteca, nunca é alterada por isso.
  DadosDemo.aplicarTreinoBaseNoAluno = function (tipoConta, idAluno, idBase) {
    var estado = carregarEstado();
    var aluno = encontrarAluno(estado, tipoConta, idAluno);
    var base = (estado[tipoConta].treinosBase || []).filter(function (b) { return b.id === idBase; })[0];
    if (!aluno || !base) {
      throw new Error("Aluno ou treino-base não encontrado.");
    }
    aluno.treino.modo = "base";
    aluno.treino.baseId = base.id;
    aluno.treino.exercicios = base.exercicios.slice();
    aluno.treino.atualizadoEm = Date.now();
    salvarEstado(estado);
    return aluno;
  };

  // --- Sugestão de exercício (revisão em 48h, implantação em até 7 dias
  //     se aprovado — pedido literal de Murilo, 2026-09-29). Fica
  //     registrado localmente como "em análise"; não existe hoje um
  //     backend/fila real de revisão — ver STATUS.md. ---

  DadosDemo.sugerirExercicio = function (tipoConta, dados) {
    var nomeLimpo = ((dados && dados.nomeExercicio) || "").trim();
    if (!nomeLimpo) {
      throw new Error("Descreva o exercício que você quer sugerir.");
    }
    var estado = carregarEstado();
    var agora = Date.now();
    var registro = {
      id: gerarId("sugestao"),
      nomeExercicio: nomeLimpo,
      grupoMuscular: ((dados && dados.grupoMuscular) || "").trim(),
      observacao: ((dados && dados.observacao) || "").trim(),
      dataEnvio: agora,
      previsaoAnaliseAte: agora + 48 * 60 * 60 * 1000,
      previsaoImplantacaoAte: agora + 7 * 24 * 60 * 60 * 1000,
      status: "em análise"
    };
    estado[tipoConta].sugestoesExercicio.push(registro);
    salvarEstado(estado);
    return registro;
  };

  DadosDemo.listarSugestoesExercicio = function (tipoConta) {
    var estado = carregarEstado();
    return (estado[tipoConta].sugestoesExercicio || []).slice().sort(function (a, b) {
      return b.dataEnvio - a.dataEnvio;
    });
  };

  // --- Portfólio de parceiros (cadastros de personal recebidos) ---

  DadosDemo.cadastrarPersonalPendente = function (dados) {
    var estado = carregarEstado();
    var registro = {
      id: gerarId("portfolio_personal"),
      criadoEm: Date.now(),
      status: "pendente",
      nome: (dados.nome || "").trim(),
      cref: (dados.cref || "").trim(),
      formacao: (dados.formacao || "").trim(),
      especializacao: (dados.especializacao || "").trim(),
      cidade: (dados.cidade || "").trim(),
      bairro: (dados.bairro || "").trim(),
      experiencias: (dados.experiencias || "").trim(),
      telefone: (dados.telefone || "").trim(),
      email: (dados.email || "").trim(),
      temFoto: !!dados.temFoto
    };
    if (!estado.portfolio) {
      estado.portfolio = { personais: [] };
    }
    estado.portfolio.personais.push(registro);
    salvarEstado(estado);
    return registro;
  };

  DadosDemo.listarPortfolioPersonais = function () {
    var estado = carregarEstado();
    var lista = (estado.portfolio && estado.portfolio.personais) || [];
    return lista.slice().sort(function (a, b) {
      return b.criadoEm - a.criadoEm;
    });
  };

  DadosDemo.definirStatusPersonalPortfolio = function (id, status) {
    var estado = carregarEstado();
    var lista = (estado.portfolio && estado.portfolio.personais) || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i].id === id) {
        lista[i].status = status;
        break;
      }
    }
    salvarEstado(estado);
  };

  global.DadosDemo = DadosDemo;
})(window);
