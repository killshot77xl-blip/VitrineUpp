
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);

const SITE_URL = process.env.SITE_URL;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

const ML_APP_ID = process.env.ML_APP_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const ML_REDIRECT_URI =
  process.env.ML_REDIRECT_URI ||
  'https://vitrineupp-api.onrender.com/auth/mercadolivre/callback';

const catalog = JSON.parse(
  await readFile(path.join(__dirname, 'catalog.json'), 'utf8')
);

// Tokens ficam em memória nesta primeira versão.
let mlToken = null;
const mlStates = new Map();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '20kb' }));

app.use('/api/', rateLimit({
  windowMs: 60000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
}));

app.use(express.static(__dirname));

// =====================================
// SAÚDE DA API
// =====================================

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    paymentConfigured: Boolean(MP_ACCESS_TOKEN && SITE_URL),
    mercadoLivreConfigured: Boolean(ML_APP_ID && ML_CLIENT_SECRET),
    mercadoLivreConnected: Boolean(mlToken?.access_token)
  });
});

// =====================================
// INICIAR CONEXÃO MERCADO LIVRE
// =====================================

app.get('/auth/mercadolivre/start', (_req, res) => {
  if (!ML_APP_ID || !ML_CLIENT_SECRET) {
    return res.status(503).send(
      'Configure ML_APP_ID e ML_CLIENT_SECRET no Render.'
    );
  }

  const state = randomUUID();

  mlStates.set(state, Date.now() + 10 * 60 * 1000);

  const authorizationUrl = new URL(
    'https://auth.mercadolivre.com.br/authorization'
  );

  authorizationUrl.search = new URLSearchParams({
    response_type: 'code',
    client_id: ML_APP_ID,
    redirect_uri: ML_REDIRECT_URI,
    state
  }).toString();

  res.redirect(authorizationUrl.toString());
});

// =====================================
// CALLBACK MERCADO LIVRE
// =====================================

app.get('/auth/mercadolivre/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).send(
        'A autorização do Mercado Livre foi cancelada.'
      );
    }

    if (
      typeof code !== 'string' ||
      typeof state !== 'string' ||
      !mlStates.has(state) ||
      mlStates.get(state) < Date.now()
    ) {
      return res.status(400).send(
        'Autorização inválida ou expirada. Tente novamente.'
      );
    }

    mlStates.delete(state);

    const response = await fetch(
      'https://api.mercadolibre.com/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: ML_APP_ID,
          client_secret: ML_CLIENT_SECRET,
          code,
          redirect_uri: ML_REDIRECT_URI
        })
      }
    );

    const data = await response.json();

    if (!response.ok || !data.access_token) {
      console.error('Erro OAuth:', response.status, data.error);
      return res.status(502).send(
        'Não foi possível autorizar a conta Mercado Livre.'
      );
    }

    mlToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: data.user_id,
      expires_at: Date.now() + Number(data.expires_in) * 1000
    };

    res.send(
      'VitrineUp conectada ao Mercado Livre com sucesso!'
    );

  } catch (err) {
    console.error('Callback:', err.message);
    res.status(500).send('Erro interno na conexão.');
  }
});

// =====================================
// RENOVAÇÃO DO TOKEN
// =====================================

async function getMLAccessToken() {
  if (!mlToken) {
    throw new Error('Mercado Livre não conectado.');
  }

  if (mlToken.expires_at > Date.now() + 5 * 60 * 1000) {
    return mlToken.access_token;
  }

  if (!mlToken.refresh_token) {
    throw new Error('Token de renovação indisponível.');
  }

  const response = await fetch(
    'https://api.mercadolibre.com/oauth/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: ML_APP_ID,
        client_secret: ML_CLIENT_SECRET,
        refresh_token: mlToken.refresh_token
      })
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    mlToken = null;
    throw new Error('Não foi possível renovar o token.');
  }

  mlToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || mlToken.refresh_token,
    user_id: data.user_id || mlToken.user_id,
    expires_at: Date.now() + Number(data.expires_in) * 1000
  };

  return mlToken.access_token;
}

// =====================================
// STATUS DA CONEXÃO
// =====================================

app.get('/api/mercadolivre/status', (_req, res) => {
  res.json({
    configured: Boolean(ML_APP_ID && ML_CLIENT_SECRET),
    connected: Boolean(mlToken?.access_token),
    user_id: mlToken?.user_id || null
  });
});

