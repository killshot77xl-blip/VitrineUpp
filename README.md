# VitrineUp — pacote inicial de loja

Este pacote preserva o visual claro do HTML original e adiciona um carrinho funcional no navegador e uma rota de servidor para iniciar o Checkout Pro do Mercado Pago via Orders API.

## O que já está preparado
- Carrinho com adicionar, remover e alterar quantidades.
- Subtotal calculado no navegador quando houver preços configurados.
- O servidor valida IDs, quantidades, preços e estoque a partir do catálogo local (não confia nos valores enviados pelo navegador).
- Endpoint `/api/checkout` cria uma order no Mercado Pago e redireciona para `checkout_url`.
- Credencial do Mercado Pago fica apenas no servidor, em variável de ambiente.
- Proteções básicas com Helmet, limite de corpo JSON e rate limit.

## O que falta antes de receber pagamentos reais
1. Um adulto responsável deve controlar a conta comercial, o cadastro do vendedor e a conta do Mercado Pago.
2. Hospedar este projeto em servidor com HTTPS e domínio próprio.
3. Copiar `.env.example` para `.env` no servidor, preencher `SITE_URL` e guardar `MP_ACCESS_TOKEN` como segredo de ambiente. Nunca colocar token no HTML, no Git ou enviar pelo chat.
4. Editar `public/catalog.json`: cadastrar produtos reais, fotos autorizadas, preço final em centavos (`priceCents`), estoque (`stock`) e ativar (`active: true`). Os itens atuais estão desativados e sem preço de propósito.
5. Configurar e validar Webhooks do Mercado Pago para receber atualizações e confirmar o status real dos pagamentos no servidor. O retorno do navegador para a página de sucesso NÃO comprova pagamento. Este pacote ainda não implementa a validação de assinatura nem a conciliação de Webhooks; portanto, não deve ser usado para liberar/entregar pedidos em produção até essa etapa ser concluída.
6. Configurar frete, prazo, política de troca/devolução, privacidade, termos e atendimento.
7. Fazer testes completos em ambiente de teste antes de abrir a loja.

## Executar localmente
Requer Node.js 20 ou superior.

```bash
npm install
cp .env.example .env
npm start
```

Sem `MP_ACCESS_TOKEN` e `SITE_URL`, o checkout permanece bloqueado — isso é intencional. Não use credenciais de produção em testes locais.

## Catálogo
Cada produto usa estes campos:
- `id`: identificador único simples.
- `name`, `category`, `emoji`, `description`.
- `priceCents`: preço inteiro em centavos (ex.: R$ 39,90 = `3990`).
- `stock`: quantidade disponível.
- `active`: `true` para exibir e vender; `false` para ocultar.

A lista `catalog.json` é lida pelo servidor e publicada para a vitrine. Para uma operação maior, mover catálogo e pedidos para banco de dados e criar painel administrativo protegido.
