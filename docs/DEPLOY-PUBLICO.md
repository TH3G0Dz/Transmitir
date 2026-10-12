# Publicação do Transmitir em um VPS

Esta implantação atende links acessíveis pela internet usando HTTPS/WSS e inclui um servidor coturn para redes que não conseguem uma conexão WebRTC direta. O modelo usa Caddy como proxy e gerenciador de certificado. O app e as salas continuam ativos enquanto o VPS estiver ligado; as salas são voláteis e somem ao reiniciar o app.

## O que é necessário

- Um VPS Linux com Docker Compose v2 e endereço IPv4 público fixo. O servidor deve permitir UDP/TCP, não apenas tráfego web.
- Um domínio ou subdomínio cujo registro DNS `A` aponte para o IPv4 público do VPS. Exemplo: `transmitir.seudominio.com`.
- Acesso administrativo ao servidor e ao DNS.
- Portas abertas no firewall do VPS e no painel da hospedagem:
  - TCP 80 e 443 para o Caddy obter e servir HTTPS.
  - UDP 443 para HTTP/3 do Caddy (opcional; pode ser removido se não for permitido).
  - TCP e UDP 3478 para TURN.
  - UDP 49160–49200 para mídia retransmitida por coturn.

Caddy encaminha WebSocket por `reverse_proxy` e pode obter HTTPS automaticamente para um nome DNS público quando os requisitos de validação e portas estão atendidos. Veja a [documentação de proxy do Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) e a [documentação do coturn](https://github.com/coturn/coturn/tree/master/docker/coturn).

## Preparar `.env` no servidor

Copie `.env.example` para `.env` no VPS e preencha estes valores, substituindo os exemplos:

```dotenv
DOMAIN=transmitir.seudominio.com
SERVER_PUBLIC_IP=203.0.113.25
PUBLIC_ORIGIN=https://transmitir.seudominio.com
STUN_URLS=stun:transmitir.seudominio.com:3478
TURN_URLS=turn:transmitir.seudominio.com:3478?transport=udp,turn:transmitir.seudominio.com:3478?transport=tcp
TURN_SHARED_SECRET=COLE_AQUI_UM_SEGREDO_ALEATORIO
```

Gere o segredo no servidor com Node.js:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use o mesmo `TURN_SHARED_SECRET` no app e coturn: o Compose injeta esse segredo nos dois serviços, e o backend emite credenciais TURN com prazo de validade. Não publique o arquivo `.env` nem o inclua no Git.

## Iniciar

Coloque os arquivos do projeto no VPS. Na pasta do projeto:

```bash
docker compose config
docker compose up -d --build
docker compose ps
docker compose logs -f caddy webshare coturn
```

Quando DNS, firewall e certificado estiverem prontos, verifique `https://transmitir.seudominio.com/api/health`. Abra `https://transmitir.seudominio.com` e crie uma sala. O link gerado usará `PUBLIC_ORIGIN`, então será acessível pelos convidados fora da sua rede.

Para atualizar depois de copiar uma nova versão do projeto, rode `docker compose up -d --build`. Para parar, rode `docker compose down`; os dados de certificado Caddy ficam nos volumes nomeados. Não execute `docker compose down -v` sem querer apagar esses volumes.

## Validação necessária

1. Testar a página e `/api/health` por uma conexão móvel, fora da rede do VPS.
2. Iniciar uma transmissão e abrir o link em outro dispositivo/rede.
3. Confirmar no diagnóstico WebRTC que TURN aparece como rota selecionada quando uma conexão direta não funciona.
4. Testar rede corporativa ou móvel restritiva. Esta configuração TURN oferece UDP e TCP na porta 3478; algumas redes bloqueiam ambos. Nesses casos será necessário um serviço TURN com `TURNS`/TLS na porta 443 ou uma configuração equivalente.
5. Medir consumo TURN e upload do transmissor com a quantidade de espectadores esperada.

Essa topologia usa uma instância Node, com salas em memória. Reinício do container encerra salas ativas; a aplicação não grava mídia. Para escala horizontal, serão necessários armazenamento compartilhado de salas/sinalização e uma arquitetura SFU. TURN também pode gerar custo de tráfego significativo.