// =====================================
// BUSCAR PRODUTOS DO VENDEDOR
// =====================================

app.get('/api/mercadolivre/products', async (_req, res) => {
  try {
    if (!mlToken) {
      return res.status(401).json({
        error: 'Conecte primeiro sua conta Mercado Livre.'
      });
    }

    const token = await getMLAccessToken();

    const searchResponse = await fetch(
      `https://api.mercadolibre.com/users/${mlToken.user_id}/items/search?limit=20`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      return res.status(502).json({
        error: 'Não foi possível consultar os produtos.'
      });
    }

    const ids = searchData.results || [];

    if (ids.length === 0) {
      return res.json({ products: [] });
    }

    const detailsResponse = await fetch(
      `https://api.mercadolibre.com/items?ids=${ids.join(',')}`,
      {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    const details = await detailsResponse.json();

    const products = details
      .filter(item => item.code === 200 && item.body)
      .map(item => ({
        id: item.body.id,
        title: item.body.title,
        price: item.body.price,
        currency: item.body.currency_id,
        image: item.body.thumbnail,
        permalink: item.body.permalink,
        available_quantity: item.body.available_quantity,
        status: item.body.status
      }));

    res.json({ products });

  } catch (err) {
    console.error('Products:', err.message);
    res.status(500).json({
      error: 'Erro ao carregar produtos do Mercado Livre.'
    });
  }
});

// =====================================
// CHECKOUT MERCADO PAGO
// =====================================

app.post('/api/checkout', async (req, res) => {
  try {
    if (!MP_ACCESS_TOKEN || !SITE_URL) {
      return res.status(503).json({
        error: 'Pagamento ainda não configurado.'
      });
    }

    if (
      !Array.isArray(req.body?.items) ||
      req.body.items.length < 1 ||
      req.body.items.length > 30
    ) {
      return res.status(400).json({
        error: 'Carrinho inválido.'
      });
    }

    const normalized = [];

    for (const entry of req.body.items) {
      const product = catalog.find(
        p => p.id === entry.id && p.active === true
      );

      const quantity = Number(entry.quantity);

      if (
        !product ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 20
      ) {
        return res.status(400).json({
          error: 'Produto ou quantidade inválida.'
        });
      }

      if (
        !Number.isInteger(product.priceCents) ||
        product.priceCents < 1 ||
        !Number.isInteger(product.stock) ||
        product.stock < quantity
      ) {
        return res.status(409).json({
          error: `Preço ou estoque de ${product.name} não configurado.`
        });
      }

      normalized.push({
        external_code: product.id,
        title: product.name,
        quantity,
        unit_price: (product.priceCents / 100).toFixed(2)
      });
    }

    const totalCents = normalized.reduce(
      (sum, item) =>
        sum +
        Math.round(Number(item.unit_price) * 100) * item.quantity,
      0
    );

    const orderRef = `VU-${randomUUID()}`;

    const payload = {
      type: 'online',
      total_amount: (totalCents / 100).toFixed(2),
      external_reference: orderRef,
      processing_mode: 'manual',
      capture_mode: 'automatic_async',
      items: normalized,
      config: {
        online: {
          success_url: `${SITE_URL}/?pagamento=sucesso`,
          failure_url: `${SITE_URL}/?pagamento=falhou`,
          pending_url: `${SITE_URL}/?pagamento=pendente`
        }
      }
    };

    const mpResponse = await fetch(
      'https://api.mercadopago.com/v1/orders',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': randomUUID()
        },
        body: JSON.stringify(payload)
      }
    );

    const result = await mpResponse.json();

    if (!mpResponse.ok) {
      console.error('Checkout Mercado Pago:', mpResponse.status);
      return res.status(502).json({
        error: 'Não foi possível iniciar o pagamento.'
      });
    }

    if (!result.checkout_url) {
      return res.status(502).json({
        error: 'Link de pagamento não retornado.'
      });
    }

    res.status(201).json({
      checkout_url: result.checkout_url,
      order_reference: orderRef
    });

  } catch (err) {
    console.error('Checkout:', err.message);
    res.status(500).json({
      error: 'Erro interno ao preparar pagamento.'
    });
  }
});

// =====================================
// INICIAR SERVIDOR
// =====================================

app.listen(PORT, () => {
  console.log(`VitrineUp disponível na porta ${PORT}`);
});
