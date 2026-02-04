/**
 * Backend Seguro para PropiedadIA y ContenidoIA
 * Este servidor actúa como proxy para proteger la API key de OpenRouter
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// SEGURIDAD
// ============================================

// Helmet: Headers de seguridad
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS: Solo permitir orígenes autorizados
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5500'];
app.use(cors({
    origin: function (origin, callback) {
        // Permitir requests sin origin (como Postman o curl en desarrollo)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        callback(new Error('No permitido por CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true
}));

// Rate Limiting: Prevenir abuso
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minuto
    max: 10, // Máximo 10 requests por minuto por IP
    message: { error: 'Demasiadas solicitudes. Por favor espera un momento.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// JSON parsing
app.use(express.json({ limit: '10kb' }));

// ============================================
// OPENROUTER API PROXY
// ============================================

const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions';
const API_KEY = process.env.OPENROUTER_API_KEY;

// Validar que existe la API key
if (!API_KEY) {
    console.error('❌ ERROR: OPENROUTER_API_KEY no está configurada en .env');
    process.exit(1);
}

// ============================================
// ENDPOINTS
// ============================================

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// PropiedadIA: Generar descripción de propiedad
app.post('/api/propiedadia/generate', async (req, res) => {
    try {
        const { propertyType, rooms, bathrooms, size, location, features, style } = req.body;

        // Validación básica
        if (!propertyType || !location) {
            return res.status(400).json({ error: 'Faltan campos requeridos (propertyType, location)' });
        }

        const prompt = buildPropertyPrompt({ propertyType, rooms, bathrooms, size, location, features, style });

        const response = await fetch(OPENROUTER_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://propiedadia.cl',
                'X-Title': 'PropiedadIA'
            },
            body: JSON.stringify({
                model: 'google/gemma-7b-it:free',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un experto copywriter inmobiliario chileno. Tu trabajo es crear descripciones atractivas y profesionales para propiedades en venta o arriendo. Usa un lenguaje persuasivo pero natural, destaca los beneficios y crea una conexión emocional con el comprador potencial. Incluye emojis apropiados pero no exageres. Escribe en español chileno.`
                    },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 500,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenRouter error raw:', errorText);
            let errorJson;
            try { errorJson = JSON.parse(errorText); } catch (e) { errorJson = { message: errorText }; }
            return res.status(response.status).json({
                error: 'Error de OpenRouter',
                details: errorJson.error?.message || errorJson.message || errorText
            });
        }

        const data = await response.json();
        const description = data.choices[0]?.message?.content || '';

        res.json({ success: true, description });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});

// ContenidoIA: Generar posts para redes sociales
app.post('/api/contenidoia/generate', async (req, res) => {
    try {
        const { businessType, businessDesc, tone, network, postCount } = req.body;

        // Validación básica
        if (!businessType) {
            return res.status(400).json({ error: 'Falta el tipo de negocio (businessType)' });
        }

        const count = Math.min(parseInt(postCount) || 5, 30); // Máximo 30 posts
        const prompt = buildContentPrompt({ businessType, businessDesc, tone, network, postCount: count });

        const response = await fetch(OPENROUTER_API, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://contenidoia.cl',
                'X-Title': 'ContenidoIA'
            },
            body: JSON.stringify({
                model: 'google/gemma-7b-it:free',
                messages: [
                    {
                        role: 'system',
                        content: `Eres un experto en marketing de redes sociales y community management. 
                        Creas contenido atractivo, con emojis apropiados y hashtags relevantes en español.
                        Cada post debe ser único y variado en formato (pregunta, consejo, historia, promoción, etc.).
                        Responde SOLO con un JSON array de objetos con formato: [{"content": "texto del post", "hashtags": ["#tag1", "#tag2"]}]`
                    },
                    { role: 'user', content: prompt }
                ],
                max_tokens: 2000,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('OpenRouter error raw:', errorText);
            let errorJson;
            try { errorJson = JSON.parse(errorText); } catch (e) { errorJson = { message: errorText }; }
            return res.status(response.status).json({
                error: 'Error de OpenRouter',
                details: errorJson.error?.message || errorJson.message || errorText
            });
        }

        const data = await response.json();
        const content = data.choices[0]?.message?.content || '';

        // Intentar parsear JSON
        let posts = [];
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                posts = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            // Fallback si no se puede parsear
            posts = generateFallbackPosts(businessType, count);
        }

        res.json({ success: true, posts });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Error interno del servidor', details: error.message });
    }
});

// ============================================
// HELPERS
// ============================================

function buildPropertyPrompt(data) {
    const { propertyType, rooms, bathrooms, size, location, features, style } = data;

    const styleDescriptions = {
        profesional: 'formal y profesional',
        emocional: 'emotivo y que conecte con el comprador',
        minimalista: 'conciso y elegante',
        detallado: 'muy detallado y exhaustivo'
    };

    return `Genera una descripción atractiva para esta propiedad:

Tipo: ${propertyType}
Habitaciones: ${rooms || 'No especificado'}
Baños: ${bathrooms || 'No especificado'}
Tamaño: ${size || 'No especificado'} m²
Ubicación: ${location}
Características: ${features || 'No especificadas'}
Estilo de escritura: ${styleDescriptions[style] || 'profesional'}

Escribe una descripción de 100-150 palabras que destaque los beneficios y genere interés.`;
}

function buildContentPrompt(data) {
    const { businessType, businessDesc, tone, network, postCount } = data;

    const toneDescriptions = {
        profesional: 'formal y profesional, enfocado en expertise',
        cercano: 'amigable y cercano, como un amigo',
        inspiracional: 'motivador e inspiracional',
        humoristico: 'con humor ligero y entretenido',
        educativo: 'informativo y educativo'
    };

    const networkFormats = {
        instagram: 'posts visuales con 3-5 hashtags, máximo 150 palabras',
        facebook: 'posts conversacionales, 1-3 hashtags',
        linkedin: 'contenido profesional y de valor',
        twitter: 'tweets de máximo 280 caracteres',
        tiktok: 'descripciones cortas y llamativas'
    };

    return `Genera ${postCount} posts para redes sociales:

Negocio: ${businessType}
${businessDesc ? `Descripción: ${businessDesc}` : ''}
Tono: ${toneDescriptions[tone] || toneDescriptions.profesional}
Red social: ${network} (${networkFormats[network] || networkFormats.instagram})

Requisitos:
- Posts únicos y variados
- Emojis apropiados
- Mezcla tipos: tips, preguntas, promociones, behind the scenes
- Hashtags relevantes
- Español chileno/latinoamericano

Responde SOLO con el JSON array.`;
}

function generateFallbackPosts(businessType, count) {
    const templates = [
        { content: `✨ ¿Sabías que ${businessType} puede transformar tu día? Descubre cómo 👆`, hashtags: ['#Emprendimiento', '#Chile'] },
        { content: `🔥 ¡Nuevo en ${businessType}! Estamos emocionados de compartir esto contigo 💯`, hashtags: ['#Novedades', '#Tendencias'] },
        { content: `💡 CONSEJO DEL DÍA: Un pequeño cambio puede hacer una gran diferencia 🙌`, hashtags: ['#Tips', '#Consejos'] },
        { content: `📸 Behind the scenes de ${businessType} ✨ Con pasión y dedicación ❤️`, hashtags: ['#BehindTheScenes', '#Trabajo'] },
        { content: `🎉 ¡GRACIAS por ser parte de nuestra comunidad! 🙏`, hashtags: ['#Comunidad', '#Gracias'] }
    ];
    return templates.slice(0, count);
}

// ============================================
// SERVIR FRONTEND (opcional para producción)
// ============================================

// Descomentar estas líneas si quieres servir el frontend desde el mismo servidor
// const path = require('path');
// app.use('/propiedadia', express.static(path.join(__dirname, '../PropiedadIA')));
// app.use('/contenidoia', express.static(path.join(__dirname, '../ContenidoIA')));

// ============================================
// INICIAR SERVIDOR
// ============================================

app.listen(PORT, () => {
    console.log(`
🚀 Servidor iniciado en puerto ${PORT}
📍 Health check: http://localhost:${PORT}/api/health
🏠 PropiedadIA API: http://localhost:${PORT}/api/propiedadia/generate
📱 ContenidoIA API: http://localhost:${PORT}/api/contenidoia/generate
🔒 CORS habilitado para: ${allowedOrigins.join(', ')}
    `);
});
