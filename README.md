# SaaS Backend - PropiedadIA & ContenidoIA

Backend seguro para las aplicaciones PropiedadIA y ContenidoIA.

## 🚀 Deploy en Railway (Gratis)

### Opción 1: Deploy desde GitHub

1. Sube este proyecto a GitHub (sin el archivo .env)
2. Ve a [railway.app](https://railway.app)
3. Conecta tu cuenta de GitHub
4. Crea un nuevo proyecto desde tu repositorio
5. Agrega la variable de entorno en Railway:
   - `OPENROUTER_API_KEY`: tu API key de OpenRouter
   - `ALLOWED_ORIGINS`: dominios de tus frontends (separados por coma)

### Opción 2: Deploy con Railway CLI

```bash
# Instalar Railway CLI
npm install -g @railway/cli

# Login
railway login

# Inicializar proyecto
railway init

# Configurar variables de entorno
railway variables set OPENROUTER_API_KEY=tu_api_key
railway variables set ALLOWED_ORIGINS=https://propiedadia.vercel.app,https://contenidoia.vercel.app

# Deploy
railway up
```

## 🔧 Desarrollo Local

```bash
# Instalar dependencias
npm install

# Iniciar servidor
npm start
```

El servidor estará disponible en `http://localhost:3000`

## 📡 Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/propiedadia/generate` | Generar descripción de propiedad |
| POST | `/api/contenidoia/generate` | Generar posts para redes sociales |

## 🔒 Seguridad

- ✅ API Key oculta en variables de entorno
- ✅ CORS configurado para dominios específicos
- ✅ Rate limiting (10 requests/minuto por IP)
- ✅ Helmet para headers de seguridad
- ✅ Validación de inputs

## 📝 Variables de Entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Tu API key de OpenRouter | `sk-or-...` |
| `PORT` | Puerto del servidor | `3000` |
| `ALLOWED_ORIGINS` | Dominios permitidos | `https://app.com,https://app2.com` |
