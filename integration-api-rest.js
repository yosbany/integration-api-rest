// 🛡️ Validación previa
const fs = require('fs');
const path = require('path');
const os = require('os');

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

// ✅ Inicialización
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

// ✅ Configuración CORS explícita
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*'
}));

app.options('*', cors()); // Soporte para preflight

let browser;
let page;

// 🟢 LOGIN
app.get('/zureo/login', async (req, res) => {
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    await page.goto('https://go.zureo.com/', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await page.type('#empresaLogin', '218871250018');
    await page.type('#usuarioLogin', 'ytejas.86@gmail.com');
    await page.type('#passwordLogin', '1qazxsw23edc');

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
    res.json({ success: true, message: 'Sesión iniciada correctamente' });
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
    await page.goto('https://go.zureo.com/#/ajustar', { waitUntil: 'networkidle2' });

    console.log(`🟡 Seleccionando tipo de ajuste...`);
    await page.waitForSelector('#tipoAjuste', { timeout: 10000 });
    await page.select('#tipoAjuste', 'number:1');

    console.log(`🟡 Ingresando SKU: ${sku}`);
    await page.waitForSelector('#articulo', { timeout: 10000 });
    await page.evaluate(() => {
      const input = document.querySelector('#articulo');
      if (input) {
        input.focus();
        input.value = '';
      }
    });
    await page.click('#articulo');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#articulo', sku);

    console.log(`⌛ Esperando sugerencia...`);
    await page.waitForSelector('a[ng-bind-html]', { timeout: 10000 });
    await page.click('a[ng-bind-html]');
    console.log(`✅ Artículo seleccionado`);

    console.log(`⌛ Esperando carga del stock actual...`);
    await page.waitForSelector('input[ng-model="z.filtros.tengo"]', { timeout: 10000 });
    console.log(`✅ Stock actual cargado`);

    console.log(`🟡 Ingresando cantidad: ${cantidad}`);
    await page.waitForSelector('#deboTener', { timeout: 10000 });
    await page.click('#deboTener');
    await new Promise(resolve => setTimeout(resolve, 300));
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.type('#deboTener', cantidad, { delay: 100 });

    await page.waitForFunction(
      (value) => {
        const input = document.querySelector('#deboTener');
        if (!input) return false;
        const raw = input.value.replace(/\./g, '').replace(',', '.');
        const target = value.replace(',', '.');
        return parseFloat(raw) === parseFloat(target);
      },
      { timeout: 3000 },
      cantidad
    );

    await new Promise(resolve => setTimeout(resolve, 500));
    console.log(`✅ Cantidad "${cantidad}" ingresada y confirmada`);

    console.log(`🟡 Agregando ajuste...`);
    await page.waitForSelector('button.btn-agregar:not([disabled])', { timeout: 10000 });
    await page.click('button.btn-agregar');
    console.log(`✅ Movimiento agregado`);

    console.log(`🟡 Grabando ajuste...`);
    await page.waitForSelector('button.btn-primary.z-button', { timeout: 10000 });
    await page.click('button.btn-primary.z-button');

    console.log(`⌛ Esperando modal de confirmación...`);
    await page.waitForFunction(() => {
      const modal = document.querySelector('.modal-content');
      const body = modal?.querySelector('.modal-body');
      const btn = modal?.querySelector('button.btn-primary');
      return body && body.innerText.includes('Se ajustará el stock') && btn;
    }, { timeout: 10000 });

    console.log(`✅ Modal detectado. Confirmando...`);
    await page.evaluate(() => {
      const modal = document.querySelector('.modal-content');
      const btn = modal?.querySelector('button.btn-primary');
      if (btn) btn.click();
    });

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

// 🚀 INICIAR SERVIDOR
app.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIPAddress();
  console.log(`\n✅ API corriendo en:`);
  console.log(`   💻 http://localhost:${PORT}`);
  console.log(`   🌐 http://${localIP}:${PORT}`);
  console.log(`\n📚 Endpoints disponibles:`);
  console.log(`GET  /zureo/login                   → Inicia sesión en Zureo`);
  console.log(`GET  /zureo/stock/:sku              → Devuelve el stock de un artículo`);
  console.log(`GET  /zureo/ajustar/:sku/:cantidad  → Ajusta el stock de un artículo\n`);
});
