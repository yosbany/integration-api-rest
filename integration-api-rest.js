// 🛡️ Validación previa
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const dotenv = require('dotenv');

const requiredModules = ['dotenv', 'express', 'puppeteer'];
for (const module of requiredModules) {
  try {
    require.resolve(module);
  } catch (err) {
    console.error(`❌ ERROR: Falta el módulo "${module}".`);
    console.error(`➡️ Ejecutá: npm install ${module}`);
    process.exit(1);
  }
}

// Cargar variables de entorno si existe .env, pero no es obligatorio
dotenv.config();

// Validar que existan las variables de entorno requeridas
const requiredEnvVars = ['ZUREO_CODIGO', 'ZUREO_EMAIL', 'ZUREO_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ ERROR: Faltan las siguientes variables de entorno:');
  missingEnvVars.forEach(varName => {
    console.error(`➡️ ${varName}`);
  });
  process.exit(1);
}

// ✅ Inicialización
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = process.env.PORT || 8000;

// ✅ Configuración CORS explícita
app.use(cors({
  origin: '*', // Permite todos los orígenes
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning', 'X-Forwarded-Host'],
  credentials: false // Debe ser false si origin es '*'
}));

// Middleware adicional para asegurar que los headers CORS estén presentes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning, X-Forwarded-Host');
  next();
});

// Middleware para parsear JSON
app.use(express.json());

// Middleware para asegurar que todas las respuestas sean JSON
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Middleware para skip browser warning de ngrok
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});

// Proxy para CORS
app.use('/api-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).json({ error: 'URL no proporcionada' });
  }

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 🏥 HEALTHCHECK - Ruta raíz
app.get('/', (req, res) => {
  const healthcheck = {
    status: 'UP',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    service: 'Zureo Integration API',
    version: '1.0.0',
    endpoints: {
      login: '/zureo/login',
      stock: '/zureo/stock/:sku',
      adjust: '/zureo/ajustar/:sku/:cantidad'
    }
  };
  res.json(healthcheck);
});

// Ruta de health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'integration-api-rest'
  });
});

let browser;
let page;

// 🟢 LOGIN
app.post('/zureo/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({
        error: 'Username and password are required'
      });
    }

    browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--start-maximized'
      ]
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto('https://go.zureo.com/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.type('#empresaLogin', process.env.ZUREO_CODIGO);
    await page.type('#usuarioLogin', process.env.ZUREO_EMAIL);
    await page.type('#passwordLogin', process.env.ZUREO_PASSWORD);

    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }),
      page.click('button[type="submit"]'),
      (async () => {
        try {
          console.log('⏳ Verificando si aparece el modal de sesión activa...');
          await page.waitForFunction(() => {
            const modal = document.querySelector('.modal-content');
            const body = modal?.querySelector('.modal-body');
            return body && body.innerText.includes('Su sesión se encuentra activa en otro dispositivo');
          }, { timeout: 5000 });

          console.log('⚠️ Modal detectado. Haciendo clic en "Continuar"...');
          await page.evaluate(() => {
            const modal = document.querySelector('.modal-content');
            const btn = modal?.querySelector('button.z-btn.btn-primary');
            if (btn) btn.click();
          });
        } catch {
          console.log('✅ No apareció modal de sesión activa.');
        }
      })()
    ]);

    console.log('✅ Sesión iniciada en Zureo');
    res.json({
      status: 'success',
      message: 'Login successful',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('❌ Error en login:', err);
    res.status(500).json({ error: err.message });
  }
});

