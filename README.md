# Fera Fit — Site institucional

Site estático (HTML/CSS puro, sem build), pronto para publicar no GitHub Pages.

## Arquivos

- `index.html` — Home
- `contato.html` — Contato
- `privacidade.html` — Política de Privacidade (texto v1)
- `termos.html` — Termos de Uso (texto v1)
- `excluir-conta.html` — Exclusão de conta e dados (exigência do Google Play)
- `assets/css/style.css` — estilo
- `CNAME` — já configurado com `ferafit.app.br` (usado pelo GitHub Pages para o domínio próprio)

## Domínio

`ferafit.app.br` — registrado por Murilo em 27/08/2026, status "Publicado" no painel do registro.br.

## Como publicar (passo a passo)

1. **Criar o repositório no GitHub**: criar um repositório novo (pode ser público), por exemplo `ferafit-site`, e subir todos os arquivos desta pasta para ele — incluindo a pasta `assets` inteira e o arquivo `CNAME`.
2. **Ativar o GitHub Pages**: no repositório, em Settings → Pages, escolher a branch `main` (pasta raiz) como fonte. O GitHub vai detectar o arquivo `CNAME` e configurar o domínio customizado automaticamente. No campo "Custom domain", confirme que está `ferafit.app.br`.
3. **Apontar o DNS**: no painel do registro.br, dentro do domínio `ferafit.app.br`, configurar os registros DNS para o GitHub Pages:
   - Registros tipo `A` apontando para os IPs do GitHub Pages: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - Registro `CNAME` para `www` apontando para `SEU-USUARIO.github.io`
4. Aguardar a propagação de DNS (de 30 minutos a até 24h) e o certificado HTTPS automático (Let's Encrypt) que o GitHub Pages emite sozinho.
5. Depois que o HTTPS estiver ativo, em Settings → Pages, marcar "Enforce HTTPS".

Posso ajudar a revisar cada um desses passos quando você chegar neles.

## Pendências

- E-mail de contato usado (`contato@ferafit.app.br`) é um padrão sugerido — só funciona de verdade depois de configurar uma caixa de e-mail nesse domínio (ex: Google Workspace, Zoho Mail) ou você pode trocar pelo seu e-mail pessoal (`murilovalverde@gmail.com`), que já é o e-mail declarado na Política de Privacidade — é a opção grátis e imediata, recomendada para o Beta 1.
- Trocar a imagem do mascote na home (`mascote-hero.jpg`) pela versão de fundo transparente, assim que você indicar o arquivo.
- Política de Privacidade e Termos de Uso publicados são a **v1** (pré-login). Existe uma **v2** de cada, redigida pela IA Jurídico/LGPD, cobrindo o login em nuvem — não publicar ainda, só no dia exato em que o login realmente entrar no ar.
