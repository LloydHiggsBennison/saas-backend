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

        console.log('CORS Origin Check:', origin);
        console.log('Allowed Origins:', allowedOrigins);

        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        console.warn('CORS Blocked for origin:', origin);
        callback(new Error('No permitido por CORS: ' + origin));
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
// INAIA API PROXY
// ============================================

const INAIA_API_URL = 'https://inaia.vercel.app/api/chat';

/**
 * Adaptador para llamar a la API de Inaia
 * @param {Array} messages - Array de mensajes en formato OpenAI
 * @param {string} model - Modelo a usar: 'kimi', 'reasoning', 'cerebras', 'auto'
 * @returns {Promise<string>} - Respuesta completa del modelo
 */
async function callInaiaAPI(messages, model = 'kimi') {
    try {
        // Crear un timeout de 30 segundos
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(INAIA_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages,
                model
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Inaia API error (${response.status}): ${errorText}`);
        }

        // Inaia retorna streaming de texto plano, acumular toda la respuesta
        const fullResponse = await response.text();

        if (!fullResponse || fullResponse.trim() === '') {
            throw new Error('Inaia returned empty response');
        }

        return fullResponse;

    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('Inaia API timeout after 30 seconds');
            throw new Error('Timeout: Inaia API no respondió en 30 segundos');
        }
        console.error('Error calling Inaia API:', error);
        throw error;
    }
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

        console.log('[PROPIEDAD-IA] Usando Inaia con modelo: kimi');

        const messages = [
            {
                role: 'system',
                content: `Eres un experto copywriter inmobiliario chileno. Tu trabajo es crear descripciones atractivas y profesionales para propiedades en venta o arriendo. Usa un lenguaje persuasivo pero natural, destaca los beneficios y crea una conexión emocional con el comprador potencial. Incluye emojis apropiados pero no exageres. Escribe en español chileno.`
            },
            { role: 'user', content: prompt }
        ];

        const description = await callInaiaAPI(messages, 'kimi');

        if (!description || description.trim() === '') {
            return res.status(500).json({
                error: 'Error de IA: Inaia no retornó una respuesta válida',
                details: 'La respuesta está vacía'
            });
        }

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

        console.log('[CONTENIDO-IA] Usando Inaia con modelo: reasoning');

        const messages = [
            {
                role: 'system',
                content: `Eres un experto en marketing de redes sociales y community management. 
                Creas contenido atractivo, con emojis apropiados y hashtags relevantes en español.
                Cada post debe ser único y variado en formato (pregunta, consejo, historia, promoción, etc.).
                Responde SOLO con un JSON array de objetos con formato: [{"content": "texto del post", "hashtags": ["#tag1", "#tag2"]}]`
            },
            { role: 'user', content: prompt }
        ];

        const content = await callInaiaAPI(messages, 'reasoning');

        // Parsear el JSON de la respuesta
        let posts = [];
        try {
            const jsonMatch = content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                posts = JSON.parse(jsonMatch[0]);
            }
        } catch (e) {
            console.error('[CONTENIDO-IA] Error parseando JSON:', e);
            return res.status(500).json({
                error: 'Error parseando respuesta de IA',
                details: e.message,
                raw_response: content.substring(0, 200)
            });
        }

        if (posts.length === 0) {
            return res.status(500).json({
                error: 'Error de IA: No se generaron posts válidos',
                details: 'La respuesta no contiene un array JSON válido',
                raw_response: content.substring(0, 200)
            });
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
// MANEJO DE ERRORES Y 404
// ============================================

// Error 404 handler
app.use((req, res) => {
    console.warn(`404 Not Found: ${req.method} ${req.url}`);
    res.status(404).json({
        error: 'Ruta no encontrada',
        path: req.url,
        method: req.method
    });
});

// Error handler global
app.use((err, req, res, next) => {
    console.error('Global Error Handler:', err);
    res.status(err.status || 500).json({
        error: err.message || 'Error interno del servidor',
        details: err.details || null
    });
});

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
