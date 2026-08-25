# Sala

Canal de voz, transmissão de tela, conversa por texto, emoji e áudio gravado — para um grupo pequeno de amigos. Sem conta, sem instalar nada no computador de quem entra.

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

- **Voz** — entra ligada; o botão `microfone` muta e desmuta. A barrinha ao lado de cada nome mostra quem está falando.
- **Transmitir tela** — escolhe uma janela, uma aba do navegador ou o monitor inteiro. Para mandar **o som junto** (jogo, vídeo, música), use Chrome ou Edge no computador, escolha a aba ou a tela e marque *compartilhar áudio* no seletor. Se duas pessoas transmitirem ao mesmo tempo, as duas telas aparecem lado a lado. `tela cheia` no canto de cada uma.
- **Conversa** — texto normal; mensagem só de emoji aparece em tamanho grande.
- **Reagir** — os emojis acima da caixa de texto sobem na tela de todo mundo, sem poluir o histórico.
- **Áudio** — segure o botão redondo vermelho para gravar, solte para enviar. Limite de 60 segundos.

O histórico da conversa não fica salvo: quando todo mundo sai, a sala some.

## Ajustes

Variáveis de ambiente:

| variável | para quê | padrão |
| --- | --- | --- |
| `PORT` | porta do servidor | `3000` |
| `MAX_PER_ROOM` | limite de gente por grupo | `8` |
| `TURN_URL`, `TURN_USER`, `TURN_PASS` | servidor TURN (veja abaixo) | vazio |

## Se a voz ou a tela não conectar

Cada pessoa se conecta com todas as outras diretamente. Em rede de casa e Wi-Fi comum isso funciona com o STUN público que já vem configurado. Em algumas redes (4G/5G de certas operadoras, rede de empresa, universidade) o tráfego direto é bloqueado e é preciso um **TURN**, que serve de ponte.

Dá para usar um gratuito. Exemplo com o Open Relay:

```bash
TURN_URL="turn:openrelay.metered.ca:80" TURN_USER="openrelayproject" TURN_PASS="openrelayproject" npm start
```

Ou preencha essas três variáveis no painel do serviço onde hospedou.

## Sobre o tamanho do grupo

Cada pessoa manda o próprio áudio para todas as outras. Até 6 ou 8 pessoas roda liso. Acima disso, a transmissão de tela começa a pesar no upload de quem está transmitindo — nesse caso vale reduzir a qualidade escolhendo compartilhar uma janela em vez do monitor inteiro.
