# Concord

Canal de voz, transmissão de tela e conversa — para um grupo pequeno de amigos. Sem conta, sem instalar nada no computador de quem entra.

A voz e a tela vão **direto de um computador para o outro** (WebRTC). O servidor só apresenta as pessoas umas às outras e carrega o texto, os áudios e as reações.

## Rodar no seu computador

Precisa de Node.js 18 ou mais novo.

```bash
npm install
npm start
```

Abra `http://localhost:3000`. Escreva o nome do grupo (ex: `os-cria`), seu apelido e entre.

## Como os amigos entram

O navegador só libera microfone e captura de tela em **HTTPS** ou em `localhost`. Então `http://seu-ip-local:3000` não funciona para os outros. Duas saídas:

**Teste rápido, na hora** — com [ngrok](https://ngrok.com) instalado:

```bash
ngrok http 3000
```

Ele devolve um endereço `https://…`. Mande para o grupo e todo mundo entra por ali.

**Para usar sempre** — suba o projeto num serviço com plano gratuito, tipo Render, Railway ou Fly.io. É um app Node comum:

- comando de build: `npm install`
- comando de start: `npm start`
- a porta vem da variável `PORT` (já está no código)

Depois é só mandar o link com o nome do grupo: `https://seu-app.onrender.com/#os-cria`. O botão **copiar link** no topo já monta esse endereço.

## O que dá para fazer lá dentro

A tela é dividida como um aplicativo de voz: à esquerda os canais e quem está neles, no meio o palco ou a conversa, à direita a lista de pessoas.

- **Voz** — entra ligada. Quem está falando ganha um anel verde em volta do avatar. `Ctrl+M` muta, `Ctrl+Shift+D` ensurdece (e muta você junto).
- **Push-to-talk** — nos ajustes. Ligado, você fala só enquanto segura <kbd>Espaço</kbd>. Trocar de janela solta a tecla sozinho, então o microfone não fica aberto por esquecimento.
- **Escolher microfone e saída** — nos ajustes, com uma barrinha de teste para conferir se pegou o aparelho certo antes de reclamar que ninguém te ouve. Trocar de microfone no meio da conversa não derruba ninguém.
- **Transmitir tela** — escolhe uma janela, uma aba do navegador ou o monitor inteiro. Para mandar **o som junto** (jogo, vídeo, música), use Chrome ou Edge no computador, escolha a aba ou a tela e marque *compartilhar áudio* no seletor. Se duas pessoas transmitirem, as duas aparecem lado a lado; **clique numa** para ela ficar grande e a outra virar miniatura. `Esc` solta o destaque.
- **Qualidade da transmissão** — nos ajustes: 720p30, 1080p30, 1080p60 ou original. Monitor inteiro em original entope o upload de quem transmite; 1080p30 é o padrão por isso.
- **Volume de cada pessoa, separado da live** — clique no nome na lista da direita, ou no ícone de alto-falante em cima do quadro de quem está transmitindo. São dois controles independentes: **voz** e **transmissão**. Dá para deixar o jogo de alguém baixinho e continuar ouvindo a pessoa falar, ou o contrário. Vale só para você; a pessoa não fica sabendo.
- **Conversa** — com marcação: `**negrito**`, `*itálico*`, `` `código` ``, ` ```bloco``` `, `~~riscado~~` e `||spoiler||` (só aparece ao clicar). Mensagem só de emoji vem em tamanho grande, e mensagens seguidas da mesma pessoa viram um bloco só.
- **Mencionar** — `@apelido` destaca a pessoa; `@todos` chama o grupo. Quem foi chamado vê a mensagem marcada.
- **Responder, editar e apagar** — passe o mouse na mensagem (no celular os botões já ficam à mostra). Editar deixa a marca *(editado)*; apagar some para todo mundo.
- **Reagir na mensagem** — o rosto sorrindo na barra da mensagem prende o emoji nela, com contagem. Diferente do emoji da caixa de texto, que sobe flutuando na tela de todos e não fica no histórico.
- **Imagem** — cole com <kbd>Ctrl</kbd>+<kbd>V</kbd>, arraste para a janela ou use o botão. Print grande é reduzido antes de sair, senão trava a sala.
- **Sons** — o botão da nota musical toca efeitos que **todo mundo ouve**, misturados no seu áudio.
- **Qualidade da conexão** — no painel de volume de cada pessoa: ping, perda de pacote e jitter, mais o aviso quando o tráfego está passando por TURN. Responde a pergunta eterna de quem está travando.
- **Áudio gravado** — segure o botão de microfone ao lado da caixa de texto, solte para enviar. Limite de 60 segundos.
- **Blip de entrada e saída** — um som curto quando alguém chega ou sai, para você perceber sem estar olhando a aba.

Se a conexão cair, a sala volta sozinha e remonta as chamadas — a conversa já escrita continua na tela.

As últimas 60 mensagens de texto ficam guardadas na memória do servidor, então quem chega no meio vê o que já foi dito — com as reações e edições já aplicadas. Quando **todo mundo** sai, a sala e a conversa somem. Áudio gravado e imagem nunca são guardados.

## Vindo do Messenger

- **Zumbido** — o botão do raio na barra de cima, ou <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd>. Chacoalha a tela de todo mundo e toca um som. Sem espera entre um e outro: mande quantos quiser, e aguente as consequências.
- **Status e recado** — clique no seu nome no canto de baixo: *Disponível, Ocupado, Volto logo, Ausente, Aparecer invisível*, mais aquela linha de texto embaixo do nome. Aparece para todo mundo na coluna da direita.
- **Ausente automático** — 5 minutos sem teclar, mexer o mouse ou falar e o status vira *Ausente* sozinho, voltando ao que era quando você reaparece. Status que só muda na mão sempre mente.
- **Emoticons de texto** — `:)` `:D` `;)` `:P` `<3` `(y)` `(n)` viram emoji ao enviar.
- **Sons da sala** — entrar, sair, mensagem e zumbido. Dá para desligar nos ajustes.
- **Título piscando** — a aba mostra `(3)` quando chega mensagem e você está em outro lugar. Menção a você pode virar notificação do sistema, se você deixar nos ajustes.

## Ajustes

Variáveis de ambiente:

| variável | para quê | padrão |
| --- | --- | --- |
| `PORT` | porta do servidor | `3000` |
| `MAX_PER_ROOM` | limite de gente por grupo | `15` |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | servidor TURN (veja abaixo) | vazio |

## Se a voz ou a tela não conectar

Cada pessoa se conecta com todas as outras diretamente. Em rede de casa e Wi-Fi comum isso funciona com o STUN público que já vem configurado. Em algumas redes (4G/5G de certas operadoras, rede de empresa, universidade) o tráfego direto é bloqueado e é preciso um **TURN**, que serve de ponte.

Dá para usar um gratuito. Exemplo com o Open Relay:

```bash
TURN_URL="turn:openrelay.metered.ca:80" TURN_USER="openrelayproject" TURN_PASS="openrelayproject" npm start
```

Ou preencha essas três variáveis no painel do serviço onde hospedou.

## Sobre o tamanho do grupo

O limite vem de fábrica em 15 pessoas, mas vale saber o que acontece no caminho. Cada pessoa manda o próprio áudio para **todas** as outras, então o número de conexões cresce ao quadrado:

| pessoas | conexões na sala | fluxos de áudio que cada um envia |
| --- | --- | --- |
| 6 | 15 | 5 |
| 8 | 28 | 7 |
| 15 | 105 | 14 |

Até 6 ou 8 roda liso em internet de casa. De 10 para cima, o upload de cada pessoa começa a apertar — e quem estiver transmitindo tela ao mesmo tempo sente primeiro. Se ficar picotado com o grupo cheio, baixe a qualidade da transmissão nos ajustes ou compartilhe uma janela em vez do monitor inteiro.

Para mudar o limite:

```bash
MAX_PER_ROOM=20 npm start
```

Não tem câmera de propósito. Numa malha ponto a ponto, 8 pessoas com vídeo dão 56 fluxos simultâneos e derretem o upload de todo mundo. Voz e uma ou duas telas essa arquitetura aguenta bem; vídeo de todos exigiria um servidor de mídia no meio, que é outro projeto.