// 📦 STOCK
app.get('/zureo/stock/:sku', async (req, res) => {
  if (!page) return res.status(400).json({ error: 'No has iniciado sesión. Usá /zureo/login primero.' });

  const sku = req.params.sku;

  try {
    console.log(`\n🔍 Consultando stock para SKU: ${sku}`);
    await page.goto('https://go.zureo.com/#/informes/stockarticulo', { waitUntil: 'networkidle2' });

    const panelExists = await page.$('div.z-div-collapse');
    if (panelExists) {
      console.log(`↩️ Limpiando búsqueda anterior`);
      await page.click('div.z-div-collapse');
      await page.evaluate(() => {
        const input = document.querySelector('#id_0');
        if (input) input.value = '';
      });
      await page.click('#id_0');
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
    }

    await page.waitForSelector('#id_0', { timeout: 10000 });
    await page.type('#id_0', sku);

    console.log(`⌛ Esperando sugerencia...`);
    await page.waitForSelector('a[ng-bind-html]', { timeout: 10000 });
    await page.click('a[ng-bind-html]');

    await page.waitForSelector('#consultar', { timeout: 5000 });
    await page.click('#consultar');

    await page.waitForSelector('h1.z-heading.m-n.ng-binding', { timeout: 10000 });

    const stock = await page.evaluate(() => {
      const el = document.querySelector('h1.z-heading.m-n.ng-binding');
      return el ? el.innerText.trim() : null;
    });

    if (!stock) return res.status(404).json({ error: 'Stock no encontrado.' });

    console.log(`✅ Stock actual para ${sku}: ${stock}`);
    res.json({ sku, stock });
  } catch (err) {
    console.error('❌ Error buscando stock:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🛠️ AJUSTAR STOCK
app.get('/zureo/ajustar/:sku/:cantidad', async (req, res) => {
  if (!page) return res.status(400).json({ error: 'No has iniciado sesión. Usá /zureo/login primero.' });

  const { sku, cantidad } = req.params;

  try {
    console.log(`\n🛠️ Iniciando ajuste de stock para SKU: ${sku} => ${cantidad}`);
    
    // Navegar a la página de ajuste con espera explícita
    await page.goto('https://go.zureo.com/#/ajustar', { 
      waitUntil: ['networkidle2', 'domcontentloaded'],
      timeout: 30000 
    });

    // Esperar a que la página esté realmente cargada
    await page.waitForFunction(() => {
      return document && document.readyState === 'complete';
    }, { timeout: 20000 });

    console.log(`🟡 Seleccionando tipo de ajuste...`);
    await page.waitForSelector('#tipoAjuste', { visible: true, timeout: 20000 });
    await page.select('#tipoAjuste', 'number:1');

    console.log(`🟡 Ingresando SKU: ${sku}`);
    await page.waitForSelector('#articulo', { visible: true, timeout: 20000 });
    
    // Limpiar el campo de artículo de forma más robusta
    await page.evaluate(() => {
      const input = document.querySelector('#articulo');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    await page.type('#articulo', sku, { delay: 100 });

    console.log(`⌛ Esperando sugerencia...`);
    
    // Esperar a que aparezca la sugerencia de manera más robusta
    await page.waitForFunction(
      (searchText) => {
        const suggestions = Array.from(document.querySelectorAll('a[ng-bind-html]'));
        return suggestions.some(el => el.textContent.includes(searchText));
      },
      { timeout: 20000 },
      sku
    );

    // Hacer clic en la sugerencia correcta
    await page.evaluate((searchText) => {
      const suggestions = Array.from(document.querySelectorAll('a[ng-bind-html]'));
      const targetSuggestion = suggestions.find(el => el.textContent.includes(searchText));
      if (targetSuggestion) targetSuggestion.click();
    }, sku);

    console.log(`✅ Artículo seleccionado`);

    console.log(`⌛ Esperando carga del stock actual...`);
    await page.waitForSelector('input[ng-model="z.filtros.tengo"]', { visible: true, timeout: 20000 });
    console.log(`✅ Stock actual cargado`);

    console.log(`🟡 Ingresando cantidad: ${cantidad}`);
    await page.waitForSelector('#deboTener', { visible: true, timeout: 20000 });
    
    // Limpiar e ingresar la cantidad de forma más robusta
    await page.evaluate((value) => {
      const input = document.querySelector('#deboTener');
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, cantidad);

    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`✅ Cantidad "${cantidad}" ingresada`);

    console.log(`🟡 Agregando ajuste...`);
    await page.waitForSelector('button.btn-agregar:not([disabled])', { visible: true, timeout: 20000 });
    await page.click('button.btn-agregar');
    console.log(`✅ Movimiento agregado`);

    console.log(`🟡 Grabando ajuste...`);
    await page.waitForSelector('button.btn-primary.z-button', { visible: true, timeout: 20000 });
    await page.click('button.btn-primary.z-button');

    console.log(`⌛ Esperando modal de confirmación...`);
    await page.waitForFunction(() => {
      const modal = document.querySelector('.modal-content');
      const body = modal?.querySelector('.modal-body');
      const btn = modal?.querySelector('button.btn-primary');
      return body && body.innerText.includes('Se ajustará el stock') && btn;
    }, { timeout: 20000 });

    console.log(`✅ Modal detectado. Confirmando...`);
    await page.evaluate(() => {
      const modal = document.querySelector('.modal-content');
      const btn = modal?.querySelector('button.btn-primary');
      if (btn) btn.click();
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log(`✅ Ajuste finalizado para ${sku}`);
    res.json({ success: true, message: `Stock ajustado a ${cantidad} para SKU ${sku}` });
  } catch (err) {
    console.error('❌ Error ajustando stock:', err);
    res.status(500).json({ error: err.message });
  }
});

// 💥 IP local
function getLocalIPAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  const ip = getLocalIPAddress();
  console.log(`\n🚀 Servidor iniciado en:`);
  console.log(`➡️ Local: http://localhost:${PORT}`);
  console.log(`➡️ Red: http://${ip}:${PORT}\n`);
});

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something broke!',
    message: err.message
  });
});