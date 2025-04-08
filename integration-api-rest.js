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

    // En lugar de usar Puppeteer, simulamos un login exitoso
    // Esto es una solución temporal para el despliegue en Render
    console.log('✅ Simulando login exitoso en Zureo');
    
    // Devolvemos una respuesta de éxito
    res.json({
      status: 'success',
      message: 'Login successful (simulated)',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('❌ Error en login:', err);
    res.status(500).json({ error: err.message });
  }
});

// 📦 STOCK
app.get('/zureo/stock/:sku', async (req, res) => {
  const sku = req.params.sku;

  try {
    console.log(`\n🔍 Consultando stock para SKU: ${sku}`);
    
    // Simulamos una respuesta de stock
    const stock = Math.floor(Math.random() * 100);
    
    console.log(`✅ Stock actual para ${sku}: ${stock}`);
    res.json({ sku, stock });
  } catch (err) {
    console.error('❌ Error buscando stock:', err);
    res.status(500).json({ error: err.message });
  }
});

// 🛠️ AJUSTAR STOCK
app.get('/zureo/ajustar/:sku/:cantidad', async (req, res) => {
  const { sku, cantidad } = req.params;

  try {
    console.log(`\n🛠️ Iniciando ajuste de stock para SKU: ${sku} => ${cantidad}`);
    
    // Simulamos un ajuste exitoso
    console.log(`✅ Ajuste finalizado para ${sku}`);
    res.json({ success: true, message: `Stock ajustado a ${cantidad} para SKU ${sku} (simulado)` });
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